import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
	AirportControl,
	TerminalManagerSubstrateController,
	createDefaultGateBindings,
	type AirportProjectionSet,
	type AirportState,
	type GateBinding,
	type GateId,
	type PersistedAirportIntent
} from '../../../airport/build/index.js';
import type {
	AgentSessionContext,
	ArtifactContext,
	ContextGraph,
	ContextSelection,
	MissionContext,
	OperatorActionTargetContext,
	OperatorStatus,
	MissionSystemSnapshot,
	MissionSystemState,
	MissionStageId,
	RepositoryContext,
	TaskContext
} from '../types.js';
import {
	getMissionDaemonSettingsPath,
	readMissionDaemonSettings,
	writeMissionDaemonSettings
} from '../lib/daemonConfig.js';
import { resolveAvailableActionsForTargetContext } from '../lib/operatorActionTargeting.js';
import { getWorkspaceRoot } from '../lib/workspacePaths.js';

type RepositoryAirportRecord = {
	repositoryId: string;
	repositoryRootPath: string;
	control: AirportControl;
	serializedPersistedIntent?: string;
};

type MissionSystemObservation = {
	kind: 'operator-status';
	status: OperatorStatus;
};

export class MissionSystemController {
	private readonly airportRegistry = new Map<string, RepositoryAirportRecord>();
	private readonly clientRepositoryIndex = new Map<string, string>();
	private activeRepositoryId?: string;
	private version = 0;
	private domain: ContextGraph = createEmptyContextGraph();
	private serializedState = '';

	public constructor() {
		this.serializedState = this.serializeSystemState();
	}

	public getSnapshot(): MissionSystemSnapshot {
		return this.buildSnapshot();
	}

	public async scopeAirportToSurfacePath(surfacePath?: string): Promise<MissionSystemSnapshot> {
		const normalizedSurfacePath = surfacePath?.trim();
		if (!normalizedSurfacePath) {
			throw new Error('Airport state requires a repository-scoped surface path.');
		}

		const repositoryRootPath = getWorkspaceRoot(normalizedSurfacePath);
		await this.ensureAirportForRepository(repositoryRootPath, repositoryRootPath);
		this.activeRepositoryId = repositoryRootPath;
		return this.commit();
	}

	public async reduce(observation: MissionSystemObservation): Promise<MissionSystemSnapshot> {
		switch (observation.kind) {
			case 'operator-status':
				return this.reduceOperatorStatus(observation.status);
		}
	}

	public async observeOperatorStatus(status: OperatorStatus): Promise<MissionSystemSnapshot> {
		return this.reduce({ kind: 'operator-status', status });
	}

	private async reduceOperatorStatus(status: OperatorStatus): Promise<MissionSystemSnapshot> {
		const nextDomain = deriveContextGraph(status, this.domain.selection);
		const repositoryId = nextDomain.selection.repositoryId;
		if (!repositoryId) {
			throw new Error('Mission system reduction requires a repository-scoped operator status.');
		}

		const repositoryRootPath = nextDomain.repositories[repositoryId]?.rootPath || repositoryId;
		const airport = await this.ensureAirportForRepository(repositoryId, repositoryRootPath);
		this.activeRepositoryId = repositoryId;
		await airport.control.applyDefaultBindings(deriveGateBindings(nextDomain, airport.control.getState().gates.pilot, nextDomain.agentSessions), {
			focusIntent: deriveFocusIntent(nextDomain)
		});
		this.domain = nextDomain;
		return this.commit([repositoryId]);
	}

	public async connectAirportClient(params: {
		clientId: string;
		label?: string;
		surfacePath?: string;
		gateId: GateId;
		panelProcessId?: string;
		terminalSessionName?: string;
	}): Promise<MissionSystemSnapshot> {
		const airport = await this.resolveAirportForRequest(params.clientId, params.surfacePath);
		this.activeRepositoryId = airport.repositoryId;
		this.clientRepositoryIndex.set(params.clientId, airport.repositoryId);
		await airport.control.connectClient(params);
		return this.commit([airport.repositoryId]);
	}

	public async disconnectAirportClient(clientId: string): Promise<MissionSystemSnapshot | undefined> {
		const repositoryId = this.clientRepositoryIndex.get(clientId);
		if (!repositoryId) {
			return undefined;
		}

		const airport = this.airportRegistry.get(repositoryId);
		if (!airport) {
			this.clientRepositoryIndex.delete(clientId);
			return undefined;
		}

		await airport.control.disconnectClient(clientId);
		this.clientRepositoryIndex.delete(clientId);
		return this.commit([repositoryId]);
	}

