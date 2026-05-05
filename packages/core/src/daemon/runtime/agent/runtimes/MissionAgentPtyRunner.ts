import {
	AgentRunner,
	type AgentRunnerTerminalTransportRuntimeOptions
} from '../AgentRunner.js';
import type { AgentProviderObservation } from '../AgentProviderObservations.js';
import type { AgentSession } from '../AgentSession.js';
import type {
	AgentCommand,
	AgentLaunchConfig,
	AgentRunnerCapabilities,
	AgentSessionEvent,
	AgentSessionSnapshot,
	AgentSessionReference
} from '../AgentRuntimeTypes.js';
import { AgentSessionObservationRouter } from '../signals/AgentSessionObservationRouter.js';
import type { AgentSessionObservation } from '../signals/AgentSessionSignal.js';
import { AgentSessionSignalPolicy } from '../signals/AgentSessionSignalPolicy.js';
import {
	AgentSessionMcpAccessProvisioner,
	type AgentSessionMcpProvisioningPolicy
} from '../mcp/AgentSessionMcpAccessProvisioner.js';
import { buildMissionAgentRuntimeProtocolLaunchContext } from '../mcp/MissionAgentRuntimeProtocolLaunchContext.js';
import {
	missionMcpSignalToolNames,
	type MissionMcpSignalToolName
} from '../mcp/MissionMcpSignalTools.js';

const RUNNING_SESSION_COMMANDS: AgentCommand['type'][] = ['interrupt', 'checkpoint', 'nudge'];
const AWAITING_INPUT_SESSION_COMMANDS: AgentCommand['type'][] = ['interrupt', 'checkpoint', 'nudge', 'resume'];

type ManagedMissionSessionState = {
	disposable: { dispose(): void };
	outputLines: string[];
	signalPolicy: AgentSessionSignalPolicy;
	cleanup?: () => Promise<void>;
};

export type MissionAgentRunnerLaunchPlan = {
	mode: 'interactive' | 'print';
	command: string;
	args: string[];
	stdin?: string;
	env?: NodeJS.ProcessEnv;
};

export type MissionAgentRunnerSettings = {
	model: string;
	launchMode?: 'interactive' | 'print';
	reasoningEffort?: string;
	dangerouslySkipPermissions?: boolean;
	resumeSession?: string;
	captureSessions?: boolean;
	providerEnv?: Record<string, string>;
	runtimeEnv?: NodeJS.ProcessEnv;
	launchEnv?: Record<string, string>;
};

export type ResolvedMissionAgentRunnerSettings = {
	model: string;
	launchMode: 'interactive' | 'print';
	reasoningEffort?: string;
	dangerouslySkipPermissions: boolean;
	resumeSession?: string;
	captureSessions?: boolean;
	providerEnv: Record<string, string>;
	runtimeEnv: NodeJS.ProcessEnv;
	launchEnv: Record<string, string>;
};

export type MissionAgentRunnerSettingsResolver<TRunnerId extends string> = (
	config: AgentLaunchConfig,
	runnerId: TRunnerId
) => MissionAgentRunnerSettings;

export class ProviderInitializationError extends Error {
	public readonly runnerId: string;

	public constructor(runnerId: string, message: string) {
		super(message);
		this.name = 'ProviderInitializationError';
		this.runnerId = runnerId;
	}
}

export class UnsupportedCapabilityError extends Error {
	public readonly runnerId: string;

	public constructor(runnerId: string, message: string) {
		super(message);
		this.name = 'UnsupportedCapabilityError';
		this.runnerId = runnerId;
	}
}

export abstract class MissionAgentPtyRunner extends AgentRunner {
	private readonly observationRouter: AgentSessionObservationRouter;

	private readonly createSignalPolicy: () => AgentSessionSignalPolicy;

	private readonly managedSessionState = new Map<string, ManagedMissionSessionState>();

	private readonly mcpProvisioner: AgentSessionMcpAccessProvisioner | undefined;

	private readonly mcpProvisioningPolicy: AgentSessionMcpProvisioningPolicy;

	private readonly allowedMcpTools: readonly MissionMcpSignalToolName[];

