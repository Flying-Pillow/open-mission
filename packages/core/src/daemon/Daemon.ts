import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as path from 'node:path';
import type { Socket } from 'node:net';
import { spawnSync } from 'node:child_process';
import { Mission } from './mission/Mission.js';
import { Factory } from './mission/Factory.js';
import { AgentSession, type AgentSessionMetadata } from './mission/AgentSession.js';
import { FilesystemAdapter } from '../lib/FilesystemAdapter.js';
import {
	GitHubPlatformAdapter,
	resolveGitHubRepositoryFromWorkspace
} from '../platforms/GitHubPlatformAdapter.js';
import { MissionAgentContext } from '../agents/agentContext.js';
import { initializeMissionRepository } from '../initializeMissionRepository.js';
import {
	type MissionAgentConsoleState,
	type MissionAgentDisposable,
	type MissionAgentEvent,
	type MissionAgentRuntime,
	type MissionAgentSession,
	type MissionAgentSessionLaunchRequest,
	type MissionAgentSessionRecord,
	type MissionAgentTurnRequest
} from './MissionAgentRuntime.js';
import {
	getDefaultMissionRepoSettingsWithOverrides,
	getMissionDirectoryPath,
	getMissionSettingsPath,
	getMissionWorktreesPath,
	readMissionRepoSettings,
	type MissionRepoSettings,
	writeMissionRepoSettings
} from '../lib/repoConfig.js';
import type {
	MissionCommandDescriptor,
	MissionCommandFlowDescriptor,
	MissionCommandFlowOption,
	MissionControlPlaneStatus,
	MissionOperationalMode,
	MissionSelectionCandidate,
	MissionType,
	MissionTaskState,
	MissionSelector,
	MissionStatus,
	TrackedIssueSummary
} from '../types.js';
import { MISSION_STAGES } from '../types.js';
import {
	PROTOCOL_VERSION,
	type CommandExecute,
	type CommandExecuteResult,
	type ControlIssuesList,
	type ControlMissionBootstrap,
	type ControlMissionStart,
	type ControlSessionLaunch,
	type ControlSettingsUpdate,
	type ErrorResponse,
	type Manifest,
	type Message,
	type MissionGateEvaluate,
	type MissionSelect,
	type Notification,
	type Ping,
	type Request,
	type Response,
	type SessionConsoleState,
	type SessionControl,
	type SessionInput,
	type SessionResize,
	type SessionTurnSubmit,
	type StageTransition,
	type SuccessResponse,
	type TaskLaunch,
	type TaskSelect
} from './protocol.js';
import {
	getDaemonRuntimePath,
	getDaemonManifestPath,
	isNamedPipePath,
	resolveDaemonSocketPath
} from './daemonPaths.js';

type LoadedMission = {
	missionId: string;
	branchRef: string;
	mission: Mission;
	consoleSubscription: MissionAgentDisposable;
	eventSubscription: MissionAgentDisposable;
	autopilotEnabled: boolean;
	autopilotQueue: Promise<void>;
};

const CONTROL_SESSION_CHANNEL_ID = '__control__';

export type DaemonOptions = {
	logLine?: (line: string) => void;
	socketPath?: string;
	runtimes?: MissionAgentRuntime[];
};

export class Daemon {
	private readonly server = net.createServer();
	private readonly clients = new Set<Socket>();
	private readonly store: FilesystemAdapter;
	private readonly runtimes = new Map<string, MissionAgentRuntime>();
	private readonly loadedMissions = new Map<string, LoadedMission>();
	private readonly controlManagedSessions = new Map<string, AgentSession>();
	private controlAgentSessions: MissionAgentSessionRecord[] = [];
	private readonly shutdownPromise: Promise<void>;
	private readonly socketPath: string;
	private readonly logLine: ((line: string) => void) | undefined;
	private resolveShutdown!: () => void;
	private manifest?: Manifest;
	private closed = false;
	private githubAuthCache?: {
		checkedAt: number;
		authenticated: boolean;
		user?: string;
		detail?: string;
	};

	public constructor(
		private readonly repoRoot: string,
		options: DaemonOptions = {}
	) {
		this.store = new FilesystemAdapter(repoRoot);
		this.socketPath = resolveDaemonSocketPath(repoRoot, options.socketPath);
		this.logLine = options.logLine;
		for (const runtime of options.runtimes ?? []) {
			this.runtimes.set(runtime.id, runtime);
		}
		this.shutdownPromise = new Promise<void>((resolve) => {
			this.resolveShutdown = resolve;
		});
		this.server.on('connection', (socket) => {
			this.handleConnection(socket);
		});
	}

	public getManifest(): Manifest | undefined {
		return this.manifest ? structuredClone(this.manifest) : undefined;
	}

	public async listen(): Promise<Manifest> {
		await this.initializeRepositoryIfNeeded();
		await this.prepareSocketPath();
		await new Promise<void>((resolve, reject) => {
			const onError = (error: Error) => {
				this.server.off('listening', onListening);
				reject(error);
			};
			const onListening = () => {
				this.server.off('error', onError);
				resolve();
			};

			this.server.once('error', onError);
			this.server.once('listening', onListening);
			this.server.listen(this.socketPath);
		});

		this.manifest = {
			repoRoot: this.repoRoot,
			pid: process.pid,
			startedAt: new Date().toISOString(),
			protocolVersion: PROTOCOL_VERSION,
			endpoint: {
				transport: 'ipc',
				path: this.socketPath
			}
		};
		await this.writeManifest();
		return structuredClone(this.manifest);
	}

	public waitUntilClosed(): Promise<void> {
		return this.shutdownPromise;
	}

	public async close(): Promise<void> {
		if (this.closed) {
			await this.shutdownPromise;
			return;
		}

		this.closed = true;
		for (const client of this.clients) {
			client.end();
			client.destroy();
		}
		this.clients.clear();
		this.disposeControlSessions();

		await new Promise<void>((resolve, reject) => {
			if (!this.server.listening) {
				resolve();
				return;
			}

			this.server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});

		this.disposeLoadedMissions();
		await this.cleanupRuntimeFiles();
		this.resolveShutdown();
	}

	private handleConnection(socket: Socket): void {
		this.clients.add(socket);
		socket.setEncoding('utf8');
		let buffer = '';

		socket.on('data', (chunk: string) => {
			buffer += chunk;
			while (true) {
				const newlineIndex = buffer.indexOf('\n');
				if (newlineIndex < 0) {
					break;
				}

				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				if (!line) {
					continue;
				}

				void this.handleLine(socket, line);
			}
		});

		const releaseSocket = () => {
			this.clients.delete(socket);
		};
		socket.once('close', releaseSocket);
		socket.once('end', releaseSocket);
		socket.once('error', releaseSocket);
	}

	private async handleLine(socket: Socket, line: string): Promise<void> {
		let message: Message;
		try {
			message = JSON.parse(line) as Message;
		} catch (error) {
			this.writeToSocket(socket, this.toErrorResponse('unknown', error));
			return;
		}

		if (message.type !== 'request') {
			this.writeToSocket(
				socket,
				this.toErrorResponse('unknown', 'Only request messages are accepted by the server.')
			);
			return;
		}

		const response = await this.handleRequest(message);
		this.writeToSocket(socket, response);
	}

	private async handleRequest(
		request: Request
	): Promise<Response> {
		try {
			const result = await this.executeMethod(request);
			const response: SuccessResponse = {
				type: 'response',
				id: request.id,
				ok: true,
				result
			};
			return response;
		} catch (error) {
			return this.toErrorResponse(request.id, error);
		}
	}