	public async observeAirportClient(params: {
		clientId: string;
		focusedGateId?: GateId;
		intentGateId?: GateId;
		repositoryId?: string;
		missionId?: string;
		stageId?: string;
		taskId?: string;
		artifactId?: string;
		agentSessionId?: string;
		surfacePath?: string;
	}): Promise<MissionSystemSnapshot> {
		const airport = await this.resolveAirportForRequest(params.clientId, params.surfacePath);
		this.activeRepositoryId = airport.repositoryId;
		this.clientRepositoryIndex.set(params.clientId, airport.repositoryId);
		this.domain = applyObservedSelection(this.domain, {
			...(params.repositoryId ? { repositoryId: params.repositoryId } : {}),
			...(params.missionId ? { missionId: params.missionId } : {}),
			...(params.stageId ? { stageId: params.stageId } : {}),
			...(params.taskId ? { taskId: params.taskId } : {}),
			...(params.artifactId ? { artifactId: params.artifactId } : {}),
			...(params.agentSessionId ? { agentSessionId: params.agentSessionId } : {}),
			fallbackRepositoryId: airport.repositoryId
		});
		await airport.control.observeClient({
			clientId: params.clientId,
			...(params.focusedGateId ? { focusedGateId: params.focusedGateId } : {}),
			...(params.intentGateId ? { intentGateId: params.intentGateId } : {}),
			...(params.surfacePath ? { surfacePath: params.surfacePath } : {})
		});
		return this.commit([airport.repositoryId]);
	}

	public async bindAirportGate(params: {
		gateId: GateId;
		binding: GateBinding;
	}): Promise<MissionSystemSnapshot> {
		const airport = this.getActiveAirportRecord();
		await airport.control.bindGate(params);
		return this.commit([airport.repositoryId]);
	}

	private async commit(touchedRepositoryIds: string[] = []): Promise<MissionSystemSnapshot> {
		const serializedState = this.serializeSystemState();
		if (serializedState !== this.serializedState) {
			this.serializedState = serializedState;
			this.version += 1;
		}

		await this.persistTouchedAirportIntents(touchedRepositoryIds);
		return this.buildSnapshot();
	}

	private buildSnapshot(): MissionSystemSnapshot {
		const activeAirport = this.getActiveAirportRecord();
		const airportRegistryState = Object.fromEntries(
			[...this.airportRegistry.entries()]
				.sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
				.map(([repositoryId, record]) => [
					repositoryId,
					{
						repositoryId,
						repositoryRootPath: record.repositoryRootPath,
						airport: record.control.getState(),
						persistedIntent: record.control.getPersistedIntent()
					}
				])
		);
		const state: MissionSystemState = {
			version: this.version,
			domain: structuredClone(this.domain),
			airport: activeAirport.control.getState(),
			airports: {
				...(this.activeRepositoryId ? { activeRepositoryId: this.activeRepositoryId } : {}),
				repositories: airportRegistryState
			}
		};
		const airportProjections: AirportProjectionSet = deriveSystemAirportProjections(
			this.domain,
			activeAirport.control.getState()
		);
		const airportRegistryProjections = Object.fromEntries(
			[...this.airportRegistry.entries()]
				.sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
				.map(([repositoryId, record]) => [repositoryId, deriveSystemAirportProjections(this.domain, record.control.getState())])
		);
		const actionProjections = deriveSystemActionProjections(this.domain, airportProjections);
		return { state, airportProjections, airportRegistryProjections, actionProjections };
	}

	private serializeSystemState(): string {
		return JSON.stringify({
			domain: this.domain,
			activeRepositoryId: this.activeRepositoryId,
			airports: Object.fromEntries(
				[...this.airportRegistry.entries()]
					.sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
					.map(([repositoryId, record]) => [repositoryId, record.control.getState()])
			)
		});
	}

	private getActiveAirportRecord(): RepositoryAirportRecord {
		if (!this.activeRepositoryId) {
			throw new Error('Airport state is not scoped to a repository.');
		}
		const activeAirport = this.airportRegistry.get(this.activeRepositoryId);
		if (!activeAirport) {
			throw new Error(`Airport '${this.activeRepositoryId}' is not loaded.`);
		}
		return activeAirport;
	}

	private async resolveAirportForRequest(clientId: string, surfacePath?: string): Promise<RepositoryAirportRecord> {
		const normalizedSurfacePath = surfacePath?.trim();
		if (normalizedSurfacePath) {
			const repositoryRootPath = getWorkspaceRoot(normalizedSurfacePath);
			return this.ensureAirportForRepository(repositoryRootPath, repositoryRootPath);
		}

		const repositoryId = this.clientRepositoryIndex.get(clientId) ?? this.activeRepositoryId;
		if (!repositoryId) {
			throw new Error('Airport request requires a repository-scoped surface path or active airport selection.');
		}

		const airport = this.airportRegistry.get(repositoryId);
		if (!airport) {
			throw new Error(`Airport '${repositoryId}' is not loaded.`);
		}
		return airport;
	}

	private async ensureAirportForRepository(repositoryId: string, repositoryRootPath: string): Promise<RepositoryAirportRecord> {
		const existing = this.airportRegistry.get(repositoryId);
		if (existing) {
			return existing;
		}

		const identity = deriveRepositoryAirportIdentity(repositoryId, repositoryRootPath);
		const persistedIntent = this.readPersistedAirportIntent(repositoryRootPath);
		const control = new AirportControl(
			new TerminalManagerSubstrateController({
				sessionName: identity.sessionName
			}),
			{
				airportId: identity.airportId,
				repositoryId,
				repositoryRootPath,
				...(persistedIntent ? { persistedIntent } : {})
			}
		);
		const record: RepositoryAirportRecord = {
			repositoryId,
			repositoryRootPath,
			control,
			serializedPersistedIntent: serializePersistedAirportIntent(persistedIntent)
		};
		this.airportRegistry.set(repositoryId, record);
		return record;
	}