	public constructor(options: {
		id: string;
		command: string;
		displayName?: string;
		observationRouter?: AgentSessionObservationRouter;
		createSignalPolicy?: () => AgentSessionSignalPolicy;
		mcpProvisioner?: AgentSessionMcpAccessProvisioner;
		mcpProvisioningPolicy?: AgentSessionMcpProvisioningPolicy;
		allowedMcpTools?: readonly MissionMcpSignalToolName[];
	} & Omit<
		AgentRunnerTerminalTransportRuntimeOptions,
		| 'args'
		| 'command'
		| 'env'
	>) {
		super({
			id: options.id,
			displayName: options.displayName ?? `${options.id} via PTY transport`
		});
		this.observationRouter = options.observationRouter ?? new AgentSessionObservationRouter();
		this.createSignalPolicy = options.createSignalPolicy ?? (() => new AgentSessionSignalPolicy());
		this.configureTerminalTransportRuntime({
			command: options.command,
			...(options.sessionPrefix ? { sessionPrefix: options.sessionPrefix } : {}),
			...(options.pollIntervalMs ? { pollIntervalMs: options.pollIntervalMs } : {}),
			...(options.logLine ? { logLine: options.logLine } : {}),
			...(options.terminalBinary ? { terminalBinary: options.terminalBinary } : {}),
			...(options.sharedSessionName ? { sharedSessionName: options.sharedSessionName } : {}),
			...(options.agentSessionPaneTitle ? { agentSessionPaneTitle: options.agentSessionPaneTitle } : {}),
			...(options.discoverSharedSessionName !== undefined
				? { discoverSharedSessionName: options.discoverSharedSessionName }
				: {}),
			...(options.executor ? { executor: options.executor } : {}),
			...(options.spawn ? { spawn: options.spawn } : {})
		});
		this.mcpProvisioner = options.mcpProvisioner;
		this.mcpProvisioningPolicy = options.mcpProvisioningPolicy ?? 'optional';
		this.allowedMcpTools = options.allowedMcpTools ?? missionMcpSignalToolNames;
	}

	public override dispose(): void {
		for (const sessionId of [...this.managedSessionState.keys()]) {
			this.disposeManagedSessionState(sessionId);
		}
		super.dispose();
	}

	public async getCapabilities(): Promise<AgentRunnerCapabilities> {
		return this.getTerminalCommandCapabilities();
	}

	public async isAvailable(): Promise<{ available: boolean; reason?: string }> {
		return this.isTerminalCommandRuntimeAvailable();
	}

	public abstract createInteractiveLaunchPlan(config: AgentLaunchConfig): MissionAgentRunnerLaunchPlan;

	protected abstract parseRuntimeOutputLine(line: string): AgentProviderObservation[];

	protected async prepareRunnerLaunchConfig(config: AgentLaunchConfig): Promise<{
		config: AgentLaunchConfig;
		cleanup?: () => Promise<void>;
	}> {
		return { config };
	}

	protected parseSessionUsageContent(_content: string): AgentProviderObservation | undefined {
		return undefined;
	}

	protected override async onValidateLaunchConfig(config: AgentLaunchConfig): Promise<void> {
		this.createInteractiveLaunchPlan(config);
	}

	protected override async onStartSession(config: AgentLaunchConfig): Promise<AgentSession> {
		const prepared = await this.prepareLaunch(config);
		const preparedRunnerConfig = await this.prepareRunnerLaunchConfig(prepared.config);
		const launchPlan = this.createInteractiveLaunchPlan(preparedRunnerConfig.config);
		const session = await this.startTerminalCommandSession(preparedRunnerConfig.config, {
			sessionId: prepared.sessionId,
			launchCommand: launchPlan.command,
			launchArgs: launchPlan.args,
			replaceBaseArgs: true,
			skipInitialPromptSubmission: true,
			...(launchPlan.env ? { launchEnv: launchPlan.env } : {})
		});
		this.attachRuntimeObservationRouting(
			session,
			mergeCleanupCallbacks(prepared.cleanup, preparedRunnerConfig.cleanup)
		);
		return session;
	}

	protected override async onReconcileSession(reference: AgentSessionReference): Promise<AgentSession> {
		const session = await this.reconcileTerminalCommandSession(reference);
		this.attachRuntimeObservationRouting(session);
		return session;
	}