	private async executeMethod(request: Request) {
		switch (request.method) {
			case 'ping': {
				const pingResult: Ping = {
					ok: true,
					repoRoot: this.repoRoot,
					pid: process.pid,
					startedAt: this.manifest?.startedAt ?? new Date().toISOString(),
					protocolVersion: PROTOCOL_VERSION
				};
				return pingResult;
			}
				case 'command.execute':
					return this.executeCommand(request.params as CommandExecute);
				case 'control.session.launch':
					return this.launchControlSession((request.params as ControlSessionLaunch | undefined) ?? {});
			case 'control.status':
				return this.buildIdleMissionStatus();
			case 'control.settings.update':
				return this.updateControlSettings(request.params as ControlSettingsUpdate);
			case 'control.mission.start':
				return this.startMission(request.params as ControlMissionStart);
			case 'control.mission.bootstrap':
				return this.bootstrapMissionFromIssue(request.params as ControlMissionBootstrap);
			case 'control.issues.list':
				return this.listOpenGitHubIssues(
					(request.params as ControlIssuesList | undefined) ?? {}
				);
			case 'mission.status':
				return this.getMissionStatus(this.toMissionParams(request.params));
			case 'mission.gate.evaluate':
				return this.evaluateGate(request.params as MissionGateEvaluate);
			case 'mission.deliver':
				return this.deliverMission(this.toMissionParams(request.params));
			case 'stage.transition':
				return this.transitionMissionStage(request.params as StageTransition);
			case 'task.activate':
				return this.activateTask(request.params as TaskSelect);
			case 'task.block':
				return this.blockTask(request.params as TaskSelect);
			case 'task.complete':
				return this.completeTask(request.params as TaskSelect);
			case 'task.launch':
				return this.launchTaskSession(request.params as TaskLaunch);
			case 'session.list':
				return this.listAgentSessions(this.toMissionParams(request.params));
			case 'session.console.state':
				return this.getAgentConsoleState(request.params as SessionConsoleState);
			case 'session.turn.submit':
				return this.submitAgentTurn(request.params as SessionTurnSubmit);
			case 'session.send':
				return this.sendAgentInput(request.params as SessionInput);
			case 'session.resize':
				return this.resizeAgentSession(request.params as SessionResize);
			case 'session.cancel':
				return this.cancelAgentSession(request.params as SessionControl);
			case 'session.terminate':
				return this.terminateAgentSession(request.params as SessionControl);
			default:
				throw new Error(`Unknown server method '${request.method}'.`);
		}
	}

	private async startMission(params: ControlMissionStart): Promise<MissionStatus> {
		await this.ensureRepositoryInitialized();
		const agentContext = params.agentContext ?? this.buildConfiguredAgentContext();
		const missionIssueId = this.resolveMissionIssueId(params);
		const branchRef =
			params.branchRef ??
			(missionIssueId !== undefined
				? this.store.deriveMissionBranchName(missionIssueId, params.brief.title)
				: this.store.deriveDraftMissionBranchName(params.brief.title));
		const mission = await Factory.create(this.store, {
			brief: params.brief,
			branchRef,
			agentContext
		});
		const loadedMission = this.registerLoadedMission(mission, {
			autopilotEnabled: MissionAgentContext.getAutopilotMode(agentContext) === 'enabled'
		});
		const status = await loadedMission.mission.status();
		await this.broadcastMissionStatus(loadedMission.missionId, status);
		return this.decorateMissionStatus(status, 'mission');
	}

	private async executeCommand(
		params: CommandExecute
	): Promise<CommandExecuteResult> {
		if (params.commandId === 'control.setup.edit') {
			const fieldSelection = requireSingleSelectionCommandStep(params.steps, 'field');
			const field = asControlSettingField(fieldSelection.optionIds[0]);
			if (!field) {
				throw new Error('Mission setup execution requires a valid settings field selection.');
			}
			const value = requireSingleValueCommandStep(params.steps, 'value');
			await this.writeControlSetting(field, value);
			return { status: await this.buildIdleMissionStatus() };
		}

		if (params.commandId === 'control.mission.start') {
			const typeSelection = requireSingleSelectionCommandStep(params.steps, 'type');
			const missionType = asMissionType(typeSelection.optionIds[0]);
			if (!missionType) {
				throw new Error('Mission start execution requires a valid mission type selection.');
			}
			const titleStep = requireTextCommandStep(params.steps, 'title');
			const bodyStep = requireTextCommandStep(params.steps, 'body');
			const title = titleStep.value.trim();
			const body = bodyStep.value.trim();
			if (!title) {
				throw new Error('Mission start execution requires a title.');
			}
			if (!body) {
				throw new Error('Mission start execution requires a body.');
			}
			return {
				status: await this.startMission({
					brief: {
						title,
						body,
						type: missionType
					}
				})
			};
		}

		if (params.commandId === 'control.mission.select') {
			const missionSelection = requireSingleSelectionCommandStep(params.steps, 'mission');
			const missionId = missionSelection.optionIds[0]?.trim();
			if (!missionId) {
				throw new Error('Mission switch execution requires a mission selection.');
			}
			return {
				status: await this.getMissionStatus({ selector: { missionId } })
			};
		}

		if (params.commandId === 'mission.status') {
			const selector = requireCommandMissionSelector(params);
			return {
				status: await this.getMissionStatus({ selector })
			};
		}

		if (params.commandId === 'mission.deliver') {
			const selector = requireCommandMissionSelector(params);
			return {
				status: await this.deliverMission({ selector })
			};
		}

		if (params.commandId.startsWith('stage.transition.')) {
			const selector = requireCommandMissionSelector(params);
			const toStage = params.commandId.slice('stage.transition.'.length) as StageTransition['toStage'];
			return {
				status: await this.transitionMissionStage({
					selector,
					toStage
				})
			};
		}

		if (params.commandId.startsWith('task.launch.')) {
			const selector = requireCommandMissionSelector(params);
			const taskId = params.commandId.slice('task.launch.'.length);
			const loadedMission = await this.requireMissionContext(selector);
			const request = await this.buildTaskLaunchRequest(loadedMission, taskId);
			const session = await this.launchTaskSession({
				selector,
				taskId,
				request
			});
			return {
				status: await this.getMissionStatus({ selector }),
				session
			};
		}

		if (params.commandId.startsWith('session.cancel.')) {
			const selector = requireCommandMissionSelector(params);
			const sessionId = params.commandId.slice('session.cancel.'.length);
			await this.cancelAgentSession({
				selector,
				sessionId,
				reason: 'Cancelled from Mission cockpit'
			});
			return {
				status: await this.getMissionStatus({ selector })
			};
		}

		if (params.commandId.startsWith('session.terminate.')) {
			const selector = requireCommandMissionSelector(params);
			const sessionId = params.commandId.slice('session.terminate.'.length);
			await this.terminateAgentSession({
				selector,
				sessionId,
				reason: 'Terminated from Mission cockpit'
			});
			return {
				status: await this.getMissionStatus({ selector })
			};
		}

		throw new Error(`Mission command '${params.commandId}' is not executable through the flow interface.`);
	}

	private async updateControlSettings(
		params: ControlSettingsUpdate
	): Promise<MissionStatus> {
		await this.writeControlSetting(params.field, params.value);
		return this.buildIdleMissionStatus();
	}

	private async bootstrapMissionFromIssue(
		params: ControlMissionBootstrap
	): Promise<MissionStatus> {
		await this.ensureRepositoryInitialized();
		const settings = readMissionRepoSettings(this.repoRoot);
		if (settings?.trackingProvider !== 'github') {
			throw new Error(
				'Mission issue intake requires .mission/settings.json to use the GitHub tracking provider.'
			);
		}

		const adapter = new GitHubPlatformAdapter(this.repoRoot);
		const brief = await adapter.fetchIssue(String(params.issueNumber));
		return this.startMission({
			brief,
			agentContext: params.agentContext ?? this.buildConfiguredAgentContext()
		});
	}

	private async getMissionStatus(
		params: MissionSelect = {}
	): Promise<MissionStatus> {
		await this.initializeRepositoryIfNeeded();
		const loadedMission = await this.requireMissionContext(params.selector);
		return this.decorateMissionStatus(await loadedMission.mission.status(), 'mission');
	}