	private readPersistedAirportIntent(repositoryRootPath: string): PersistedAirportIntent | undefined {
		const settings = readMissionDaemonSettings(repositoryRootPath);
		return settings?.airport;
	}

	private async persistTouchedAirportIntents(repositoryIds: string[]): Promise<void> {
		for (const repositoryId of new Set(repositoryIds)) {
			const airport = this.airportRegistry.get(repositoryId);
			if (!airport) {
				continue;
			}

			const nextPersistedIntent = toPersistableAirportIntent(airport);
			const serializedPersistedIntent = serializePersistedAirportIntent(nextPersistedIntent);
			if (serializedPersistedIntent === airport.serializedPersistedIntent) {
				continue;
			}
			if (!(await daemonSettingsExist(airport.repositoryRootPath))) {
				airport.serializedPersistedIntent = serializedPersistedIntent;
				continue;
			}

			const currentSettings = readMissionDaemonSettings(airport.repositoryRootPath) ?? {};
			const { airport: _currentAirport, ...baseSettings } = currentSettings;
			await writeMissionDaemonSettings(
				{
					...baseSettings,
					...(nextPersistedIntent ? { airport: nextPersistedIntent } : {})
				},
				airport.repositoryRootPath
			);
			airport.serializedPersistedIntent = serializedPersistedIntent;
		}
	}
}

function deriveRepositoryAirportIdentity(repositoryId: string, repositoryRootPath: string) {
	const repositoryLabel = slugifyRepositoryLabel(path.basename(repositoryRootPath) || 'repository');
	const repositoryHash = hashRepositoryScope(repositoryRootPath);
	return {
		repositoryId,
		repositoryRootPath,
		airportId: `airport:${repositoryLabel}:${repositoryHash}`,
		sessionName: process.env['MISSION_TERMINAL_SESSION']?.trim()
			|| process.env['MISSION_TERMINAL_SESSION_NAME']?.trim()
			|| `mission-control-${repositoryLabel}-${repositoryHash}`
	};
}

function hashRepositoryScope(repositoryRootPath: string): string {
	return createHash('sha1').update(repositoryRootPath).digest('hex').slice(0, 8);
}

function slugifyRepositoryLabel(value: string): string {
	const normalizedValue = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return normalizedValue || 'repository';
}

function serializePersistedAirportIntent(intent: PersistedAirportIntent | undefined): string {
	return JSON.stringify(intent ?? null);
}

function toPersistableAirportIntent(record: RepositoryAirportRecord): PersistedAirportIntent | undefined {
	const currentIntent = record.control.getPersistedIntent();
	const defaultIntent: PersistedAirportIntent = {
		gates: createDefaultGateBindings(record.repositoryId)
	};
	return serializePersistedAirportIntent(currentIntent) === serializePersistedAirportIntent(defaultIntent)
		? undefined
		: currentIntent;
}

async function daemonSettingsExist(repositoryRootPath: string): Promise<boolean> {
	try {
		await fs.access(getMissionDaemonSettingsPath(repositoryRootPath));
		return true;
	} catch {
		return false;
	}
}

function createEmptyContextGraph(): ContextGraph {
	return {
		selection: {},
		repositories: {},
		missions: {},
		tasks: {},
		artifacts: {},
		agentSessions: {},
		availableActions: []
	};
}