	private attachRuntimeObservationRouting(session: AgentSession, cleanup?: () => Promise<void>): void {
		const sessionId = session.getSnapshot().sessionId;
		this.disposeManagedSessionState(sessionId);
		const disposable = session.onDidEvent((event) => {
			this.handleSessionEvent(sessionId, event);
		});
		this.managedSessionState.set(sessionId, {
			disposable,
			outputLines: [],
			signalPolicy: this.createSignalPolicy(),
			...(cleanup ? { cleanup } : {})
		});
	}

	private handleSessionEvent(sessionId: string, event: AgentSessionEvent): void {
		const state = this.managedSessionState.get(sessionId);
		if (!state) {
			return;
		}
		switch (event.type) {
			case 'session.message':
				if (event.channel !== 'stdout' && event.channel !== 'stderr') {
					return;
				}
				state.outputLines.push(event.text);
				this.routeRuntimeOutput(state, event.snapshot, event.channel, event.text);
				return;
			case 'session.completed':
			case 'session.failed':
				this.routeUsageObservation(state, event.snapshot);
				this.disposeManagedSessionState(sessionId);
				return;
			case 'session.cancelled':
			case 'session.terminated':
				this.disposeManagedSessionState(sessionId);
				return;
			case 'session.attached':
			case 'session.awaiting-input':
			case 'session.started':
			case 'session.updated':
				return;
		}
	}

	private routeRuntimeOutput(
		state: ManagedMissionSessionState,
		snapshot: AgentSessionSnapshot,
		channel: 'stdout' | 'stderr',
		line: string
	): void {
		for (const observation of this.parseRuntimeOutputLine(line)) {
			this.applyObservations(
				snapshot.sessionId,
				state,
				this.observationRouter.route({
					kind: 'provider-output',
					observation,
					scope: toSignalScope(snapshot),
					observedAt: snapshot.updatedAt
				})
			);
		}
		this.applyObservations(
			snapshot.sessionId,
			state,
			this.observationRouter.route({
				kind: 'terminal-output',
				line,
				channel,
				scope: toSignalScope(snapshot),
				observedAt: snapshot.updatedAt
			})
		);
	}

	private routeUsageObservation(
		state: ManagedMissionSessionState,
		snapshot: AgentSessionSnapshot
	): void {
		const usageObservation = this.parseSessionUsageContent(state.outputLines.join('\n'));
		if (!usageObservation) {
			return;
		}
		this.applyObservations(
			snapshot.sessionId,
			state,
			this.observationRouter.route({
				kind: 'provider-output',
				observation: usageObservation,
				scope: toSignalScope(snapshot),
				observedAt: snapshot.updatedAt
			})
		);
	}

	private applyObservations(
		sessionId: string,
		state: ManagedMissionSessionState,
		observations: AgentSessionObservation[]
	): void {
		for (const observation of observations) {
			const decision = state.signalPolicy.evaluate({
				snapshot: this.getManagedSnapshot(sessionId),
				observation
			});
			this.applySignalDecision(sessionId, decision);
		}
	}

	private applySignalDecision(
		sessionId: string,
		decision: ReturnType<AgentSessionSignalPolicy['evaluate']>
	): void {
		switch (decision.action) {
			case 'emit-message':
				this.emitSessionEvent(decision.event);
				return;
			case 'record-observation-only':
			case 'reject':
				return;
			case 'update-session': {
				const snapshot = this.updateManagedSnapshot(sessionId, {
					...decision.snapshotPatch,
					...toTerminalInteractionPatch(decision.eventType)
				});
				this.emitSessionEvent(toSessionEvent(decision.eventType, snapshot));
				return;
			}
		}
	}

	private disposeManagedSessionState(sessionId: string): void {
		const state = this.managedSessionState.get(sessionId);
		if (!state) {
			return;
		}
		state.disposable.dispose();
		this.managedSessionState.delete(sessionId);
		void state.cleanup?.();
	}