	private async buildIdleMissionStatus(): Promise<MissionStatus> {
		const availableMissions: MissionSelectionCandidate[] = (await this.store.listMissions()).map(
			({ descriptor }) => ({
				missionId: descriptor.missionId,
				title: descriptor.brief.title,
				branchRef: descriptor.branchRef,
				createdAt: descriptor.createdAt,
				...(descriptor.brief.issueId !== undefined ? { issueId: descriptor.brief.issueId } : {})
			})
		);
		const control = await this.buildControlPlaneStatus(availableMissions.length);
		const issuesReady = control.issuesConfigured && control.githubAuthenticated === true;

		const availableCommands: MissionCommandDescriptor[] = [
			{
				id: 'control.setup.edit',
				label: 'Configure repository setup',
				command: '/setup',
				scope: 'mission',
				enabled: true,
				flow: this.buildSetupCommandFlow(control)
			},
			{
				id: 'control.mission.start',
				label: 'Start a new mission brief',
				command: '/start',
				scope: 'mission',
				enabled: true,
				flow: this.buildMissionStartFlow()
			},
			{
				id: 'control.mission.select',
				label: 'Select an active mission',
				command: '/select',
				scope: 'mission',
				enabled: availableMissions.length > 0,
				flow: this.buildMissionSwitchFlow(availableMissions),
				...(availableMissions.length > 0 ? {} : { reason: 'No active missions are available.' })
			},
			{
				id: 'control.session.launch',
				label: 'Launch root agent session',
				command: '/launch',
				scope: 'mission',
				enabled: control.settingsComplete,
				flow: {
					targetLabel: 'AGENT',
					actionLabel: 'LAUNCH',
					steps: []
				},
				...(control.settingsComplete ? {} : { reason: 'Complete setup before launching a root agent session.' })
			},
			{
				id: 'control.issues.list',
				label: 'Browse open GitHub issues',
				command: '/issues',
				scope: 'mission',
				enabled: issuesReady,
				...(issuesReady ? {} : { reason: this.describeIssueIntakeUnavailable(control) })
			}
		];

		return {
			found: false,
			operationalMode: this.resolveOperationalMode(control),
			control,
			agentSessions: this.getControlAgentSessions(),
			availableCommands,
			...(availableMissions.length > 0 ? { availableMissions } : {})
		};
	}

	private async evaluateGate(params: MissionGateEvaluate) {
		const loadedMission = await this.requireMissionContext(params.selector);
		return loadedMission.mission.evaluateGate(params.intent);
	}

	private async transitionMissionStage(params: StageTransition) {
		const loadedMission = await this.requireMissionContext(params.selector);
		await loadedMission.mission.transition(params.toStage);
		const status = await loadedMission.mission.status();
		await this.broadcastMissionStatus(loadedMission.missionId, status);
		return this.decorateMissionStatus(status, 'mission');
	}

	private async deliverMission(params: MissionSelect = {}) {
		const loadedMission = await this.requireMissionContext(params.selector);
		await loadedMission.mission.deliver();
		const status = await loadedMission.mission.status();
		await this.broadcastMissionStatus(loadedMission.missionId, status);
		return this.decorateMissionStatus(status, 'mission');
	}

	private async activateTask(params: TaskSelect) {
		return this.updateTaskState(params, 'active');
	}

	private async blockTask(params: TaskSelect) {
		return this.updateTaskState(params, 'blocked');
	}

	private async completeTask(params: TaskSelect) {
		return this.updateTaskState(params, 'done');
	}

	private async updateTaskState(
		params: TaskSelect,
		nextTaskStatus: MissionTaskState['status']
	) {
		const loadedMission = await this.requireMissionContext(params.selector);
		await loadedMission.mission.updateTaskState(params.taskId, { status: nextTaskStatus });
		const missionStatus = await loadedMission.mission.status();
		await this.broadcastMissionStatus(loadedMission.missionId, missionStatus);
		return this.decorateMissionStatus(missionStatus, 'mission');
	}

	private async listAgentSessions(
		params: MissionSelect = {}
	): Promise<MissionAgentSessionRecord[]> {
		if (!params.selector?.missionId) {
			return this.getControlAgentSessions();
		}
		const loadedMission = await this.requireMissionContext(params.selector);
		return loadedMission.mission.getAgentSessions();
	}

	private async launchControlSession(params: ControlSessionLaunch): Promise<MissionAgentSessionRecord> {
		await this.ensureRepositoryInitialized();
		const settings = getDefaultMissionRepoSettingsWithOverrides(readMissionRepoSettings(this.repoRoot) ?? {});
		if (!settings.agentRunner?.trim()) {
			throw new Error('Mission control agent runner is not configured. Run /setup first.');
		}

		const runtimeId = this.resolveConfiguredControlRuntimeId(settings.agentRunner);
		const runtime = this.requireRuntime(runtimeId);
		const availability = await runtime.isAvailable();
		if (!availability.available) {
			throw new Error(availability.detail ?? `${runtime.displayName} is unavailable.`);
		}

		const request = params.request;
		const existingRecord = request?.sessionId ? this.getControlAgentSession(request.sessionId) : undefined;
		let managed = request?.sessionId ? this.controlManagedSessions.get(request.sessionId) : undefined;
		if (managed && managed.runtimeId !== runtime.id) {
			throw new Error(
				`Mission control session '${managed.sessionId}' is attached to runtime '${managed.runtimeId}', not '${runtime.id}'.`
			);
		}

		if (!managed || request?.startFreshSession === true) {
			if (managed) {
				this.detachControlAgentSession(managed.sessionId);
			}

			if (request?.sessionId && !runtime.resumeSession && !request.startFreshSession) {
				throw new Error(
					`${runtime.displayName} cannot resume session '${request.sessionId}'. Start a fresh session instead.`
				);
			}

			const session: MissionAgentSession =
				request?.sessionId && runtime.resumeSession
					? await runtime.resumeSession(request.sessionId)
					: await runtime.createSession();
			managed = this.attachControlAgentSession(runtime, session, {
				createdAt: existingRecord?.createdAt ?? new Date().toISOString(),
				assignmentLabel: existingRecord?.assignmentLabel ?? this.repoRoot
			});
			await managed.persist();
		}

		await managed.submitTurn({
			workingDirectory: request?.workingDirectory ?? this.repoRoot,
			prompt: request?.prompt ?? 'You are attached to the repository root. Enter standby, but treat the next plain-text operator message in this session as the active instruction to follow.',
			scope: request?.scope ?? this.createControlAgentScope(),
			title: request?.title ?? 'Repository root operator session',
			...(request?.operatorIntent ? { operatorIntent: request.operatorIntent } : {}),
			...(request?.startFreshSession !== undefined ? { startFreshSession: request.startFreshSession } : {})
		});

		return this.requirePersistedControlAgentSession(managed.sessionId);
	}

	private async launchTaskSession(params: TaskLaunch) {
		const loadedMission = await this.requireMissionContext(params.selector);
		const request = await this.buildTaskLaunchRequest(loadedMission, params.taskId, params.request);
		const runtimeId = this.resolveRuntimeId(request.runtimeId);
		const session = await loadedMission.mission.launchAgentSession({
			...request,
			taskId: params.taskId,
			runtimeId
		});
		void this.broadcastMissionStatusSnapshot(loadedMission);
		return session;
	}

	private async buildTaskLaunchRequest(
		loadedMission: LoadedMission,
		taskId: string,
		overrides: TaskLaunch['request'] = {}
	): Promise<Omit<MissionAgentSessionLaunchRequest, 'taskId' | 'runtimeId'> & { runtimeId?: string }> {
		const status = await loadedMission.mission.status();
		const task = [...(status.activeTasks ?? []), ...(status.readyTasks ?? []), ...(status.stages ?? []).flatMap((stage) => stage.tasks)]
			.find((candidate) => candidate.taskId === taskId);
		if (!task) {
			throw new Error(`Mission task '${taskId}' could not be resolved.`);
		}
		return {
			...(overrides.runtimeId ? { runtimeId: overrides.runtimeId } : {}),
			workingDirectory: overrides.workingDirectory ?? status.missionDir ?? this.repoRoot,
			prompt: overrides.prompt ?? task.instruction,
			title: overrides.title ?? task.subject,
			assignmentLabel: overrides.assignmentLabel ?? task.relativePath,
			scope: overrides.scope ?? {
				kind: 'slice',
				sliceTitle: task.subject,
				verificationTargets: [],
				requiredSkills: [],
				dependsOn: [...task.dependsOn],
				...(status.missionId ? { missionId: status.missionId } : {}),
				...(status.missionDir ? { missionDir: status.missionDir } : {}),
				...(task.stage ? { stage: task.stage } : {}),
				...(task.taskId ? { taskId: task.taskId } : {}),
				...(task.subject ? { taskTitle: task.subject } : {}),
				...(task.subject ? { taskSummary: task.subject } : {}),
				...(task.instruction ? { taskInstruction: task.instruction } : {})
			},
			...(overrides.operatorIntent ? { operatorIntent: overrides.operatorIntent } : {}),
			startFreshSession: overrides.startFreshSession ?? true
		};
	}

