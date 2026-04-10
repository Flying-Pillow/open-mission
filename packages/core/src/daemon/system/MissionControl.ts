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
	MissionControlSource,
	MissionControlSourceSelectionHint
} from './types.js';

export class MissionControl {
	private domain: ContextGraph = createEmptyContextGraph();
	private missionOperatorViews: Record<string, MissionOperatorProjectionContext> = {};

	public getState(): ContextGraph {
		return structuredClone(this.domain);
	}

	public getMissionOperatorViews(): Record<string, MissionOperatorProjectionContext> {
		return structuredClone(this.missionOperatorViews);
	}

	public synchronize(source: MissionControlSource, selectionHint: MissionControlSourceSelectionHint = {}): ContextGraph {
		const previousSelection = shouldPreserveSelection(this.domain.selection, source.repositoryId)
			? this.domain.selection
			: {};
		const nextState = deriveContextGraph(source, previousSelection, selectionHint);
		this.domain = nextState.domain;
		this.missionOperatorViews = nextState.missionOperatorViews;
		return this.getState();
	}

	public observeSelection(observed: {
		repositoryId?: string;
		missionId?: string;
		stageId?: string;
		taskId?: string;
		artifactId?: string;
		agentSessionId?: string;
		fallbackRepositoryId?: string;
	}): ContextGraph {
		this.domain = applyObservedSelection(this.domain, observed);
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
	source: MissionControlSource,
	previousSelection: ContextSelection,
	selectionHint: MissionControlSourceSelectionHint
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
	const taskContexts = Object.fromEntries(tasks.map((task) => {
		const sessionIds = (missionStatus?.agentSessions ?? [])
			.filter((session) => session.taskId === task.taskId)
			.map((session) => session.sessionId);
		const taskContext: TaskContext = {
			taskId: task.taskId,
			...(missionStatus?.missionId ? { missionId: missionStatus.missionId } : {}),
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
		Object.entries(missionStatus?.productFiles ?? {}).map(([artifactKey, artifactPath]) => {
			const artifactId = buildArtifactId(repositoryId, missionStatus?.missionId, artifactKey);
			const artifactContext: ArtifactContext = {
				artifactId,
				...(missionStatus?.missionId ? { missionId: missionStatus.missionId } : { repositoryId }),
				filePath: artifactPath,
				logicalKind: artifactKey,
				displayLabel: path.basename(artifactPath)
			};
			return [artifactId, artifactContext] as const;
		})
	);
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
				...(session.transportId ? { transportId: session.transportId } : {})
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
				artifactIds: isActiveMission ? Object.keys(artifacts) : [],
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
	missionStatus?: MissionControlSource['missionStatus'];
	previousSelection: ContextSelection;
	missions: Record<string, MissionContext>;
	tasks: Record<string, TaskContext>;
	artifacts: Record<string, ArtifactContext>;
	agentSessions: Record<string, AgentSessionContext>;
}): ContextSelection {
	const heuristicTaskId = pickSelectedTaskId(input.missionStatus);
	const heuristicArtifactId = pickSelectedArtifactId(input.repositoryId, input.missionStatus);
	const heuristicSessionId = pickSelectedSessionId(input.missionStatus);
	const missionId = resolveSelectedMissionId(input.missionStatus, input.previousSelection, input.missions);
	const taskId = resolveSelectedTaskId(input.previousSelection, input.tasks, missionId, heuristicTaskId);
	const artifactId = resolveSelectedArtifactId(input.previousSelection, input.artifacts, missionId, heuristicArtifactId);
	const agentSessionId = resolveSelectedSessionId(input.previousSelection, input.agentSessions, missionId, heuristicSessionId);
	const stageId = resolveSelectedStageId(input.missionStatus, input.previousSelection, input.tasks, input.agentSessions, missionId, taskId, agentSessionId);
	return {
		repositoryId: input.repositoryId,
		...(missionId ? { missionId } : {}),
		...(stageId ? { stageId } : {}),
		...(taskId ? { taskId } : {}),
		...(artifactId ? { artifactId } : {}),
		...(agentSessionId ? { agentSessionId } : {})
	};
}

function resolveSelectedMissionId(
	missionStatus: MissionControlSource['missionStatus'] | undefined,
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

function resolveSelectedArtifactId(
	previousSelection: ContextSelection,
	artifacts: Record<string, ArtifactContext>,
	missionId: string | undefined,
	heuristicArtifactId: string | undefined
): string | undefined {
	const previousArtifactId = previousSelection.artifactId;
	if (previousArtifactId && isArtifactSelectionValid(previousArtifactId, missionId, artifacts)) {
		return previousArtifactId;
	}
	if (hasExplicitNonArtifactSelection(previousSelection)) {
		return undefined;
	}
	if (heuristicArtifactId && isArtifactSelectionValid(heuristicArtifactId, missionId, artifacts)) {
		return heuristicArtifactId;
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
	missionStatus: MissionControlSource['missionStatus'] | undefined,
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
	missionStatus: MissionControlSource['missionStatus'] | undefined
): boolean {
	if (!missionId) {
		return false;
	}
	return (missionStatus?.stages ?? []).some((stage) => stage.stage === stageId)
		|| (missionStatus?.tower?.stageRail ?? []).some((stage) => stage.id === stageId);
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

function dedupeTasks(missionStatus: MissionControlSource['missionStatus'] | undefined) {
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

function buildArtifactId(repositoryId: string, missionId: string | undefined, artifactKey: string): string {
	const missionScope = missionId?.trim() || repositoryId;
	return `${missionScope}:${artifactKey}`;
}

function pickSelectedTaskId(missionStatus: MissionControlSource['missionStatus'] | undefined): string | undefined {
	return missionStatus?.activeTasks?.[0]?.taskId
		|| missionStatus?.readyTasks?.[0]?.taskId
		|| missionStatus?.stages?.flatMap((stage) => stage.tasks)[0]?.taskId;
}

function pickSelectedArtifactId(
	repositoryId: string,
	missionStatus: MissionControlSource['missionStatus'] | undefined
): string | undefined {
	const artifactKey = Object.keys(missionStatus?.productFiles ?? {})[0];
	return artifactKey ? buildArtifactId(repositoryId, missionStatus?.missionId, artifactKey) : undefined;
}

function pickSelectedSessionId(missionStatus: MissionControlSource['missionStatus'] | undefined): string | undefined {
	const preferred = (missionStatus?.agentSessions ?? []).find((session) =>
		session.lifecycleState === 'running'
		|| session.lifecycleState === 'starting'
		|| session.lifecycleState === 'awaiting-input'
	);
	return preferred?.sessionId || missionStatus?.agentSessions?.[0]?.sessionId;
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
	const hasExplicitRepositoryReset = Boolean(
		observed.repositoryId?.trim()
		&& !missionId
		&& !taskId
		&& !artifactId
		&& !agentSessionId
		&& !observed.stageId?.trim()
	);
	const selectedMissionId = missionId && isMissionSelectionValid(missionId, input.missions)
		? missionId
		: taskId && input.tasks[taskId]?.missionId
			? input.tasks[taskId]?.missionId
			: artifactId && input.artifacts[artifactId]?.missionId
				? input.artifacts[artifactId]?.missionId
				: agentSessionId && input.agentSessions[agentSessionId]?.missionId
					? input.agentSessions[agentSessionId]?.missionId
					: hasExplicitRepositoryReset
						? undefined
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
	if (mission.currentStage === stageId) {
		return true;
	}
	return Object.values(input.tasks).some((task) => task.missionId === missionId && task.stageId === stageId);
}