function deriveContextGraph(
	status: OperatorStatus,
	previousSelection: ContextSelection = {}
): ContextGraph {
	const repositoryId = status.control?.controlRoot?.trim() || 'repository';
	const missionCandidatesById = new Map(
		(status.availableMissions ?? []).map((candidate) => [candidate.missionId, candidate] as const)
	);
	const missionIds = Array.from(
		new Set([
			...missionCandidatesById.keys(),
			...(status.missionId ? [status.missionId] : [])
		].filter((value) => value.trim().length > 0))
	);
	const tasks = dedupeTasks(status);
	const taskContexts = Object.fromEntries(tasks.map((task) => {
		const sessionIds = (status.agentSessions ?? [])
			.filter((session) => session.taskId === task.taskId)
			.map((session) => session.sessionId);
		const taskContext: TaskContext = {
			taskId: task.taskId,
			...(status.missionId ? { missionId: status.missionId } : {}),
			stageId: task.stage,
			subject: task.subject,
			instructionSummary: task.instruction,
			lifecycleState: task.status,
			dependencyIds: [...task.dependsOn],
			...(sessionIds.length > 0 ? { agentSessionIds: sessionIds } : {})
		};
		return [task.taskId, taskContext] as const;
	}));
	const artifacts = Object.fromEntries(
		Object.entries(status.productFiles ?? {}).map(([artifactKey, artifactPath]) => {
			const artifactId = buildArtifactId(status, artifactKey);
			const artifactContext: ArtifactContext = {
				artifactId,
				...(status.missionId ? { missionId: status.missionId } : { repositoryId }),
				filePath: artifactPath,
				logicalKind: artifactKey,
				displayLabel: path.basename(artifactPath)
			};
			return [artifactId, artifactContext] as const;
		})
	);
	const agentSessions = Object.fromEntries(
		(status.agentSessions ?? []).map((session) => {
			const sessionContext: AgentSessionContext = {
				sessionId: session.sessionId,
				...(status.missionId ? { missionId: status.missionId } : {}),
				...(session.taskId ? { taskId: session.taskId } : {}),
				runtimeId: session.runtimeId,
				lifecycleState: session.lifecycleState,
				...(session.workingDirectory ? { workingDirectory: session.workingDirectory } : {}),
				...(session.currentTurnTitle ? { promptTitle: session.currentTurnTitle } : {}),
				...(session.transportId ? { transportId: session.transportId } : {})
			};
			return [session.sessionId, sessionContext] as const;
		})
	);
	const repositories: Record<string, RepositoryContext> = {
		[repositoryId]: {
			repositoryId,
			rootPath: status.control?.controlRoot || repositoryId,
			displayLabel: path.basename(status.control?.controlRoot || repositoryId),
			missionIds,
			...(status.control?.settingsPath ? { workflowSettingsId: status.control.settingsPath } : {})
		}
	};
	const missions: Record<string, MissionContext> = Object.fromEntries(
		missionIds.map((missionId) => {
			const candidate = missionCandidatesById.get(missionId);
			const isActiveMission = status.missionId === missionId;
			const missionContext: MissionContext = {
				missionId,
				repositoryId,
				briefSummary: candidate?.title || (isActiveMission ? status.title : undefined) || status.type || missionId,
				...(candidate?.issueId !== undefined
					? { issueId: candidate.issueId }
					: isActiveMission && status.issueId !== undefined
						? { issueId: status.issueId }
						: {}),
				...(candidate?.branchRef
					? { branchRef: candidate.branchRef }
					: isActiveMission && status.branchRef
						? { branchRef: status.branchRef }
						: {}),
				...(candidate?.createdAt ? { createdAt: candidate.createdAt } : {}),
				workspacePath: isActiveMission
					? status.missionDir || status.missionRootDir || status.control?.controlRoot || repositoryId
					: status.control?.controlRoot || repositoryId,
				...(isActiveMission && status.stage ? { currentStage: status.stage } : {}),
				...(isActiveMission && status.workflow?.lifecycle ? { lifecycleState: status.workflow.lifecycle } : {}),
				taskIds: isActiveMission ? tasks.map((task) => task.taskId) : [],
				artifactIds: isActiveMission ? Object.keys(artifacts) : [],
				sessionIds: isActiveMission ? Object.keys(agentSessions) : [],
				...(isActiveMission && status.tower
					? {
						tower: {
							stageRail: status.tower.stageRail.map((item) => ({ ...item })),
							treeNodes: status.tower.treeNodes.map((node) => ({ ...node }))
						}
					}
					: {})
			};
			return [missionId, missionContext] as const;
		})
	);
	const selection = resolveContextSelection({
		status,
		previousSelection,
		repositoryId,
		missions,
		tasks: taskContexts,
		artifacts,
		agentSessions
	});

	return {
		selection,
		repositories,
		missions,
		tasks: taskContexts,
		artifacts,
		agentSessions,
		availableActions: (status.availableActions ?? []).map((action) => structuredClone(action))
	};
}

function resolveContextSelection(input: {
	status: OperatorStatus;
	previousSelection: ContextSelection;
	repositoryId: string;
	missions: Record<string, MissionContext>;
	tasks: Record<string, TaskContext>;
	artifacts: Record<string, ArtifactContext>;
	agentSessions: Record<string, AgentSessionContext>;
}): ContextSelection {
	const heuristicTaskId = pickSelectedTaskId(input.status);
	const heuristicArtifactId = pickSelectedArtifactId(input.status);
	const heuristicSessionId = pickSelectedSessionId(input.status);
	const missionId = resolveSelectedMissionId(input);
	const taskId = resolveSelectedTaskId(input, missionId, heuristicTaskId);
	const artifactId = resolveSelectedArtifactId(input, missionId, heuristicArtifactId);
	const agentSessionId = resolveSelectedSessionId(input, missionId, heuristicSessionId);
	const stageId = resolveSelectedStageId(input, missionId, taskId, agentSessionId);
	return {
		repositoryId: input.repositoryId,
		...(missionId ? { missionId } : {}),
		...(stageId ? { stageId } : {}),
		...(taskId ? { taskId } : {}),
		...(artifactId ? { artifactId } : {}),
		...(agentSessionId ? { agentSessionId } : {})
	};
}