	private async getAgentConsoleState(
		params: SessionConsoleState
	): Promise<MissionAgentConsoleState | null> {
		if (!params.selector?.missionId) {
			return this.controlManagedSessions.get(params.sessionId)?.getConsoleState() ?? null;
		}
		const loadedMission = await this.requireMissionSession(params);
		return loadedMission.mission.getAgentConsoleState(params.sessionId) ?? null;
	}

	private async submitAgentTurn(params: SessionTurnSubmit) {
		if (!params.selector?.missionId) {
			const managed = this.requireControlManagedSession(params.sessionId);
			await managed.submitTurn(params.request);
			return this.requirePersistedControlAgentSession(params.sessionId);
		}
		const loadedMission = await this.requireMissionSession(params);
		return loadedMission.mission.submitAgentTurn(params.sessionId, params.request);
	}

	private async sendAgentInput(params: SessionInput) {
		if (!params.selector?.missionId) {
			const managed = this.requireControlManagedSession(params.sessionId);
			try {
				await managed.sendInput(params.text);
			} catch (error) {
				const shouldRestartTurn = this.shouldRestartControlSessionFromInput(error, managed.getSessionState().lifecycleState);
				if (!shouldRestartTurn) {
					throw error;
				}
				await managed.submitTurn(this.buildControlFollowUpTurnRequest(managed, params.text));
			}
			return this.requirePersistedControlAgentSession(params.sessionId);
		}
		const loadedMission = await this.requireMissionSession(params);
		return loadedMission.mission.sendAgentInput(params.sessionId, params.text);
	}

	private shouldRestartControlSessionFromInput(
		error: unknown,
		lifecycleState: MissionAgentSessionRecord['lifecycleState']
	): boolean {
		if (lifecycleState === 'completed' || lifecycleState === 'failed' || lifecycleState === 'cancelled') {
			return true;
		}
		const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
		return message.includes('not currently waiting for operator input');
	}

	private buildControlFollowUpTurnRequest(managed: AgentSession, prompt: string): MissionAgentTurnRequest {
		const state = managed.getSessionState();
		return {
			workingDirectory: state.workingDirectory ?? this.repoRoot,
			prompt,
			...(state.scope ? { scope: state.scope } : { scope: this.createControlAgentScope() }),
			...(state.currentTurnTitle ? { title: state.currentTurnTitle } : { title: 'Repository root operator session' }),
			operatorIntent: 'Treat this as the next operator instruction for the repository root session.',
			startFreshSession: false
		};
	}

	private async resizeAgentSession(params: SessionResize) {
		if (!params.selector?.missionId) {
			const managed = this.requireControlManagedSession(params.sessionId);
			const cols = Math.max(1, Math.floor(params.cols));
			const rows = Math.max(1, Math.floor(params.rows));
			await managed.resize({ cols, rows });
			return this.requirePersistedControlAgentSession(params.sessionId);
		}
		const loadedMission = await this.requireMissionSession(params);
		return loadedMission.mission.resizeAgentSession(params.sessionId, {
			cols: params.cols,
			rows: params.rows
		});
	}

	private async cancelAgentSession(params: SessionControl) {
		if (!params.selector?.missionId) {
			const managed = this.requireControlManagedSession(params.sessionId);
			await managed.cancel(params.reason);
			return this.requirePersistedControlAgentSession(params.sessionId);
		}
		const loadedMission = await this.requireMissionSession(params);
		return loadedMission.mission.cancelAgentSession(params.sessionId, params.reason);
	}

	private async terminateAgentSession(params: SessionControl) {
		if (!params.selector?.missionId) {
			const managed = this.requireControlManagedSession(params.sessionId);
			await managed.terminate(params.reason);
			return this.requirePersistedControlAgentSession(params.sessionId);
		}
		const loadedMission = await this.requireMissionSession(params);
		return loadedMission.mission.terminateAgentSession(params.sessionId, params.reason);
	}

	private async listOpenGitHubIssues(
		params: ControlIssuesList = {}
	): Promise<TrackedIssueSummary[]> {
		const settings = readMissionRepoSettings(this.repoRoot);
		if (settings?.trackingProvider !== 'github') {
			return [];
		}

		const adapter = new GitHubPlatformAdapter(this.repoRoot);
		return adapter.listOpenIssues(params.limit ?? 50);
	}

	private writeToSocket(socket: Socket, message: Message): void {
		if (socket.destroyed) {
			return;
		}

		socket.write(`${JSON.stringify(message)}\n`);
	}

	private broadcast(message: Message): void {
		for (const client of this.clients) {
			this.writeToSocket(client, message);
		}
	}

	private async broadcastMissionStatus(missionId: string, status: MissionStatus): Promise<void> {
		this.broadcast({
			type: 'event',
			event: {
				type: 'mission.status',
				missionId,
				status: await this.decorateMissionStatus(status, 'mission')
			}
		});
	}

	private async broadcastMissionStatusSnapshot(loadedMission: LoadedMission): Promise<void> {
		const status = await loadedMission.mission.status();
		await this.broadcastMissionStatus(loadedMission.missionId, status);
	}

	private async decorateMissionStatus(
		status: MissionStatus,
		operationalMode: Extract<MissionOperationalMode, 'root' | 'mission'>,
		options: { availableMissionCount?: number } = {}
	): Promise<MissionStatus> {
		const control = await this.buildControlPlaneStatus(options.availableMissionCount);
		return {
			...status,
			operationalMode: operationalMode === 'mission' ? 'mission' : this.resolveOperationalMode(control),
			control
		};
	}

	private async isRepositoryInitialized(): Promise<boolean> {
		try {
			await Promise.all([
				fs.access(getMissionSettingsPath(this.repoRoot)),
				fs.access(getMissionWorktreesPath(this.repoRoot))
			]);
			return true;
		} catch {
			return false;
		}
	}

	private async buildControlPlaneStatus(
		availableMissionCount?: number
	): Promise<MissionControlPlaneStatus> {
		const settings = readMissionRepoSettings(this.repoRoot);
		const effectiveSettings = getDefaultMissionRepoSettingsWithOverrides(settings ?? {});
		const githubRepository = settings?.trackingProvider === 'github'
			? resolveGitHubRepositoryFromWorkspace(this.repoRoot)
			: undefined;
		const issuesConfigured = settings?.trackingProvider === 'github' && Boolean(githubRepository);
		const problems: string[] = [];
		const warnings: string[] = [];
		const isGitRepository = this.store.isGitRepository();
		const initialized = await this.isRepositoryInitialized();
		if (!isGitRepository) {
			problems.push('Mission requires a Git repository.');
		}
		if (!initialized) {
			problems.push('Mission control scaffolding is missing.');
		}
		if (!settings) {
			problems.push('Mission settings are missing.');
		}
		if (!effectiveSettings.agentRunner) {
			problems.push('Mission control agent runner is not configured.');
		}
		if (!effectiveSettings.defaultAgentMode) {
			problems.push('Mission control default agent mode is not configured.');
		}
		if (!effectiveSettings.defaultModel) {
			problems.push('Mission control default model is not configured.');
		}
		if (settings?.trackingProvider === 'github' && !githubRepository) {
			warnings.push('Mission could not resolve a GitHub repository from the current workspace.');
		}

		let githubAuthenticated: boolean | undefined;
		let githubUser: string | undefined;
		let githubAuthMessage: string | undefined;
		if (settings?.trackingProvider === 'github') {
			const auth = this.getGitHubAuthStatus();
			githubAuthenticated = auth.authenticated;
			githubUser = auth.user;
			githubAuthMessage = auth.detail;
			if (!auth.authenticated && auth.detail) {
				warnings.push(auth.detail);
			}
		}

		return {
			controlRepoRoot: this.repoRoot,
			missionDirectory: getMissionDirectoryPath(this.repoRoot),
			settingsPath: getMissionSettingsPath(this.repoRoot),
			worktreesPath: getMissionWorktreesPath(this.repoRoot),
			...(isGitRepository ? { currentBranch: this.store.getCurrentBranch() } : {}),
			settings: effectiveSettings,
			isGitRepository,
			initialized,
			settingsPresent: settings !== undefined,
			settingsComplete: problems.length === 0,
			...(settings?.trackingProvider ? { trackingProvider: settings.trackingProvider } : {}),
			...(githubRepository ? { githubRepository } : {}),
			issuesConfigured,
			...(githubAuthenticated !== undefined ? { githubAuthenticated } : {}),
			...(githubUser ? { githubUser } : {}),
			...(githubAuthMessage ? { githubAuthMessage } : {}),
			...(this.controlAgentSessions.length > 0 ? { agentSessions: this.getControlAgentSessions() } : {}),
			availableMissionCount:
				availableMissionCount ?? (await this.store.listMissions()).length,
			problems,
			warnings
		};
	}