	private async prepareLaunch(config: AgentLaunchConfig): Promise<{
		config: AgentLaunchConfig;
		sessionId: string;
		cleanup?: () => Promise<void>;
	}> {
		const sessionId = this.createFreshSessionId(config);
		if (!this.mcpProvisioner || this.mcpProvisioningPolicy === 'disabled') {
			return { config, sessionId };
		}

		const provisioning = await this.mcpProvisioner.provision({
			runnerId: this.id,
			policy: this.mcpProvisioningPolicy,
			workingDirectory: config.workingDirectory,
			missionId: config.missionId,
			taskId: config.task.taskId,
			agentSessionId: sessionId,
			allowedTools: [...this.allowedMcpTools]
		});
		const launchContext = buildMissionAgentRuntimeProtocolLaunchContext({
			provisioning,
			missionId: config.missionId,
			taskId: config.task.taskId,
			agentSessionId: sessionId
		});
		return {
			sessionId,
			config: {
				...config,
				initialPrompt: config.initialPrompt
					? {
						...config.initialPrompt,
						text: `${launchContext.sessionInstructions}\n\n${config.initialPrompt.text}`
					}
					: {
						source: 'system',
						text: launchContext.sessionInstructions
					},
				launchEnv: {
					...(config.launchEnv ?? {}),
					...launchContext.launchEnv
				}
			},
			cleanup: provisioning.cleanup
		};
	}
}

function mergeCleanupCallbacks(
	first: (() => Promise<void>) | undefined,
	second: (() => Promise<void>) | undefined
): (() => Promise<void>) | undefined {
	if (!first) {
		return second;
	}
	if (!second) {
		return first;
	}
	return async () => {
		await second();
		await first();
	};
}

export function resolveMissionAgentRunnerSettings<TRunnerId extends string>(input: {
	config: AgentLaunchConfig;
	runnerId: TRunnerId;
	resolveSettings?: MissionAgentRunnerSettingsResolver<TRunnerId>;
}): ResolvedMissionAgentRunnerSettings {
	const raw: MissionAgentRunnerSettings = input.resolveSettings
		? input.resolveSettings(input.config, input.runnerId)
		: {
			model: process.env['MISSION_DEFAULT_MODEL']?.trim() || '',
			launchMode: 'interactive' as const,
			runtimeEnv: process.env
		};
	const model = raw.model?.trim();
	if (!model) {
		throw new ProviderInitializationError(
			input.runnerId,
			`Runner '${input.runnerId}' requires a non-empty provider model.`
		);
	}

	return {
		model,
		launchMode: raw.launchMode ?? 'interactive',
		...(raw.reasoningEffort ? { reasoningEffort: raw.reasoningEffort.trim() } : {}),
		dangerouslySkipPermissions: raw.dangerouslySkipPermissions ?? false,
		...(raw.resumeSession?.trim() ? { resumeSession: raw.resumeSession.trim() } : {}),
		...(raw.captureSessions !== undefined ? { captureSessions: raw.captureSessions } : {}),
		providerEnv: validateStringRecord(input.runnerId, raw.providerEnv, 'resolved provider env'),
		runtimeEnv: sanitizeProcessEnv(raw.runtimeEnv),
		launchEnv: validateStringRecord(
			input.runnerId,
			{
				...(raw.launchEnv ?? {}),
				...(input.config.launchEnv ?? {})
			},
			'launch env'
		)
	};
}

export function validateReasoningEffort(
	runnerId: string,
	value: string | undefined,
	allowedValues: readonly string[] | undefined
): void {
	if (value === undefined) {
		return;
	}
	if (!allowedValues) {
		throw new ProviderInitializationError(
			runnerId,
			`Runner '${runnerId}' does not support a reasoning effort option.`
		);
	}
	if (!allowedValues.includes(value)) {
		throw new ProviderInitializationError(
			runnerId,
			`Runner '${runnerId}' received unsupported reasoning effort '${value}'.`
		);
	}
}

export function validateCaptureSessions(runnerId: string, value: boolean | undefined): void {
	if (value === undefined) {
		return;
	}
	if (runnerId !== 'claude-code' && value) {
		throw new ProviderInitializationError(
			runnerId,
			`Runner '${runnerId}' does not support enabling session capture.`
		);
	}
}