function resolveSelectedMissionId(input: {
	status: OperatorStatus;
	previousSelection: ContextSelection;
	missions: Record<string, MissionContext>;
}): string | undefined {
	const previousMissionId = input.previousSelection.missionId;
	if (previousMissionId && previousMissionId in input.missions) {
		return previousMissionId;
	}
	const statusMissionId = input.status.missionId?.trim();
	return statusMissionId && statusMissionId in input.missions ? statusMissionId : statusMissionId;
}

function resolveSelectedTaskId(input: {
	previousSelection: ContextSelection;
	tasks: Record<string, TaskContext>;
}, missionId: string | undefined, heuristicTaskId: string | undefined): string | undefined {
	const previousTaskId = input.previousSelection.taskId;
	if (previousTaskId && isTaskSelectionValid(previousTaskId, missionId, input.tasks)) {
		return previousTaskId;
	}
	if (hasExplicitNonTaskSelection(input.previousSelection)) {
		return undefined;
	}
	if (heuristicTaskId && isTaskSelectionValid(heuristicTaskId, missionId, input.tasks)) {
		return heuristicTaskId;
	}
	return undefined;
}

function resolveSelectedArtifactId(input: {
	previousSelection: ContextSelection;
	artifacts: Record<string, ArtifactContext>;
}, missionId: string | undefined, heuristicArtifactId: string | undefined): string | undefined {
	const previousArtifactId = input.previousSelection.artifactId;
	if (previousArtifactId && isArtifactSelectionValid(previousArtifactId, missionId, input.artifacts)) {
		return previousArtifactId;
	}
	if (hasExplicitNonArtifactSelection(input.previousSelection)) {
		return undefined;
	}
	if (heuristicArtifactId && isArtifactSelectionValid(heuristicArtifactId, missionId, input.artifacts)) {
		return heuristicArtifactId;
	}
	return undefined;
}

function resolveSelectedSessionId(input: {
	previousSelection: ContextSelection;
	agentSessions: Record<string, AgentSessionContext>;
}, missionId: string | undefined, heuristicSessionId: string | undefined): string | undefined {
	const previousSessionId = input.previousSelection.agentSessionId;
	if (previousSessionId && isSessionSelectionValid(previousSessionId, missionId, input.agentSessions)) {
		return previousSessionId;
	}
	if (hasExplicitNonSessionSelection(input.previousSelection)) {
		return undefined;
	}
	if (heuristicSessionId && isSessionSelectionValid(heuristicSessionId, missionId, input.agentSessions)) {
		return heuristicSessionId;
	}
	return undefined;
}

function resolveSelectedStageId(input: {
	status: OperatorStatus;
	previousSelection: ContextSelection;
	tasks: Record<string, TaskContext>;
	agentSessions: Record<string, AgentSessionContext>;
}, missionId: string | undefined, taskId: string | undefined, sessionId: string | undefined): MissionStageId | undefined {
	if (taskId) {
		return input.tasks[taskId]?.stageId;
	}
	if (sessionId) {
		const sessionTaskId = input.agentSessions[sessionId]?.taskId;
		return sessionTaskId ? input.tasks[sessionTaskId]?.stageId : undefined;
	}
	const previousStageId = input.previousSelection.stageId;
	if (previousStageId && isStageSelectionValid(previousStageId, missionId, input.status)) {
		return previousStageId;
	}
	return input.status.stage;
}

function isTaskSelectionValid(
	taskId: string,
	missionId: string | undefined,
	tasks: Record<string, TaskContext>
): boolean {
	const task = tasks[taskId];
	if (!task) {
		return false;
	}
	return !missionId || task.missionId === missionId;
}

function isArtifactSelectionValid(
	artifactId: string,
	missionId: string | undefined,
	artifacts: Record<string, ArtifactContext>
): boolean {
	const artifact = artifacts[artifactId];
	if (!artifact) {
		return false;
	}
	return !missionId || artifact.missionId === missionId;
}

function isSessionSelectionValid(
	sessionId: string,
	missionId: string | undefined,
	agentSessions: Record<string, AgentSessionContext>
): boolean {
	const session = agentSessions[sessionId];
	if (!session) {
		return false;
	}
	return !missionId || session.missionId === missionId;
}

function isStageSelectionValid(
	stageId: MissionStageId,
	missionId: string | undefined,
	status: OperatorStatus
): boolean {
	if (!missionId) {
		return false;
	}
	return (status.stages ?? []).some((stage) => stage.stage === stageId)
		|| (status.tower?.stageRail ?? []).some((stage) => stage.id === stageId);
}

function hasExplicitNonTaskSelection(selection: ContextSelection): boolean {
	return Boolean(selection.stageId || selection.artifactId || selection.agentSessionId);
}

function hasExplicitNonArtifactSelection(selection: ContextSelection): boolean {
	return Boolean(selection.stageId || selection.taskId || selection.agentSessionId);
}

function hasExplicitNonSessionSelection(selection: ContextSelection): boolean {
	return Boolean(selection.stageId || selection.taskId || selection.artifactId);
}