	private resolveOperationalMode(control: MissionControlPlaneStatus): Extract<MissionOperationalMode, 'setup' | 'root'> {
		return control.problems.length > 0 ? 'setup' : 'root';
	}

	private buildSetupCommandFlow(
		control: MissionControlPlaneStatus
	): MissionCommandFlowDescriptor {
		return {
			targetLabel: 'SETUP',
			actionLabel: 'SAVE',
			steps: [
				{
					kind: 'selection',
					id: 'field',
					label: 'SETTING',
					title: 'SETUP',
					emptyLabel: 'No setup fields are available.',
					helperText: 'Choose the setting you want to update.',
					selectionMode: 'single',
					options: this.buildSetupCommandFlowOptions(control)
				},
				{
					kind: 'text',
					id: 'value',
					label: 'VALUE',
					title: 'SETTING VALUE',
					helperText: 'Enter the new value for the selected setting.',
					placeholder: 'Enter the updated value',
					inputMode: 'compact',
					format: 'plain'
				}
			]
		};
	}

	private buildSetupCommandFlowOptions(
		control: MissionControlPlaneStatus
	): MissionCommandFlowOption[] {
		return [
			{
				id: 'agentRunner',
				label: 'Agent Runner',
				description: control.settings.agentRunner?.trim() || 'Required'
			},
			{
				id: 'defaultAgentMode',
				label: 'Default Agent Mode',
				description: control.settings.defaultAgentMode?.trim() || 'Required'
			},
			{
				id: 'defaultModel',
				label: 'Default Model',
				description: control.settings.defaultModel?.trim() || 'Required'
			},
			{
				id: 'instructionsPath',
				label: 'Instructions Path',
				description: control.settings.instructionsPath?.trim() || '.agents'
			},
			{
				id: 'skillsPath',
				label: 'Skills Path',
				description: control.settings.skillsPath?.trim() || '.agents/skills'
			}
		];
	}

	private buildMissionStartFlow(): MissionCommandFlowDescriptor {
		return {
			targetLabel: 'MISSION',
			actionLabel: 'START',
			steps: [
				{
					kind: 'selection',
					id: 'type',
					label: 'TYPE',
					title: 'MISSION TYPE',
					emptyLabel: 'No mission types are available.',
					helperText: 'Choose the primary mission type.',
					selectionMode: 'single',
					options: this.buildMissionTypeOptions()
				},
				{
					kind: 'text',
					id: 'title',
					label: 'TITLE',
					title: 'MISSION TITLE',
					helperText: 'Enter a short mission title.',
					placeholder: 'Summarize the mission',
					inputMode: 'compact',
					format: 'plain'
				},
				{
					kind: 'text',
					id: 'body',
					label: 'BODY',
					title: 'MISSION BODY',
					helperText: 'Describe the mission in Markdown. Enter submits, Shift+Enter adds a newline, and Ctrl+P or Tab toggles preview.',
					placeholder: 'Describe the mission scope, constraints, and expected outcome.',
					inputMode: 'expanded',
					format: 'markdown'
				}
			]
		};
	}

	private buildMissionTypeOptions(): MissionCommandFlowOption[] {
		return [
			{
				id: 'feature',
				label: 'Feature',
				description: 'Add or extend product behavior.'
			},
			{
				id: 'fix',
				label: 'Fix',
				description: 'Correct broken or incorrect behavior.'
			},
			{
				id: 'docs',
				label: 'Docs',
				description: 'Improve or create documentation.'
			},
			{
				id: 'refactor',
				label: 'Refactor',
				description: 'Reshape internals without changing intent.'
			},
			{
				id: 'task',
				label: 'Task',
				description: 'Operational or maintenance work.'
			}
		];
	}

	private buildMissionSwitchFlow(
		availableMissions: MissionSelectionCandidate[]
	): MissionCommandFlowDescriptor {
		return {
			targetLabel: 'MISSION',
			actionLabel: 'SWITCH',
			steps: [
				{
					kind: 'selection',
					id: 'mission',
					label: 'MISSION',
					title: 'SELECT MISSION',
					emptyLabel: 'No missions are available under .mission/worktrees.',
					helperText: 'Choose the mission you want to open.',
					selectionMode: 'single',
					options: availableMissions.map((candidate) => ({
						id: candidate.missionId,
						label: candidate.title,
						description: `${candidate.missionId} | ${candidate.branchRef}`
					}))
				}
			]
		};
	}

	private async writeControlSetting(
		field: ControlSettingsUpdate['field'],
		rawValue: string
	): Promise<void> {
		const nextSettings: MissionRepoSettings = getDefaultMissionRepoSettingsWithOverrides(
			readMissionRepoSettings(this.repoRoot) ?? {}
		);
		const value = rawValue.trim();

		switch (field) {
			case 'agentRunner':
				if (value.length === 0) {
					delete nextSettings.agentRunner;
					break;
				}
				if (value !== 'copilot') {
					throw new Error(`Unsupported Mission agent runner '${value}'.`);
				}
				nextSettings.agentRunner = value;
				break;
			case 'defaultAgentMode':
				if (value.length === 0) {
					delete nextSettings.defaultAgentMode;
					break;
				}
				if (value !== 'interactive' && value !== 'autonomous') {
					throw new Error(`Unsupported Mission default agent mode '${value}'.`);
				}
				nextSettings.defaultAgentMode = value;
				break;
			case 'defaultModel':
				if (value.length === 0) {
					delete nextSettings.defaultModel;
					break;
				}
				nextSettings.defaultModel = value;
				break;
			case 'instructionsPath':
				if (value.length === 0) {
					delete nextSettings.instructionsPath;
					break;
				}
				nextSettings.instructionsPath = value;
				break;
			case 'skillsPath':
				if (value.length === 0) {
					delete nextSettings.skillsPath;
					break;
				}
				nextSettings.skillsPath = value;
				break;
			default:
				throw new Error(`Unsupported Mission setting '${field}'.`);
		}

		await writeMissionRepoSettings(this.repoRoot, nextSettings);
	}

	private buildConfiguredAgentContext() {
		const settings = getDefaultMissionRepoSettingsWithOverrides(readMissionRepoSettings(this.repoRoot) ?? {});
		return MissionAgentContext.build(
			settings.defaultAgentMode ? { mode: settings.defaultAgentMode } : undefined
		);
	}

	private describeIssueIntakeUnavailable(control: MissionControlPlaneStatus): string {
		if (!control.issuesConfigured) {
			return 'Mission could not resolve a GitHub repository from the current workspace.';
		}
		if (control.githubAuthenticated === false) {
			return control.githubAuthMessage ?? 'GitHub CLI authentication is required.';
		}
		return 'GitHub issue intake is not ready.';
	}

