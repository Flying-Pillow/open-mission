import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
	AirportControl,
	InMemoryZellijSubstrateController,
	createDefaultGateBindings,
	type AirportProjectionSet,
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
	MissionStatus,
	MissionSystemSnapshot,
	MissionSystemState,
	RepositoryContext,
	TaskContext
} from '../types.js';
import {
	getMissionDaemonSettingsPath,
	readMissionDaemonSettings,
	writeMissionDaemonSettings
} from '../lib/daemonConfig.js';
import { getWorkspaceRoot } from '../lib/workspacePaths.js';

type RepositoryAirportRecord = {
	repositoryId: string;
	repositoryRootPath: string;
	control: AirportControl;
	serializedPersistedIntent?: string;
};

export class MissionSystemController {
	private readonly fallbackAirportControl: AirportControl;
	private readonly airportRegistry = new Map<string, RepositoryAirportRecord>();
	private readonly clientRepositoryIndex = new Map<string, string>();
	private activeRepositoryId?: string;
	private version = 0;
	private domain: ContextGraph = createEmptyContextGraph();
	private serializedState = '';

	public constructor() {
		this.fallbackAirportControl = new AirportControl(
			new InMemoryZellijSubstrateController({
				sessionName: process.env['MISSION_ZELLIJ_SESSION']?.trim() || 'mission-control'
			})
		);
		this.serializedState = this.serializeSystemState();
	}

	public getSnapshot(): MissionSystemSnapshot {
		return this.buildSnapshot();
	}

	public async scopeAirportToSurfacePath(surfacePath?: string): Promise<MissionSystemSnapshot> {
		const normalizedSurfacePath = surfacePath?.trim();
		if (!normalizedSurfacePath) {
			return this.getSnapshot();
		}

		const repositoryRootPath = getWorkspaceRoot(normalizedSurfacePath);
		await this.ensureAirportForRepository(repositoryRootPath, repositoryRootPath);
		this.activeRepositoryId = repositoryRootPath;
		return this.commit();
	}

	public async applyStatus(status: MissionStatus): Promise<MissionSystemSnapshot> {
		const nextDomain = deriveContextGraph(status);
		const repositoryId = nextDomain.selection.repositoryId;
		if (!repositoryId) {
			this.domain = nextDomain;
			return this.commit();
		}

		const repositoryRootPath = nextDomain.repositories[repositoryId]?.rootPath || repositoryId;
		const airport = await this.ensureAirportForRepository(repositoryId, repositoryRootPath);
		this.activeRepositoryId = repositoryId;
		await airport.control.applyDefaultBindings(deriveGateBindings(nextDomain), {
			focusIntent: deriveFocusIntent(nextDomain)
		});
		this.domain = nextDomain;
		return this.commit([repositoryId]);
	}

	public async connectAirportClient(params: {
		clientId: string;
		label?: string;
		surfacePath?: string;
		gateId?: GateId;
		panelProcessId?: string;
	}): Promise<MissionSystemSnapshot> {
		const airport = await this.resolveAirportForRequest(params.clientId, params.surfacePath);
		this.activeRepositoryId = airport.repositoryId;
		this.clientRepositoryIndex.set(params.clientId, airport.repositoryId);
		await airport.control.connectClient(params);
		return this.commit([airport.repositoryId]);
	}

	public async disconnectAirportClient(clientId: string): Promise<MissionSystemSnapshot> {
		const repositoryId = this.clientRepositoryIndex.get(clientId);
		if (!repositoryId) {
			return this.getSnapshot();
		}

		const airport = this.airportRegistry.get(repositoryId);
		if (!airport) {
			this.clientRepositoryIndex.delete(clientId);
			return this.getSnapshot();
		}

		await airport.control.disconnectClient(clientId);
		this.clientRepositoryIndex.delete(clientId);
		return this.commit([repositoryId]);
	}