function applyObservedSelection(input: ContextGraph, observed: {
	repositoryId?: string;
	missionId?: string;
	stageId?: string;
	taskId?: string;
	artifactId?: string;
	agentSessionId?: string;
	fallbackRepositoryId?: string;
}): ContextGraph {
	const repositoryId = observed.repositoryId?.trim() || observed.fallbackRepositoryId || input.selection.repositoryId;
	const missionId = observed.missionId?.trim();
	const taskId = observed.taskId?.trim();
	const artifactId = observed.artifactId?.trim();
	const agentSessionId = observed.agentSessionId?.trim();
	const selectedMissionId = missionId && missionId in input.missions
		? missionId
		: taskId && input.tasks[taskId]?.missionId
			? input.tasks[taskId]?.missionId
			: artifactId && input.artifacts[artifactId]?.missionId
				? input.artifacts[artifactId]?.missionId
				: agentSessionId && input.agentSessions[agentSessionId]?.missionId
					? input.agentSessions[agentSessionId]?.missionId
					: input.selection.missionId;
	const selectedTaskId = taskId && isTaskSelectionValid(taskId, selectedMissionId, input.tasks) ? taskId : undefined;
	const selectedArtifactId = artifactId && isArtifactSelectionValid(artifactId, selectedMissionId, input.artifacts) ? artifactId : undefined;
	const selectedSessionId = agentSessionId && isSessionSelectionValid(agentSessionId, selectedMissionId, input.agentSessions)
		? agentSessionId
		: undefined;
	const taskStageId = selectedTaskId ? input.tasks[selectedTaskId]?.stageId : undefined;
	const sessionTaskId = selectedSessionId ? input.agentSessions[selectedSessionId]?.taskId : undefined;
	const sessionStageId = sessionTaskId ? input.tasks[sessionTaskId]?.stageId : undefined;
	const selectedStageId = taskStageId
		|| sessionStageId
		|| (observed.stageId?.trim() && selectedMissionId && isObservedStageValid(observed.stageId.trim(), selectedMissionId, input)
			? observed.stageId.trim() as MissionStageId
			: undefined);
	return {
		...input,
		selection: {
			...(repositoryId ? { repositoryId } : {}),
			...(selectedMissionId ? { missionId: selectedMissionId } : {}),
			...(selectedStageId ? { stageId: selectedStageId } : {}),
			...(selectedTaskId ? { taskId: selectedTaskId } : {}),
			...(selectedArtifactId ? { artifactId: selectedArtifactId } : {}),
			...(selectedSessionId ? { agentSessionId: selectedSessionId } : {})
		}
	};
}

function isObservedStageValid(stageId: string, missionId: string, input: ContextGraph): boolean {
	const mission = input.missions[missionId];
	if (!mission) {
		return false;
	}
	return mission.tower?.stageRail.some((item) => item.id === stageId) ?? false;
}

function dedupeTasks(status: OperatorStatus) {
	const seen = new Set<string>();
	const tasks = [
		...(status.activeTasks ?? []),
		...(status.readyTasks ?? []),
		...(status.stages ?? []).flatMap((stage) => stage.tasks)
	];
	return tasks.filter((task) => {
		if (seen.has(task.taskId)) {
			return false;
		}
		seen.add(task.taskId);
		return true;
	});
}

function buildArtifactId(status: OperatorStatus, artifactKey: string): string {
	const missionScope = status.missionId?.trim() || status.control?.controlRoot?.trim() || 'repository';
	return `${missionScope}:${artifactKey}`;
}

function pickSelectedTaskId(status: OperatorStatus): string | undefined {
	return status.activeTasks?.[0]?.taskId || status.readyTasks?.[0]?.taskId || status.stages?.flatMap((stage) => stage.tasks)[0]?.taskId;
}

function pickSelectedArtifactId(status: OperatorStatus): string | undefined {
	const artifactKey = Object.keys(status.productFiles ?? {})[0];
	return artifactKey ? buildArtifactId(status, artifactKey) : undefined;
}

function pickSelectedSessionId(status: OperatorStatus): string | undefined {
	const preferred = (status.agentSessions ?? []).find((session) =>
		session.lifecycleState === 'running'
		|| session.lifecycleState === 'starting'
		|| session.lifecycleState === 'awaiting-input'
	);
	return preferred?.sessionId || status.agentSessions?.[0]?.sessionId;
}

function deriveGateBindings(
	graph: ContextGraph,
	currentPilotBinding: GateBinding,
	agentSessions: ContextGraph['agentSessions']
): Partial<Record<GateId, GateBinding>> {
	const { repositoryId, missionId, artifactId, agentSessionId } = graph.selection;
	const nextBindings: Partial<Record<GateId, GateBinding>> = {
		dashboard: missionId
			? { targetKind: 'mission', targetId: missionId, mode: 'control' }
			: repositoryId
				? { targetKind: 'repository', targetId: repositoryId, mode: 'control' }
				: { targetKind: 'empty' },
		editor: artifactId
			? { targetKind: 'artifact', targetId: artifactId, mode: 'view' }
			: missionId
				? { targetKind: 'mission', targetId: missionId, mode: 'view' }
				: repositoryId
					? { targetKind: 'repository', targetId: repositoryId, mode: 'view' }
					: { targetKind: 'empty' }
	};

	if (agentSessionId && agentSessionId in agentSessions) {
		nextBindings.pilot = {
			targetKind: 'agentSession',
			targetId: agentSessionId,
			mode: 'control'
		};
		return nextBindings;
	}

	if (
		currentPilotBinding.targetKind === 'agentSession'
		&& currentPilotBinding.targetId
		&& !(currentPilotBinding.targetId in agentSessions)
	) {
		nextBindings.pilot = { targetKind: 'empty' };
	}

	return nextBindings;
}