	private getGitHubAuthStatus(): { authenticated: boolean; user?: string; detail?: string } {
		const cache = this.githubAuthCache;
		const now = Date.now();
		if (cache && now - cache.checkedAt < 10_000) {
			return {
				authenticated: cache.authenticated,
				...(cache.user ? { user: cache.user } : {}),
				...(cache.detail ? { detail: cache.detail } : {})
			};
		}

		const result = spawnSync('gh', ['auth', 'status'], {
			cwd: this.repoRoot,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe']
		});
		const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.find((line) => line.length > 0);
		const authenticated = result.status === 0;
		let user = parseGitHubAuthUser(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
		if (authenticated && !user) {
			const userResult = spawnSync('gh', ['api', 'user', '--jq', '.login'], {
				cwd: this.repoRoot,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore']
			});
			const fallbackUser = userResult.status === 0
				? userResult.stdout.trim()
				: '';
			if (fallbackUser.length > 0) {
				user = fallbackUser;
			}
		}
		this.githubAuthCache = {
			checkedAt: now,
			authenticated,
			...(user ? { user } : {}),
			detail:
				result.error && 'code' in result.error && result.error.code === 'ENOENT'
					? 'GitHub CLI is not installed.'
					: detail ?? (authenticated ? 'GitHub CLI authenticated.' : 'GitHub CLI authentication is required.')
		};
		return {
			authenticated: this.githubAuthCache.authenticated,
			...(this.githubAuthCache.user ? { user: this.githubAuthCache.user } : {}),
			...(this.githubAuthCache.detail ? { detail: this.githubAuthCache.detail } : {})
		};
	}

	private async ensureRepositoryInitialized(): Promise<void> {
		if (await this.isRepositoryInitialized()) {
			return;
		}

		await this.initializeRepositoryIfNeeded();
	}

	private async initializeRepositoryIfNeeded(): Promise<void> {
		if (await this.isRepositoryInitialized()) {
			return;
		}

		await initializeMissionRepository(this.repoRoot);
	}

	private async writeManifest(): Promise<void> {
		if (!this.manifest) {
			return;
		}

		const manifestPath = getDaemonManifestPath(this.repoRoot);
		await fs.mkdir(path.dirname(manifestPath), { recursive: true });
		await fs.writeFile(manifestPath, `${JSON.stringify(this.manifest, null, 2)}\n`, 'utf8');
	}

	private async cleanupRuntimeFiles(): Promise<void> {
		await fs.rm(getDaemonManifestPath(this.repoRoot), { force: true }).catch(() => undefined);
		if (!isNamedPipePath(this.socketPath)) {
			await fs.rm(this.socketPath, { force: true }).catch(() => undefined);
		}
		await fs.rm(getDaemonRuntimePath(this.repoRoot), { recursive: true, force: true }).catch(
			() => undefined
		);
	}

	private async prepareSocketPath(): Promise<void> {
		if (isNamedPipePath(this.socketPath)) {
			return;
		}

		await fs.mkdir(path.dirname(this.socketPath), { recursive: true });
		const socketExists = await fs.lstat(this.socketPath).then(
			() => true,
			() => false
		);
		if (!socketExists) {
			return;
		}

		const activeServer = await this.canConnect(this.socketPath);
		if (activeServer) {
			throw new Error(`Mission daemon is already running at '${this.socketPath}'.`);
		}

		await fs.rm(this.socketPath, { force: true });
	}

	private async canConnect(candidatePath: string): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			const probe = net.createConnection(candidatePath);
			const finalize = (result: boolean) => {
				probe.removeAllListeners();
				probe.destroy();
				resolve(result);
			};

			probe.once('connect', () => {
				finalize(true);
			});
			probe.once('error', () => {
				finalize(false);
			});
		});
	}

	private toErrorResponse(id: string, error: unknown): ErrorResponse {
		return {
			type: 'response',
			id,
			ok: false,
			error: {
				message: error instanceof Error ? error.message : String(error)
			}
		};
	}

	private toMissionParams(params: unknown): MissionSelect {
		if (!params || typeof params !== 'object') {
			return {};
		}

		return params as MissionSelect;
	}

	private async resolveLoadedMission(
		selector: MissionSelector = {},
		options: { allowMissing?: boolean; requireMissionId?: boolean } = {}
	): Promise<LoadedMission | undefined> {
		await this.initializeRepositoryIfNeeded();
		const normalizedSelector = normalizeMissionSelector(selector);

		if (options.requireMissionId && !normalizedSelector.missionId) {
			if (options.allowMissing) {
				return undefined;
			}

			throw new Error('Mission operations require an explicit missionId selector.');
		}

		if (!hasMissionSelector(normalizedSelector)) {
			if (options.allowMissing) {
				return undefined;
			}

			throw new Error('No mission selector was provided.');
		}

		const existing = await this.findLoadedMission(normalizedSelector);
		if (existing) {
			this.assertSelectorMatchesLoadedMission(normalizedSelector, existing);
			return existing;
		}

		const resolvedMission = await this.store.resolveMission(normalizedSelector);
		if (!resolvedMission) {
			if (options.allowMissing) {
				return undefined;
			}

			throw new Error('No active mission could be resolved for this workspace.');
		}

		const mission = await Factory.load(this.store, {
			missionId: resolvedMission.descriptor.missionId,
		});
		if (!mission) {
			throw new Error(`Mission '${resolvedMission.descriptor.missionId}' could not be loaded.`);
		}

		const loadedMission = this.registerLoadedMission(mission);
		this.assertSelectorMatchesLoadedMission(normalizedSelector, loadedMission);
		return loadedMission;
	}

	private async requireMissionContext(selector: MissionSelector = {}): Promise<LoadedMission> {
		const loadedMission = await this.resolveLoadedMission(selector, { requireMissionId: true });
		if (!loadedMission) {
			throw new Error('Mission operations require an explicit missionId selector.');
		}

		return loadedMission;
	}

	private async requireMissionSession(
		params: SessionConsoleState
	): Promise<LoadedMission> {
		const loadedMission = await this.requireMissionContext(params.selector);
		const session = loadedMission.mission.getAgentSession(params.sessionId);
		if (!session) {
			throw new Error(
				`Mission agent session '${params.sessionId}' is not attached to mission '${loadedMission.missionId}'.`
			);
		}

		return loadedMission;
	}

	private async findLoadedMission(selector: MissionSelector): Promise<LoadedMission | undefined> {
		const existingById = selector.missionId ? this.loadedMissions.get(selector.missionId) : undefined;
		if (existingById) {
			await existingById.mission.refresh();
			return existingById;
		}

		for (const loadedMission of this.loadedMissions.values()) {
			if (!this.selectorMatchesLoadedMission(selector, loadedMission)) {
				continue;
			}

			await loadedMission.mission.refresh();
			return loadedMission;
		}

		return undefined;
	}

	private registerLoadedMission(
		mission: Mission,
		options: { autopilotEnabled?: boolean } = {}
	): LoadedMission {
		for (const runtime of this.runtimes.values()) {
			mission.registerAgentRuntime(runtime);
		}

		const record = mission.getRecord();
		const existing = this.loadedMissions.get(record.id);
		if (existing) {
			if (options.autopilotEnabled === true) {
				this.enableAutopilot(existing);
			}
			mission.dispose();
			return existing;
		}

		const loadedMission: LoadedMission = {
			missionId: record.id,
			branchRef: record.branchRef,
			mission,
			autopilotEnabled: options.autopilotEnabled === true,
			autopilotQueue: Promise.resolve(),
			consoleSubscription: { dispose: () => undefined },
			eventSubscription: { dispose: () => undefined },
		};

		loadedMission.consoleSubscription = mission.onDidAgentConsoleEvent((event) => {
			if (!event.state.sessionId) {
				return;
			}
			this.broadcast({
				type: 'event',
				event: {
					type: 'session.console',
					missionId: record.id,
					sessionId: event.state.sessionId,
					event
				}
			});
		});
		loadedMission.eventSubscription = mission.onDidAgentEvent((event) => {
			this.broadcast({
				type: 'event',
				event: {
					type: 'session.event',
					missionId: record.id,
					sessionId: event.state.sessionId,
					event
				}
			});
			const phaseEvent = this.toSessionPhaseNotification(record.id, event);
			if (phaseEvent) {
				this.broadcast({
					type: 'event',
					event: phaseEvent
				});
			}
			void this.broadcastMissionStatusSnapshot(loadedMission);
			this.scheduleAutopilot(loadedMission, event);
		});

		this.loadedMissions.set(loadedMission.missionId, loadedMission);
		void this.broadcastMissionStatusSnapshot(loadedMission);
		this.scheduleAutopilot(loadedMission);
		return loadedMission;
	}

	private enableAutopilot(loadedMission: LoadedMission): void {
		if (loadedMission.autopilotEnabled) {
			return;
		}

		loadedMission.autopilotEnabled = true;
		this.scheduleAutopilot(loadedMission);
	}

	private scheduleAutopilot(
		loadedMission: LoadedMission,
		event?: MissionAgentEvent
	): void {
		if (!loadedMission.autopilotEnabled) {
			return;
		}

		loadedMission.autopilotQueue = loadedMission.autopilotQueue
			.catch(() => undefined)
			.then(async () => {
				if (!this.isLoadedMissionActive(loadedMission) || !loadedMission.autopilotEnabled) {
					return;
				}

				if (event) {
					await this.handleAutopilotEvent(loadedMission, event);
				}

				await this.runAutopilotLoop(loadedMission);
			})
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				this.logLine?.(`Mission autopilot stalled: ${message}`);
			});
	}

	private async handleAutopilotEvent(
		loadedMission: LoadedMission,
		event: MissionAgentEvent
	): Promise<void> {
		switch (event.type) {
			case 'session-completed':
				await this.updateAutopilotTaskState(loadedMission, event.state.sessionId, 'done');
				break;
			case 'session-failed':
			case 'session-cancelled':
				await this.updateAutopilotTaskState(loadedMission, event.state.sessionId, 'blocked');
				break;
			default:
				break;
		}
	}

	private async updateAutopilotTaskState(
		loadedMission: LoadedMission,
		sessionId: string,
		status: MissionTaskState['status']
	): Promise<void> {
		const sessionRecord = loadedMission.mission.getAgentSession(sessionId);
		if (!sessionRecord?.taskId) {
			return;
		}

		const missionStatus = await loadedMission.mission.status();
		const task = this.findTaskState(missionStatus, sessionRecord.taskId);
		if (!task || task.status === status || task.status === 'done') {
			return;
		}

		await loadedMission.mission.updateTaskState(sessionRecord.taskId, { status });
	}

	private async runAutopilotLoop(loadedMission: LoadedMission): Promise<void> {
		for (let iteration = 0; iteration < 50; iteration += 1) {
			if (!this.isLoadedMissionActive(loadedMission) || !loadedMission.autopilotEnabled) {
				return;
			}

			const status = await loadedMission.mission.status();
			if (status.deliveredAt) {
				return;
			}

			const currentStageId = status.stage;
			if (!currentStageId) {
				return;
			}

			const runningTaskIds = new Set(
				(status.agentSessions ?? [])
					.filter((session) => this.isRunningSession(session))
					.flatMap((session) => (session.taskId ? [session.taskId] : []))
			);
			const launchableTaskIds = [
				...(status.activeTasks ?? []).map((task) => task.taskId),
				...(status.readyTasks ?? []).map((task) => task.taskId)
			].filter((taskId, index, taskIds) => taskIds.indexOf(taskId) === index && !runningTaskIds.has(taskId));

			if (launchableTaskIds.length > 0) {
				for (const taskId of launchableTaskIds) {
					await this.launchAutopilotTaskSession(loadedMission, status, taskId);
				}
				return;
			}

			if (runningTaskIds.size > 0) {
				return;
			}

			const currentStage = status.stages?.find((stage) => stage.stage === currentStageId);
			if (!currentStage) {
				return;
			}

			if (currentStage.completedTaskCount !== currentStage.taskCount) {
				return;
			}

			const nextStage = MISSION_STAGES[MISSION_STAGES.indexOf(currentStageId) + 1];
			if (nextStage) {
				await loadedMission.mission.transition(nextStage);
				continue;
			}

			const deliveryGate = await loadedMission.mission.evaluateGate('deliver');
			if (deliveryGate.allowed) {
				await loadedMission.mission.deliver();
			}
			return;
		}

		throw new Error('Mission autopilot exceeded its progress guard without settling.');
	}

	private async launchAutopilotTaskSession(
		loadedMission: LoadedMission,
		status: MissionStatus,
		taskId: string
	): Promise<void> {
		const task = this.findTaskState(status, taskId);
		if (!task) {
			return;
		}

		await loadedMission.mission.launchAgentSession({
			runtimeId: this.resolveRuntimeId(),
			taskId,
			workingDirectory: this.resolveAutopilotWorkingDirectory(status),
			prompt: task.instruction,
			title: task.subject,
			operatorIntent: 'Complete this mission task autonomously and stop when the task is finished.'
		});
	}

	private resolveAutopilotWorkingDirectory(status: MissionStatus): string {
		return status.missionDir ?? this.repoRoot;
	}

	private findTaskState(status: MissionStatus, taskId: string): MissionTaskState | undefined {
		for (const stage of status.stages ?? []) {
			const task = stage.tasks.find((candidate) => candidate.taskId === taskId);
			if (task) {
				return task;
			}
		}

		return undefined;
	}

	private isRunningSession(session: MissionAgentSessionRecord): boolean {
		return (
			session.lifecycleState === 'starting' ||
			session.lifecycleState === 'running' ||
			session.lifecycleState === 'awaiting-input'
		);
	}

	private disposeLoadedMissions(): void {
		for (const loadedMission of this.loadedMissions.values()) {
			loadedMission.consoleSubscription.dispose();
			loadedMission.eventSubscription.dispose();
			loadedMission.mission.dispose();
		}
		this.loadedMissions.clear();
	}

	private assertSelectorMatchesLoadedMission(selector: MissionSelector, loadedMission: LoadedMission): void {
		if (!this.selectorMatchesLoadedMission(selector, loadedMission)) {
			throw new Error(
				selector.missionId
					? `Mission selector '${selector.missionId}' does not match loaded mission '${loadedMission.missionId}'.`
					: `Mission selector does not match loaded mission '${loadedMission.missionId}'.`
			);
		}
	}

	private selectorMatchesLoadedMission(selector: MissionSelector, loadedMission: LoadedMission): boolean {
		if (selector.missionId && selector.missionId !== loadedMission.missionId) {
			return false;
		}

		if (selector.branchRef && selector.branchRef !== loadedMission.branchRef) {
			return false;
		}

		if (
			selector.issueId !== undefined &&
			loadedMission.mission.getRecord().brief.issueId !== selector.issueId
		) {
			return false;
		}

		return true;
	}

	private isLoadedMissionActive(loadedMission: LoadedMission): boolean {
		return this.loadedMissions.get(loadedMission.missionId) === loadedMission;
	}

	private resolveRuntimeId(runtimeId?: string): string {
		if (runtimeId) {
			return this.requireRuntime(runtimeId).id;
		}

		const defaultRuntimeId = this.runtimes.keys().next().value;
		if (!defaultRuntimeId) {
			throw new Error('No mission agent runtimes are configured in the server.');
		}

		return defaultRuntimeId;
	}

	private requireRuntime(runtimeId: string): MissionAgentRuntime {
		const runtime = this.runtimes.get(runtimeId);
		if (!runtime) {
			throw new Error(`Mission agent runtime '${runtimeId}' is not registered in the server.`);
		}
		return runtime;
	}

	private resolveConfiguredControlRuntimeId(agentRunner: string): string {
		return this.resolveRuntimeId(agentRunner);
	}

	private createControlAgentScope() {
		const currentBranch = this.store.getCurrentBranch(this.repoRoot);
		return {
			kind: 'control' as const,
			repoRoot: this.repoRoot,
			repoName: path.basename(this.repoRoot),
			...(currentBranch ? { branch: currentBranch } : {})
		};
	}

	private getControlAgentSessions(): MissionAgentSessionRecord[] {
		return this.controlAgentSessions.map((record) => structuredClone(record));
	}

	private getControlAgentSession(sessionId: string): MissionAgentSessionRecord | undefined {
		const record = this.controlAgentSessions.find((candidate) => candidate.sessionId === sessionId);
		return record ? structuredClone(record) : undefined;
	}

	private requirePersistedControlAgentSession(sessionId: string): MissionAgentSessionRecord {
		const record = this.controlAgentSessions.find((candidate) => candidate.sessionId === sessionId);
		if (!record) {
			throw new Error(`Mission control session '${sessionId}' is not recorded in daemon state.`);
		}
		return structuredClone(record);
	}

	private requireControlManagedSession(sessionId: string): AgentSession {
		const managed = this.controlManagedSessions.get(sessionId);
		if (managed) {
			return managed;
		}
		const persisted = this.controlAgentSessions.find((candidate) => candidate.sessionId === sessionId);
		if (persisted) {
			throw new Error(
				`Mission control session '${sessionId}' is recorded for runtime '${persisted.runtimeId}' but is not attached in this process.`
			);
		}
		throw new Error(`Mission control session '${sessionId}' is not attached to this daemon.`);
	}

	private attachControlAgentSession(
		runtime: MissionAgentRuntime,
		session: MissionAgentSession,
		metadata: AgentSessionMetadata
	): AgentSession {
		const managed = new AgentSession(runtime, session, metadata, {
			persistRecord: async (record) => {
				this.persistControlAgentSessionRecord(record);
			},
			emitConsoleEvent: (event) => {
				if (!event.state.sessionId) {
					return;
				}
				this.broadcast({
					type: 'event',
					event: {
						type: 'session.console',
						missionId: CONTROL_SESSION_CHANNEL_ID,
						sessionId: event.state.sessionId,
						event
					}
				});
			},
			emitEvent: (event) => {
				this.broadcast({
					type: 'event',
					event: {
						type: 'session.event',
						missionId: CONTROL_SESSION_CHANNEL_ID,
						sessionId: event.state.sessionId,
						event
					}
				});
				const phaseEvent = this.toSessionPhaseNotification(CONTROL_SESSION_CHANNEL_ID, event);
				if (phaseEvent) {
					this.broadcast({
						type: 'event',
						event: phaseEvent
					});
				}
			}
		});

		this.controlManagedSessions.set(session.sessionId, managed);
		return managed;
	}

	private detachControlAgentSession(sessionId: string): void {
		const managed = this.controlManagedSessions.get(sessionId);
		if (!managed) {
			return;
		}

		managed.dispose();
		this.controlManagedSessions.delete(sessionId);
	}

	private persistControlAgentSessionRecord(record: MissionAgentSessionRecord): void {
		const nextRecords = this.controlAgentSessions.map((candidate) => structuredClone(candidate));
		const existingIndex = nextRecords.findIndex((candidate) => candidate.sessionId === record.sessionId);
		if (existingIndex >= 0) {
			nextRecords[existingIndex] = structuredClone(record);
		} else {
			nextRecords.push(structuredClone(record));
		}
		this.controlAgentSessions = nextRecords;
	}

	private disposeControlSessions(): void {
		for (const sessionId of this.controlManagedSessions.keys()) {
			this.detachControlAgentSession(sessionId);
		}
		this.controlAgentSessions = [];
	}

	private toSessionPhaseNotification(
		missionId: string,
		event: MissionAgentEvent
	): Notification | undefined {
		switch (event.type) {
			case 'session-started':
			case 'session-resumed':
				return {
					type: 'session.lifecycle',
					missionId,
					sessionId: event.state.sessionId,
					phase: 'spawned',
					lifecycleState: event.state.lifecycleState
				};
			case 'session-state-changed':
				if (
					event.state.lifecycleState === 'running' ||
					event.state.lifecycleState === 'awaiting-input'
				) {
					return {
						type: 'session.lifecycle',
						missionId,
						sessionId: event.state.sessionId,
						phase: 'active',
						lifecycleState: event.state.lifecycleState
					};
				}
				return undefined;
			case 'session-completed':
			case 'session-failed':
			case 'session-cancelled':
				return {
					type: 'session.lifecycle',
					missionId,
					sessionId: event.state.sessionId,
					phase: 'terminated',
					lifecycleState: event.state.lifecycleState
				};
			default:
				return undefined;
		}
	}

	private resolveMissionIssueId(params: ControlMissionStart): number | undefined {
		return typeof params.brief.issueId === 'number' ? params.brief.issueId : undefined;
	}
}