	public async observeAirportClient(params: {
		clientId: string;
		focusedGateId?: GateId;
		intentGateId?: GateId;
		surfacePath?: string;
	}): Promise<MissionSystemSnapshot> {
		const airport = await this.resolveAirportForRequest(params.clientId, params.surfacePath);
		this.activeRepositoryId = airport.repositoryId;
		this.clientRepositoryIndex.set(params.clientId, airport.repositoryId);
		await airport.control.observeClient(params);
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
		const activeAirport = this.getActiveAirportRecordOrUndefined();
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
			airport: activeAirport?.control.getState() ?? this.fallbackAirportControl.getState(),
			airports: {
				...(this.activeRepositoryId ? { activeRepositoryId: this.activeRepositoryId } : {}),
				repositories: airportRegistryState
			}
		};
		const airportProjections: AirportProjectionSet = activeAirport?.control.getProjections() ?? this.fallbackAirportControl.getProjections();
		const airportRegistryProjections = Object.fromEntries(
			[...this.airportRegistry.entries()]
				.sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
				.map(([repositoryId, record]) => [repositoryId, record.control.getProjections()])
		);
		return { state, airportProjections, airportRegistryProjections };
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
		const activeAirport = this.getActiveAirportRecordOrUndefined();
		if (!activeAirport) {
			throw new Error('Airport state is not scoped to a repository.');
		}
		return activeAirport;
	}

	private getActiveAirportRecordOrUndefined(): RepositoryAirportRecord | undefined {
		return this.activeRepositoryId ? this.airportRegistry.get(this.activeRepositoryId) : undefined;
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
			new InMemoryZellijSubstrateController({
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
		sessionName: process.env['MISSION_ZELLIJ_SESSION']?.trim() || `mission-control-${repositoryLabel}-${repositoryHash}`
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
		agentSessions: {}
	};
}

function deriveContextGraph(status: MissionStatus): ContextGraph {
	const repositoryId = status.control?.controlRoot?.trim() || 'repository';
	const missionIds = Array.from(
		new Set([
			...(status.availableMissions ?? []).map((candidate) => candidate.missionId),
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
	const missions: Record<string, MissionContext> = status.missionId
		? {
			[status.missionId]: {
				missionId: status.missionId,
				repositoryId,
				briefSummary: status.title || status.type || status.missionId,
				workspacePath: status.missionDir || status.missionRootDir || status.control?.controlRoot || repositoryId,
				...(status.stage ? { currentStage: status.stage } : {}),
				...(status.workflow?.lifecycle ? { lifecycleState: status.workflow.lifecycle } : {}),
				taskIds: tasks.map((task) => task.taskId),
				artifactIds: Object.keys(artifacts),
				sessionIds: Object.keys(agentSessions)
			}
		}
		: {};
	const selectedTaskId = pickSelectedTaskId(status);
	const selectedArtifactId = pickSelectedArtifactId(status);
	const selectedSessionId = pickSelectedSessionId(status);
	const selection: ContextSelection = {
		repositoryId,
		...(status.missionId ? { missionId: status.missionId } : {}),
		...(selectedTaskId ? { taskId: selectedTaskId } : {}),
		...(selectedArtifactId ? { artifactId: selectedArtifactId } : {}),
		...(selectedSessionId ? { agentSessionId: selectedSessionId } : {})
	};

	return {
		selection,
		repositories,
		missions,
		tasks: taskContexts,
		artifacts,
		agentSessions
	};
}

function dedupeTasks(status: MissionStatus) {
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

function buildArtifactId(status: MissionStatus, artifactKey: string): string {
	const missionScope = status.missionId?.trim() || status.control?.controlRoot?.trim() || 'repository';
	return `${missionScope}:${artifactKey}`;
}

function pickSelectedTaskId(status: MissionStatus): string | undefined {
	return status.activeTasks?.[0]?.taskId || status.readyTasks?.[0]?.taskId || status.stages?.flatMap((stage) => stage.tasks)[0]?.taskId;
}

function pickSelectedArtifactId(status: MissionStatus): string | undefined {
	const artifactKey = Object.keys(status.productFiles ?? {})[0];
	return artifactKey ? buildArtifactId(status, artifactKey) : undefined;
}

function pickSelectedSessionId(status: MissionStatus): string | undefined {
	const preferred = (status.agentSessions ?? []).find((session) =>
		session.lifecycleState === 'running'
		|| session.lifecycleState === 'starting'
		|| session.lifecycleState === 'awaiting-input'
	);
	return preferred?.sessionId || status.agentSessions?.[0]?.sessionId;
}

function deriveGateBindings(graph: ContextGraph): Partial<Record<GateId, GateBinding>> {
	const { repositoryId, missionId, taskId, artifactId, agentSessionId } = graph.selection;
	return {
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
					: { targetKind: 'empty' },
		pilot: agentSessionId
			? { targetKind: 'agentSession', targetId: agentSessionId, mode: 'control' }
			: taskId
				? { targetKind: 'task', targetId: taskId, mode: 'control' }
				: missionId
					? { targetKind: 'mission', targetId: missionId, mode: 'control' }
					: { targetKind: 'empty' }
	};
}

function deriveFocusIntent(graph: ContextGraph): GateId {
	return graph.selection.agentSessionId ? 'pilot' : 'dashboard';
}