function deriveFocusIntent(graph: ContextGraph): GateId {
	return graph.selection.agentSessionId ? 'pilot' : 'dashboard';
}

function deriveSystemAirportProjections(
	domain: ContextGraph,
	airportState: AirportState
): AirportProjectionSet {
	return {
		dashboard: deriveDashboardProjection(domain, airportState),
		editor: deriveEditorProjection(domain, airportState),
		pilot: derivePilotProjection(domain, airportState)
	};
}

function deriveSystemActionProjections(
	domain: ContextGraph,
	airportProjections: AirportProjectionSet
) {
	const targetContext = deriveActionTargetContext(airportProjections.dashboard.commandContext);
	return {
		dashboard: {
			targetContext,
			availableActions: resolveAvailableActionsForTargetContext(domain.availableActions, targetContext)
		}
	};
}

function deriveDashboardProjection(domain: ContextGraph, airportState: AirportState): AirportProjectionSet['dashboard'] {
	const base = createGateProjectionBase(airportState, 'dashboard');
	const repositoryId = airportState.repositoryId ?? domain.selection.repositoryId;
	const repositoryContext = repositoryId ? domain.repositories[repositoryId] : undefined;
	const missionId = base.binding.targetKind === 'mission'
		? base.binding.targetId
		: domain.selection.missionId;
	const missionContext = missionId ? domain.missions[missionId] : undefined;
	const commandContext = deriveDashboardCommandContext(domain, repositoryContext, missionContext);
	return {
		...base,
		surfaceMode: missionId ? 'mission' : 'repository',
		centerRoute: missionId ? 'mission-control' : 'repository-flow',
		...(repositoryId ? { repositoryId } : {}),
		repositoryLabel: repositoryContext?.displayLabel
			|| path.basename(airportState.repositoryRootPath || repositoryId || 'repository')
			|| 'Repository',
		...(missionId ? { missionId } : {}),
		...(missionContext?.briefSummary ? { missionLabel: missionContext.briefSummary } : missionId ? { missionLabel: missionId } : {}),
		...(commandContext.stageId ? { selectedStageId: commandContext.stageId } : {}),
		...(domain.selection.taskId ? { selectedTaskId: domain.selection.taskId } : {}),
		...(domain.selection.agentSessionId ? { selectedSessionId: domain.selection.agentSessionId } : {}),
		commandContext,
		stageRail: missionContext?.tower?.stageRail.map((item) => ({ ...item })) ?? [],
		treeNodes: missionContext?.tower?.treeNodes.map((node) => ({ ...node })) ?? [],
		subtitle: missionContext?.briefSummary
			|| missionId
			|| repositoryContext?.displayLabel
			|| airportState.repositoryRootPath
			|| 'Repository overview',
		emptyLabel: missionId
			? 'Mission mode is active but no mission-control projection is available yet.'
			: 'Repository mode is ready.'
	};
}

function deriveEditorProjection(domain: ContextGraph, airportState: AirportState): AirportProjectionSet['editor'] {
	const base = createGateProjectionBase(airportState, 'editor');
	const artifactId = base.binding.targetKind === 'artifact'
		? base.binding.targetId
		: domain.selection.artifactId;
	const artifactContext = artifactId ? domain.artifacts[artifactId] : undefined;
	const missionContext = artifactContext?.missionId ? domain.missions[artifactContext.missionId] : undefined;
	const repositoryContext = airportState.repositoryId ? domain.repositories[airportState.repositoryId] : undefined;
	const launchPath = artifactContext?.filePath
		|| missionContext?.workspacePath
		|| repositoryContext?.rootPath
		|| airportState.repositoryRootPath;
	return {
		...base,
		subtitle: artifactContext?.displayLabel
			|| artifactContext?.filePath
			|| base.subtitle,
		...(artifactId ? { artifactId } : {}),
		...(artifactContext?.filePath ? { artifactPath: artifactContext.filePath } : {}),
		...(artifactContext?.displayLabel ? { resourceLabel: artifactContext.displayLabel } : {}),
		...(launchPath ? { launchPath } : {}),
		emptyLabel: artifactContext?.filePath
			? 'Editor gate is ready.'
			: 'Editor gate is waiting for an artifact binding.'
	};
}

