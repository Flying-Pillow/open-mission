import path from 'node:path';
import type {
	AgentSessionContext,
	ArtifactContext,
	ContextGraph,
	ContextSelection,
	MissionContext,
	MissionOperatorProjectionContext,
	MissionStageId,
	RepositoryContext,
	TaskContext
} from '../../types.js';
import type {
	ControlSource,
	ControlSourceSelectionHint
} from './types.js';

export class ContextGraphController {
	private domain: ContextGraph = createEmptyContextGraph();
	private missionOperatorViews: Record<string, MissionOperatorProjectionContext> = {};

	public getState(): ContextGraph {
		return structuredClone(this.domain);
	}

	public getMissionOperatorViews(): Record<string, MissionOperatorProjectionContext> {
		return structuredClone(this.missionOperatorViews);
	}

	public synchronize(source: ControlSource, selectionHint: ControlSourceSelectionHint = {}): ContextGraph {
		const previousSelection = shouldPreserveSelection(this.domain.selection, source.repositoryId)
			? this.domain.selection
			: {};
		const nextState = deriveContextGraph(source, previousSelection, selectionHint);
		this.domain = nextState.domain;
		this.missionOperatorViews = nextState.missionOperatorViews;
		return this.getState();
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

function shouldPreserveSelection(selection: ContextSelection, repositoryId: string): boolean {
	return !selection.repositoryId || selection.repositoryId === repositoryId;
}

function deriveContextGraph(
	source: ControlSource,
	previousSelection: ContextSelection,
	selectionHint: ControlSourceSelectionHint
): {
	domain: ContextGraph;
	missionOperatorViews: Record<string, MissionOperatorProjectionContext>;
} {
	const repositoryId = source.repositoryId;
	const missionStatus = source.missionStatus;
	const missionCandidatesById = new Map(
		source.availableMissions.map((candidate) => [candidate.missionId, candidate] as const)
	);
	const missionIds = Array.from(
		new Set([
			...missionCandidatesById.keys(),
			...(missionStatus?.missionId ? [missionStatus.missionId] : [])
		].filter((value) => value.trim().length > 0))
	);
	const tasks = dedupeTasks(missionStatus);
	const artifacts = {
		...Object.fromEntries(
			Object.entries(missionStatus?.productFiles ?? {}).map(([artifactKey, artifactPath]) => {
				const id = buildArtifactSelection(repositoryId, missionStatus?.missionId, artifactKey);
				const artifactContext: ArtifactContext = {
					id,
					...(missionStatus?.missionId ? { missionId: missionStatus.missionId } : { repositoryId }),
					filePath: artifactPath,
					logicalKind: artifactKey,
					displayLabel: path.basename(artifactPath)
				};
				return [id, artifactContext] as const;
			})
		),
		...Object.fromEntries(
			tasks
				.filter((task) => typeof task.filePath === 'string' && task.filePath.trim().length > 0)
				.map((task) => {
					const id = buildTaskArtifactSelection(repositoryId, missionStatus?.missionId, task.taskId);
					const artifactContext: ArtifactContext = {
						id,
						...(missionStatus?.missionId ? { missionId: missionStatus.missionId } : { repositoryId }),
						ownerTaskId: task.taskId,
						filePath: task.filePath,
						logicalKind: 'task-instruction',
						displayLabel: path.basename(task.filePath)
					};
					return [id, artifactContext] as const;
				})
		)
	};
	const taskContexts = Object.fromEntries(tasks.map((task) => {
		const sessionIds = (missionStatus?.agentSessions ?? [])
			.filter((session) => session.taskId === task.taskId)
			.map((session) => session.sessionId);
		const primaryArtifact = task.filePath?.trim()
			? buildTaskArtifactSelection(repositoryId, missionStatus?.missionId, task.taskId)
			: undefined;
		const taskContext: TaskContext = {
			taskId: task.taskId,
			...(missionStatus?.missionId ? { missionId: missionStatus.missionId } : {}),
			stageId: task.stage,
			subject: task.subject,
			instructionSummary: task.instruction,
			lifecycleState: task.status,
			dependencyIds: [...task.dependsOn],
			...(primaryArtifact ? { primaryArtifact } : {}),
			...(sessionIds.length > 0 ? { agentSessionIds: sessionIds } : {})
		};
		return [task.taskId, taskContext] as const;
	}));
	const agentSessions = Object.fromEntries(
		(missionStatus?.agentSessions ?? []).map((session) => {
			const sessionContext: AgentSessionContext = {
				sessionId: session.sessionId,
				...(missionStatus?.missionId ? { missionId: missionStatus.missionId } : {}),
				...(session.taskId ? { taskId: session.taskId } : {}),
				runnerId: session.runnerId,
				lifecycleState: session.lifecycleState,
				...(session.workingDirectory ? { workingDirectory: session.workingDirectory } : {}),
				...(session.currentTurnTitle ? { promptTitle: session.currentTurnTitle } : {}),
				...(session.transportId ? { transportId: session.transportId } : {}),
				...(session.terminalHandle ? { terminalHandle: { ...session.terminalHandle } } : {}),
				...(session.createdAt ? { createdAt: session.createdAt } : {}),
				...(session.lastUpdatedAt ? { lastUpdatedAt: session.lastUpdatedAt } : {})
			};
			return [session.sessionId, sessionContext] as const;
		})
	);
	const repositories: Record<string, RepositoryContext> = {
		[repositoryId]: {
			repositoryId,
			rootPath: source.repositoryRootPath,
			displayLabel: path.basename(source.repositoryRootPath),
			missionIds,
			...(source.control.settingsPath ? { workflowSettingsId: source.control.settingsPath } : {})
		}
	};
	const missionOperatorViews: Record<string, MissionOperatorProjectionContext> = Object.fromEntries(
		missionIds.flatMap((missionId) => {
			const isActiveMission = missionStatus?.missionId === missionId;
			if (!isActiveMission || !missionStatus?.tower) {
				return [];
			}

			return [[missionId, {
				missionId,
				stageRail: missionStatus.tower.stageRail.map((item) => ({ ...item })),
				treeNodes: missionStatus.tower.treeNodes.map((node) => ({ ...node }))
			}] as const];
		})
	);
	const missions: Record<string, MissionContext> = Object.fromEntries(
		missionIds.map((missionId) => {
			const candidate = missionCandidatesById.get(missionId);
			const isActiveMission = missionStatus?.missionId === missionId;
			const missionContext: MissionContext = {
				missionId,
				repositoryId,
				briefSummary: candidate?.title || (isActiveMission ? missionStatus?.title : undefined) || missionStatus?.type || missionId,
				...(candidate?.issueId !== undefined
					? { issueId: candidate.issueId }
					: isActiveMission && missionStatus?.issueId !== undefined
						? { issueId: missionStatus.issueId }
						: {}),
				...(candidate?.branchRef
					? { branchRef: candidate.branchRef }
					: isActiveMission && missionStatus?.branchRef
						? { branchRef: missionStatus.branchRef }
						: {}),
				...(candidate?.createdAt ? { createdAt: candidate.createdAt } : {}),
				workspacePath: isActiveMission
					? missionStatus?.missionDir || missionStatus?.missionRootDir || source.repositoryRootPath
					: source.repositoryRootPath,
				...(isActiveMission && missionStatus?.stage ? { currentStage: missionStatus.stage } : {}),
				...(isActiveMission && missionStatus?.workflow?.lifecycle ? { lifecycleState: missionStatus.workflow.lifecycle } : {}),
				taskIds: isActiveMission ? tasks.map((task) => task.taskId) : [],
				artifacts: isActiveMission ? Object.keys(artifacts) : [],
				sessionIds: isActiveMission ? Object.keys(agentSessions) : []
			};
			return [missionId, missionContext] as const;
		})
	);
	const selection = resolveContextSelection({
		repositoryId,
		missionStatus,
		previousSelection: {
			...previousSelection,
			...selectionHint
		},
		missions,
		tasks: taskContexts,
		artifacts,
		agentSessions
	});

	return {
		domain: {
			selection,
			repositories,
			missions,
			tasks: taskContexts,
			artifacts,
			agentSessions
		},
		missionOperatorViews
	};
}

function resolveContextSelection(input: {
	repositoryId: string;
	missionStatus?: ControlSource['missionStatus'];
	previousSelection: ContextSelection;
	missions: Record<string, MissionContext>;
	tasks: Record<string, TaskContext>;
	artifacts: Record<string, ArtifactContext>;
	agentSessions: Record<string, AgentSessionContext>;
}): ContextSelection {
	const heuristicTaskId = pickSelectedTaskId(input.missionStatus);
	const heuristicArtifact = pickSelectedArtifact(input.repositoryId, input.missionStatus);
	const heuristicSessionId = pickSelectedSessionId(input.missionStatus);
	const missionId = resolveSelectedMissionId(input.missionStatus, input.previousSelection, input.missions);
	const taskId = resolveSelectedTaskId(input.previousSelection, input.tasks, missionId, heuristicTaskId);
	const artifact = resolveSelectedArtifact(input.previousSelection, input.artifacts, missionId, heuristicArtifact);
	const agentSessionId = resolveSelectedSessionId(input.previousSelection, input.agentSessions, missionId, heuristicSessionId);
	const stageId = resolveSelectedStageId(input.missionStatus, input.previousSelection, input.tasks, input.agentSessions, missionId, taskId, agentSessionId);
	return {
		repositoryId: input.repositoryId,
		...(missionId ? { missionId } : {}),
		...(stageId ? { stageId } : {}),
		...(taskId ? { taskId } : {}),
		...(artifact ? { artifact } : {}),
		...(agentSessionId ? { agentSessionId } : {})
	};
}

function resolveSelectedMissionId(
	missionStatus: ControlSource['missionStatus'] | undefined,
	previousSelection: ContextSelection,
	missions: Record<string, MissionContext>
): string | undefined {
	const previousMissionId = previousSelection.missionId;
	if (previousMissionId && isMissionSelectionValid(previousMissionId, missions)) {
		return previousMissionId;
	}
	const statusMissionId = missionStatus?.missionId?.trim();
	return statusMissionId && isMissionSelectionValid(statusMissionId, missions) ? statusMissionId : undefined;
}

function isMissionSelectionValid(
	missionId: string,
	missions: Record<string, MissionContext>
): boolean {
	return Boolean(missions[missionId]);
}

function resolveSelectedTaskId(
	previousSelection: ContextSelection,
	tasks: Record<string, TaskContext>,
	missionId: string | undefined,
	heuristicTaskId: string | undefined
): string | undefined {
	const previousTaskId = previousSelection.taskId;
	if (previousTaskId && isTaskSelectionValid(previousTaskId, missionId, tasks)) {
		return previousTaskId;
	}
	if (hasExplicitNonTaskSelection(previousSelection)) {
		return undefined;
	}
	if (heuristicTaskId && isTaskSelectionValid(heuristicTaskId, missionId, tasks)) {
		return heuristicTaskId;
	}
	return undefined;
}

function resolveSelectedArtifact(
	previousSelection: ContextSelection,
	artifacts: Record<string, ArtifactContext>,
	missionId: string | undefined,
	heuristicArtifact: string | undefined
): string | undefined {
	const previousArtifact = previousSelection.artifact;
	if (previousArtifact && isArtifactSelectionValid(previousArtifact, missionId, artifacts)) {
		return previousArtifact;
	}
	if (hasExplicitNonArtifactSelection(previousSelection)) {
		return undefined;
	}
	if (heuristicArtifact && isArtifactSelectionValid(heuristicArtifact, missionId, artifacts)) {
		return heuristicArtifact;
	}
	return undefined;
}

function resolveSelectedSessionId(
	previousSelection: ContextSelection,
	agentSessions: Record<string, AgentSessionContext>,
	missionId: string | undefined,
	heuristicSessionId: string | undefined
): string | undefined {
	const previousSessionId = previousSelection.agentSessionId;
	if (previousSessionId && isSessionSelectionValid(previousSessionId, missionId, agentSessions)) {
		const previousSession = agentSessions[previousSessionId];
		const heuristicSession = heuristicSessionId ? agentSessions[heuristicSessionId] : undefined;
		if (
			previousSession
			&& heuristicSession
			&& previousSession.taskId
			&& previousSession.taskId === heuristicSession.taskId
			&& !isActiveSessionSelection(previousSession)
			&& isActiveSessionSelection(heuristicSession)
		) {
			return heuristicSessionId;
		}
		return previousSessionId;
	}
	if (hasExplicitNonSessionSelection(previousSelection)) {
		return undefined;
	}
	if (heuristicSessionId && isSessionSelectionValid(heuristicSessionId, missionId, agentSessions)) {
		return heuristicSessionId;
	}
	return undefined;
}

function resolveSelectedStageId(
	missionStatus: ControlSource['missionStatus'] | undefined,
	previousSelection: ContextSelection,
	tasks: Record<string, TaskContext>,
	agentSessions: Record<string, AgentSessionContext>,
	missionId: string | undefined,
	taskId: string | undefined,
	sessionId: string | undefined
): MissionStageId | undefined {
	if (taskId) {
		return tasks[taskId]?.stageId;
	}
	if (sessionId) {
		const sessionTaskId = agentSessions[sessionId]?.taskId;
		return sessionTaskId ? tasks[sessionTaskId]?.stageId : undefined;
	}
	const previousStageId = previousSelection.stageId;
	if (previousStageId && isStageSelectionValid(previousStageId, missionId, missionStatus)) {
		return previousStageId;
	}
	return missionStatus?.stage;
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
	id: string,
	missionId: string | undefined,
	artifacts: Record<string, ArtifactContext>
): boolean {
	const artifact = artifacts[id];
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

function isActiveSessionSelection(session: AgentSessionContext): boolean {
	return session.lifecycleState === 'starting'
		|| session.lifecycleState === 'running'
		|| session.lifecycleState === 'awaiting-input';
}

function isStageSelectionValid(
	stageId: MissionStageId,
	missionId: string | undefined,
	missionStatus: ControlSource['missionStatus'] | undefined
): boolean {
	if (!missionId) {
		return false;
	}
	return (missionStatus?.stages ?? []).some((stage) => stage.stage === stageId)
		|| (missionStatus?.tower?.stageRail ?? []).some((stage) => stage.id === stageId);
}

function hasExplicitNonTaskSelection(selection: ContextSelection): boolean {
	return Boolean(selection.stageId || selection.artifact || selection.agentSessionId);
}

function hasExplicitNonArtifactSelection(selection: ContextSelection): boolean {
	return Boolean(selection.stageId || selection.taskId || selection.agentSessionId);
}

function hasExplicitNonSessionSelection(selection: ContextSelection): boolean {
	return Boolean(selection.stageId || selection.taskId || selection.artifact);
}

function dedupeTasks(missionStatus: ControlSource['missionStatus'] | undefined) {
	const seen = new Set<string>();
	const tasks = [
		...(missionStatus?.activeTasks ?? []),
		...(missionStatus?.readyTasks ?? []),
		...(missionStatus?.stages ?? []).flatMap((stage) => stage.tasks)
	];
	return tasks.filter((task) => {
		if (seen.has(task.taskId)) {
			return false;
		}
		seen.add(task.taskId);
		return true;
	});
}

function buildArtifactSelection(repositoryId: string, missionId: string | undefined, artifactKey: string): string {
	const missionScope = missionId?.trim() || repositoryId;
	return `${missionScope}:${artifactKey}`;
}

function buildTaskArtifactSelection(repositoryId: string, missionId: string | undefined, taskId: string): string {
	const missionScope = missionId?.trim() || repositoryId;
	return `${missionScope}:task:${taskId}`;
}

function pickSelectedTaskId(missionStatus: ControlSource['missionStatus'] | undefined): string | undefined {
	return missionStatus?.activeTasks?.[0]?.taskId
		|| missionStatus?.readyTasks?.[0]?.taskId
		|| missionStatus?.stages?.flatMap((stage) => stage.tasks)[0]?.taskId;
}

function pickSelectedArtifact(
	repositoryId: string,
	missionStatus: ControlSource['missionStatus'] | undefined
): string | undefined {
	const artifactKey = Object.keys(missionStatus?.productFiles ?? {})[0];
	return artifactKey ? buildArtifactSelection(repositoryId, missionStatus?.missionId, artifactKey) : undefined;
}

function pickSelectedSessionId(missionStatus: ControlSource['missionStatus'] | undefined): string | undefined {
	const preferred = (missionStatus?.agentSessions ?? []).find((session) =>
		session.lifecycleState === 'running'
		|| session.lifecycleState === 'starting'
		|| session.lifecycleState === 'awaiting-input'
	);
	return preferred?.sessionId || missionStatus?.agentSessions?.[0]?.sessionId;
}