export function validateDangerouslySkipPermissions(
	runnerId: string,
	value: boolean | undefined
): void {
	if (!value) {
		return;
	}
	if (runnerId !== 'claude-code') {
		throw new ProviderInitializationError(
			runnerId,
			`Runner '${runnerId}' does not support configurable permission bypass.`
		);
	}
}

export function validateNoResumeSession(runnerId: string, value: string | undefined, mode: string): void {
	if (!value?.trim()) {
		return;
	}
	throw new ProviderInitializationError(
		runnerId,
		`Runner '${runnerId}' does not support resumeSession for ${mode} launch plans.`
	);
}

export function mergeLaunchEnv(
	runtimeEnv: NodeJS.ProcessEnv,
	providerEnv: Record<string, string>,
	launchEnv: Record<string, string>
): NodeJS.ProcessEnv {
	return {
		...runtimeEnv,
		...providerEnv,
		...launchEnv
	};
}

export function quoteShellArg(value: string): string {
	return `'${value.replaceAll('\'', '\'\"\'\"\'')}'`;
}

export function parseJsonLine(line: string): Record<string, unknown> | undefined {
	const trimmed = line.trim();
	if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export function getNestedRecord(
	record: Record<string, unknown>,
	key: string
): Record<string, unknown> | undefined {
	const value = record[key];
	return isRecord(value) ? value : undefined;
}

export function getStringField(
	record: Record<string, unknown>,
	key: string
): string | undefined {
	const value = record[key];
	return typeof value === 'string' && value.trim() ? value : undefined;
}

function validateStringRecord(
	runnerId: string,
	value: Record<string, string> | undefined,
	label: string
): Record<string, string> {
	if (value === undefined) {
		return {};
	}
	if (!isRecord(value)) {
		throw new ProviderInitializationError(
			runnerId,
			`Runner '${runnerId}' requires ${label} to be a string record.`
		);
	}
	const env: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry !== 'string') {
			throw new ProviderInitializationError(
				runnerId,
				`Runner '${runnerId}' requires ${label}['${key}'] to be a string.`
			);
		}
		env[key] = entry;
	}
	return env;
}

function sanitizeProcessEnv(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
	const normalized: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(env ?? {})) {
		if (typeof value === 'string') {
			normalized[key] = value;
		}
	}
	return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toSignalScope(snapshot: AgentSessionSnapshot) {
	return {
		missionId: snapshot.missionId,
		taskId: snapshot.taskId,
		agentSessionId: snapshot.sessionId
	};
}

function toTerminalInteractionPatch(
	eventType: 'session.updated' | 'session.awaiting-input' | 'session.completed' | 'session.failed'
): Pick<AgentSessionSnapshot, 'acceptsPrompts' | 'acceptedCommands' | 'waitingForInput'>
	& Partial<Pick<AgentSessionSnapshot, 'failureMessage'>> {
	switch (eventType) {
		case 'session.awaiting-input':
			return {
				acceptsPrompts: true,
				acceptedCommands: [...AWAITING_INPUT_SESSION_COMMANDS],
				waitingForInput: true
			};
		case 'session.completed':
			return {
				acceptsPrompts: false,
				acceptedCommands: [],
				waitingForInput: false
			};
		case 'session.failed':
			return {
				acceptsPrompts: false,
				acceptedCommands: [],
				waitingForInput: false
			};
		case 'session.updated':
			return {
				acceptsPrompts: true,
				acceptedCommands: [...RUNNING_SESSION_COMMANDS],
				waitingForInput: false
			};
	}
}

function toSessionEvent(
	eventType: 'session.updated' | 'session.awaiting-input' | 'session.completed' | 'session.failed',
	snapshot: AgentSessionSnapshot
): AgentSessionEvent {
	switch (eventType) {
		case 'session.awaiting-input':
			return {
				type: 'session.awaiting-input',
				snapshot
			};
		case 'session.completed':
			return {
				type: 'session.completed',
				snapshot
			};
		case 'session.failed':
			return {
				type: 'session.failed',
				reason: snapshot.failureMessage ?? snapshot.progress.summary ?? 'Agent session failed.',
				snapshot
			};
		case 'session.updated':
			return {
				type: 'session.updated',
				snapshot
			};
	}
}