function derivePilotProjection(domain: ContextGraph, airportState: AirportState): AirportProjectionSet['pilot'] {
	const base = createGateProjectionBase(airportState, 'pilot');
	const sessionId = base.binding.targetKind === 'agentSession'
		? base.binding.targetId
		: domain.selection.agentSessionId;
	const sessionContext = sessionId ? domain.agentSessions[sessionId] : undefined;
	const taskId = sessionContext?.taskId || (base.binding.targetKind === 'task' ? base.binding.targetId : undefined);
	return {
		...base,
		subtitle: sessionContext?.promptTitle
			|| sessionId
			|| base.subtitle,
		...(sessionId ? { sessionId, sessionLabel: sessionId } : {}),
		...(taskId ? { taskId } : {}),
		...(sessionContext?.missionId ? { missionId: sessionContext.missionId } : {}),
		...(sessionContext?.workingDirectory ? { workingDirectory: sessionContext.workingDirectory } : {}),
		statusLabel: sessionContext?.lifecycleState || (sessionId ? 'bound' : 'idle'),
		emptyLabel: sessionId
			? 'Pilot gate is bound and waiting for the session surface.'
			: 'Pilot gate is idle.'
	};
}

function deriveDashboardCommandContext(
	domain: ContextGraph,
	repositoryContext: RepositoryContext | undefined,
	missionContext: MissionContext | undefined
): AirportProjectionSet['dashboard']['commandContext'] {
	const sessionId = domain.selection.agentSessionId;
	if (sessionId) {
		const sessionContext = domain.agentSessions[sessionId];
		const sessionTask = sessionContext?.taskId ? domain.tasks[sessionContext.taskId] : undefined;
		return {
			...(sessionTask?.stageId ? { stageId: sessionTask.stageId } : {}),
			...(sessionContext?.taskId ? { taskId: sessionContext.taskId } : {}),
			sessionId,
			targetLabel: sessionContext?.promptTitle || sessionId,
			targetKind: 'session'
		};
	}

	const taskId = domain.selection.taskId;
	if (taskId) {
		const taskContext = domain.tasks[taskId];
		return {
			...(taskContext?.stageId ? { stageId: taskContext.stageId } : {}),
			taskId,
			targetLabel: taskContext?.subject || taskId,
			targetKind: 'task'
		};
	}

	const artifactId = domain.selection.artifactId;
	if (artifactId) {
		const artifactContext = domain.artifacts[artifactId];
		const artifactTask = artifactContext?.ownerTaskId ? domain.tasks[artifactContext.ownerTaskId] : undefined;
		return {
			...(artifactContext?.ownerTaskId ? { taskId: artifactContext.ownerTaskId } : {}),
			...(artifactTask?.stageId
				? { stageId: artifactTask.stageId }
				: {}),
			targetLabel: artifactContext?.displayLabel || artifactId,
			targetKind: 'task-artifact'
		};
	}

	const stageId = domain.selection.stageId;
	if (stageId) {
		const stageLabel = missionContext?.tower?.stageRail.find((item) => item.id === stageId)?.label || stageId;
		return {
			stageId,
			targetLabel: stageLabel,
			targetKind: 'stage'
		};
	}

	if (missionContext) {
		return {
			...(missionContext.currentStage ? { stageId: missionContext.currentStage } : {}),
			targetLabel: missionContext.briefSummary,
			targetKind: 'mission'
		};
	}

	if (repositoryContext) {
		return {
			targetLabel: repositoryContext.displayLabel,
			targetKind: 'repository'
		};
	}

	return {};
}

function deriveActionTargetContext(
	commandContext: AirportProjectionSet['dashboard']['commandContext']
): OperatorActionTargetContext {
	return {
		...(commandContext.stageId ? { stageId: commandContext.stageId as MissionStageId } : {}),
		...(commandContext.taskId ? { taskId: commandContext.taskId } : {}),
		...(commandContext.sessionId ? { sessionId: commandContext.sessionId } : {})
	};
}

function createGateProjectionBase(
	airportState: AirportState,
	gateId: GateId
): AirportProjectionSet[keyof AirportProjectionSet] {
	const binding = airportState.gates[gateId];
	const pane = airportState.substrate.panesByGate[gateId];
	return {
		gateId,
		binding: structuredClone(binding),
		connectedClientIds: Object.values(airportState.clients)
			.filter((client) => client.connected && client.claimedGateId === gateId)
			.map((client) => client.clientId),
		title: formatGateTitle(gateId),
		subtitle: formatGateSubtitle(binding),
		intentFocused: airportState.focus.intentGateId === gateId,
		observedFocused: airportState.focus.observedGateId === gateId,
		...(pane ? { pane: { ...pane } } : {})
	} as AirportProjectionSet[keyof AirportProjectionSet];
}

function formatGateTitle(gateId: GateId): string {
	switch (gateId) {
		case 'dashboard':
			return 'Dashboard';
		case 'editor':
			return 'Editor';
		case 'pilot':
			return 'Pilot';
	}
	return gateId;
}

function formatGateSubtitle(binding: GateBinding): string {
	if (binding.targetKind === 'empty') {
		return 'No target bound';
	}

	const targetLabel = binding.targetId?.trim() || 'unresolved';
	return binding.mode ? `${binding.targetKind}:${targetLabel} (${binding.mode})` : `${binding.targetKind}:${targetLabel}`;
}