function parseGitHubAuthUser(output: string): string | undefined {
	const patterns = [
		/Logged in to\s+[^\s]+\s+as\s+([A-Za-z0-9-]+)/iu,
		/Logged in to [^\s]+ account\s+([A-Za-z0-9-]+)/u,
		/\baccount\s+([A-Za-z0-9-]+)\b/iu,
		/as\s+([A-Za-z0-9-]+)\s*\(/u,
		/account\s+([A-Za-z0-9-]+)\s*\(/u,
		/\u2713\s+Logged in to\s+[^\s]+\s+account\s+([A-Za-z0-9-]+)/iu,
		/\u2713\s+Logged in to\s+[^\s]+\s+as\s+([A-Za-z0-9-]+)/iu
	];
	const normalizedOutput = output.replace(/\u001b\[[0-9;]*m/gu, '');
	for (const pattern of patterns) {
		const match = pattern.exec(normalizedOutput);
		const user = match?.[1]?.trim();
		if (user) {
			return user;
		}
	}
	return undefined;
}

function requireSingleSelectionCommandStep(
	steps: CommandExecute['steps'],
	stepId: string
): Extract<CommandExecute['steps'][number], { kind: 'selection' }> {
	const step = steps.find((candidate) => candidate.stepId === stepId);
	if (!step || step.kind !== 'selection' || step.optionIds.length !== 1) {
		throw new Error(`Mission command execution requires exactly one selection for step '${stepId}'.`);
	}
	return step;
}

function requireTextCommandStep(
	steps: CommandExecute['steps'],
	stepId: string
): Extract<CommandExecute['steps'][number], { kind: 'text' }> {
	const step = steps.find((candidate) => candidate.stepId === stepId);
	if (!step || step.kind !== 'text') {
		throw new Error(`Mission command execution requires a text value for step '${stepId}'.`);
	}
	return step;
}

function requireSingleValueCommandStep(
	steps: CommandExecute['steps'],
	stepId: string
): string {
	const step = steps.find((candidate) => candidate.stepId === stepId);
	if (!step) {
		throw new Error(`Mission command execution requires a value for step '${stepId}'.`);
	}
	if (step.kind === 'text') {
		return step.value;
	}
	if (step.optionIds.length !== 1) {
		throw new Error(`Mission command execution requires exactly one value for step '${stepId}'.`);
	}
	return step.optionIds[0] ?? '';
}

function asControlSettingField(
	value: string | undefined
): ControlSettingsUpdate['field'] | undefined {
	if (
		value === 'agentRunner'
		|| value === 'defaultAgentMode'
		|| value === 'defaultModel'
		|| value === 'instructionsPath'
		|| value === 'skillsPath'
	) {
		return value;
	}
	return undefined;
}

function asMissionType(value: string | undefined): MissionType | undefined {
	if (
		value === 'feature'
		|| value === 'fix'
		|| value === 'docs'
		|| value === 'refactor'
		|| value === 'task'
	) {
		return value;
	}
	return undefined;
}

function requireCommandMissionSelector(params: CommandExecute): MissionSelector {
	const missionId = params.selector?.missionId?.trim();
	if (!missionId) {
		throw new Error(`Mission command '${params.commandId}' requires an explicit missionId selector.`);
	}
	return { missionId };
}

export async function startDaemon(
	options: { repoRoot: string } & DaemonOptions
): Promise<Daemon> {
	const server = new Daemon(options.repoRoot, options);
	await server.listen();
	return server;
}

function normalizeMissionSelector(selector: MissionSelector = {}): MissionSelector {
	const missionId = selector.missionId?.trim();
	const branchRef = selector.branchRef?.trim();
	return {
		...(missionId ? { missionId } : {}),
		...(selector.issueId !== undefined ? { issueId: selector.issueId } : {}),
		...(branchRef ? { branchRef } : {})
	};
}

function hasMissionSelector(selector: MissionSelector): boolean {
	return Boolean(selector.missionId?.trim() || selector.issueId !== undefined || selector.branchRef?.trim());
}