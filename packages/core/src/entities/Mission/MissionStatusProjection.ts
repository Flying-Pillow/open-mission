import * as path from 'node:path';
import type { AgentSessionRecord } from '../../daemon/protocol/contracts.js';
import type { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import {
	MISSION_ARTIFACTS,
	MISSION_STAGES,
	MISSION_STAGE_FOLDERS,
	type MissionArtifactKey,
	type MissionDescriptor,
	type MissionStageId,
	type MissionStageStatus,
	type MissionTaskState,
	type MissionTowerProjection,
	type MissionTowerStageRailItem,
	type MissionTowerTreeNode,
	type OperatorStatus
} from '../../types.js';
import { DEFAULT_WORKFLOW_VERSION } from '../../workflow/mission/workflow.js';
import {
	createDraftMissionWorkflowRuntimeState,
	createMissionWorkflowConfigurationSnapshot,
	type MissionStateData,
	type WorkflowDefinition
} from '../../workflow/engine/index.js';
import { getMissionStageDefinition } from '../../workflow/mission/manifest.js';
import { collectArtifactFiles } from '../Artifact/Artifact.js';
import { Task } from '../Task/Task.js';
import {
	isMissionDelivered,
	resolveActiveStageTasks,
	resolveReadyStageTasks
} from '../Stage/Stage.js';

export type MissionStatusProjectionInput = {
	adapter: FilesystemAdapter;
	missionDir: string;
	descriptor: MissionDescriptor;
	workflow: WorkflowDefinition;
	document?: MissionStateData;
	sessions: AgentSessionRecord[];
	hydrateRuntimeTasksForActions(tasks: MissionStateData['runtime']['tasks']): Promise<MissionStateData['runtime']['tasks']>;
};

export async function buildMissionStatusProjection(input: MissionStatusProjectionInput): Promise<OperatorStatus> {
	if (!input.document) {
		return buildDraftMissionStatusProjection(input);
	}

	const hydratedWorkflowTasks = await input.hydrateRuntimeTasksForActions(input.document.runtime.tasks);
	const stages = await buildWorkflowStageStatuses(input, input.document);
	const projectedTasksById = new Map(stages.flatMap((stage) => stage.tasks).map((task) => [task.taskId, task]));
	const currentStageId = resolveCurrentMissionStage(input.document);
	const currentStage = stages.find((stage) => stage.stage === currentStageId) ?? stages[0];
	const activeTasks = resolveActiveStageTasks(currentStage);
	const readyTasks = resolveReadyStageTasks(currentStage);
	const productFiles = await collectArtifactFiles({ adapter: input.adapter, missionDir: input.missionDir });
	const tower = buildTowerProjection(input.document.configuration, stages, input.sessions, productFiles);

	return {
		found: true,
		missionId: input.descriptor.missionId,
		title: input.descriptor.brief.title,
		...(input.descriptor.brief.issueId !== undefined ? { issueId: input.descriptor.brief.issueId } : {}),
		type: input.descriptor.brief.type,
		stage: currentStageId,
		branchRef: input.descriptor.branchRef,
		missionDir: input.adapter.getMissionWorkspacePath(input.missionDir),
		missionRootDir: input.missionDir,
		productFiles,
		...(activeTasks.length > 0 ? { activeTasks } : {}),
		...(readyTasks.length > 0 ? { readyTasks } : {}),
		stages,
		agentSessions: input.sessions,
		tower,
		workflow: {
			lifecycle: input.document.runtime.lifecycle,
			pause: { ...input.document.runtime.pause },
			panic: { ...input.document.runtime.panic },
			...(currentStageId ? { currentStageId } : {}),
			configuration: input.document.configuration,
			stages: input.document.runtime.stages.map((stage) => ({
				...stage,
				taskIds: [...stage.taskIds],
				readyTaskIds: [...stage.readyTaskIds],
				queuedTaskIds: [...stage.queuedTaskIds],
				runningTaskIds: [...stage.runningTaskIds],
				completedTaskIds: [...stage.completedTaskIds]
			})),
			tasks: hydratedWorkflowTasks.map((task) => ({
				...task,
				title: projectedTasksById.get(task.taskId)?.subject ?? task.title,
				dependsOn: [...task.dependsOn],
				waitingOnTaskIds: [...task.waitingOnTaskIds],
				runtime: { ...task.runtime }
			})),
			gates: input.document.runtime.gates.map((gateProjection) => ({
				...gateProjection,
				reasons: [...gateProjection.reasons]
			})),
			updatedAt: input.document.runtime.updatedAt
		},
		recommendedAction: buildRecommendedAction(currentStageId, activeTasks, readyTasks, stages)
	};
}

export function resolveCurrentMissionStage(document: MissionStateData): MissionStageId {
	return ((
		(document.runtime.activeStageId as MissionStageId | undefined) ??
		(document.runtime.stages.find((stage) => stage.lifecycle !== 'completed')?.stageId as MissionStageId | undefined) ??
		(document.configuration.workflow.stageOrder[
			document.configuration.workflow.stageOrder.length - 1
		] as MissionStageId | undefined) ??
		'prd'
	) as MissionStageId);
}

async function buildDraftMissionStatusProjection(input: MissionStatusProjectionInput): Promise<OperatorStatus> {
	const configuration = createMissionWorkflowConfigurationSnapshot({
		createdAt: input.descriptor.createdAt,
		workflowVersion: DEFAULT_WORKFLOW_VERSION,
		workflow: input.workflow
	});
	const runtime = createDraftMissionWorkflowRuntimeState(configuration, input.descriptor.createdAt);
	const stages: MissionStageStatus[] = MISSION_STAGES.map((stageId) => ({
		stage: stageId,
		folderName: MISSION_STAGE_FOLDERS[stageId],
		status: 'pending',
		taskCount: 0,
		completedTaskCount: 0,
		activeTaskIds: [],
		readyTaskIds: [],
		tasks: []
	}));
	const currentStageId = (input.workflow.stageOrder[0] as MissionStageId | undefined) ?? 'prd';
	const productFiles = await collectArtifactFiles({ adapter: input.adapter, missionDir: input.missionDir });
	const tower = buildTowerProjection(configuration, stages, [], productFiles);

	return {
		found: true,
		missionId: input.descriptor.missionId,
		title: input.descriptor.brief.title,
		...(input.descriptor.brief.issueId !== undefined ? { issueId: input.descriptor.brief.issueId } : {}),
		type: input.descriptor.brief.type,
		stage: currentStageId,
		branchRef: input.descriptor.branchRef,
		missionDir: input.adapter.getMissionWorkspacePath(input.missionDir),
		missionRootDir: input.missionDir,
		productFiles,
		stages,
		agentSessions: [],
		tower,
		workflow: {
			lifecycle: runtime.lifecycle,
			pause: { ...runtime.pause },
			panic: { ...runtime.panic },
			currentStageId,
			configuration,
			stages: runtime.stages.map((stage) => ({
				...stage,
				taskIds: [...stage.taskIds],
				readyTaskIds: [...stage.readyTaskIds],
				queuedTaskIds: [...stage.queuedTaskIds],
				runningTaskIds: [...stage.runningTaskIds],
				completedTaskIds: [...stage.completedTaskIds]
			})),
			tasks: [],
			gates: runtime.gates.map((gateProjection) => ({
				...gateProjection,
				reasons: [...gateProjection.reasons]
			})),
			updatedAt: runtime.updatedAt
		},
		recommendedAction: 'Mission is still draft. Start the workflow to capture repository settings and initialize tasks.'
	};
}

async function buildWorkflowStageStatuses(
	input: MissionStatusProjectionInput,
	document: MissionStateData
): Promise<MissionStageStatus[]> {
	return Promise.all(MISSION_STAGES.map(async (stageId) => {
		const runtimeStage = document.runtime.stages.find((stage) => stage.stageId === stageId);
		const runtimeTasks = document.runtime.tasks.filter((task) => task.stageId === stageId);
		const runtimeTasksById = new Map(runtimeTasks.map((task, index) => [task.taskId, { task, index }]));
		const fileTasks = await input.adapter.listTaskStates(input.missionDir, stageId).catch(() => []);
		const fileTaskIds = new Set(fileTasks.map((task) => task.taskId));
		const tasks: MissionTaskState[] = [];

		for (const fileTask of fileTasks) {
			const runtimeTaskEntry = runtimeTasksById.get(fileTask.taskId);
			if (runtimeTaskEntry) {
				tasks.push(Task.fromWorkflowState({
					task: runtimeTaskEntry.task,
					index: runtimeTaskEntry.index,
					missionDir: input.missionDir,
					fileTask
				}));
				continue;
			}
			tasks.push({
				...fileTask,
				waitingOn: [...fileTask.waitingOn],
				status: 'pending'
			});
		}

		for (const [taskId, runtimeTaskEntry] of runtimeTasksById.entries()) {
			if (fileTaskIds.has(taskId)) {
				continue;
			}
			tasks.push(Task.fromWorkflowState({
				task: runtimeTaskEntry.task,
				index: runtimeTaskEntry.index,
				missionDir: input.missionDir
			}));
		}

		tasks.sort((left, right) => left.sequence - right.sequence || left.taskId.localeCompare(right.taskId));
		return {
			stage: stageId,
			folderName: MISSION_STAGE_FOLDERS[stageId],
			status: runtimeStage?.lifecycle ?? 'pending',
			taskCount: tasks.length,
			completedTaskCount: tasks.filter((task) => task.status === 'completed').length,
			activeTaskIds: tasks
				.filter((task) => task.status === 'queued' || task.status === 'running')
				.map((task) => task.taskId),
			readyTaskIds: tasks.filter((task) => Task.isReady(task)).map((task) => task.taskId),
			tasks
		};
	}));
}

function buildTowerProjection(
	configuration: MissionStateData['configuration'],
	stages: MissionStageStatus[],
	sessions: AgentSessionRecord[],
	productFiles: Partial<Record<MissionArtifactKey, string>>
): MissionTowerProjection {
	return {
		stageRail: stages.map((stage) => toTowerStageRailItem(stage, configuration)),
		treeNodes: buildTowerTreeNodes(configuration, stages, sessions, productFiles)
	};
}

function toTowerStageRailItem(
	stage: MissionStageStatus,
	configuration: MissionStateData['configuration']
): MissionTowerStageRailItem {
	return {
		id: stage.stage,
		label: resolveTowerStageLabel(stage.stage, configuration),
		state: stage.status,
		subtitle: `${String(stage.completedTaskCount)}/${String(stage.taskCount)}`
	};
}

function buildTowerTreeNodes(
	configuration: MissionStateData['configuration'],
	stages: MissionStageStatus[],
	sessions: AgentSessionRecord[],
	productFiles: Partial<Record<MissionArtifactKey, string>>
): MissionTowerTreeNode[] {
	const nodes: MissionTowerTreeNode[] = [];
	const missionArtifactPath = productFiles.brief;
	if (missionArtifactPath) {
		nodes.push({
			id: 'tree:mission-artifact:brief',
			label: MISSION_ARTIFACTS.brief,
			kind: 'mission-artifact',
			depth: 0,
			color: progressTone('pending'),
			statusLabel: 'Mission artifact',
			collapsible: false,
			sourcePath: missionArtifactPath
		});
	}
	for (const stage of stages) {
		const stageArtifactPath = resolveStageArtifactPath(stage.stage, productFiles);
		const stageStatusLabel = toStatusLabel(stage.status);
		nodes.push({
			id: `tree:stage:${stage.stage}`,
			label: resolveTowerStageLabel(stage.stage, configuration),
			kind: 'stage',
			depth: 0,
			color: progressTone(stage.status),
			statusLabel: stageStatusLabel,
			collapsible: Boolean(stageArtifactPath) || stage.tasks.length > 0,
			stageId: stage.stage
		});

		for (const task of stage.tasks) {
			const taskColor = progressTone(task.status);
			const taskStatusLabel = toStatusLabel(task.status);
			nodes.push({
				id: `tree:task:${task.taskId}`,
				label: `${String(task.sequence)} ${task.subject}`,
				kind: 'task',
				depth: 1,
				color: taskColor,
				statusLabel: taskStatusLabel,
				collapsible: Boolean(task.filePath) || sessions.some((session) => session.taskId === task.taskId),
				stageId: stage.stage,
				taskId: task.taskId
			});

			const taskSessions = sessions
				.filter((session) => session.taskId === task.taskId)
				.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
			for (const session of taskSessions) {
				nodes.push({
					id: `tree:session:${session.sessionId}`,
					label: `${session.runnerId} ${session.sessionId.slice(-4)}`,
					kind: 'session',
					depth: 2,
					color: sessionTone(session.lifecycleState, taskColor),
					statusLabel: toStatusLabel(session.lifecycleState),
					collapsible: false,
					stageId: stage.stage,
					taskId: task.taskId,
					sessionId: session.sessionId
				});
			}

			if (task.filePath) {
				nodes.push({
					id: `tree:task-artifact:${task.taskId}`,
					label: task.fileName,
					kind: 'task-artifact',
					depth: 2,
					color: taskColor,
					statusLabel: taskStatusLabel,
					collapsible: false,
					sourcePath: task.filePath,
					stageId: stage.stage,
					taskId: task.taskId
				});
			}
		}

		if (stageArtifactPath) {
			nodes.push({
				id: `tree:stage-artifact:${stage.stage}`,
				label: path.basename(stageArtifactPath),
				kind: 'stage-artifact',
				depth: 1,
				color: progressTone(stage.status),
				statusLabel: stageStatusLabel,
				collapsible: false,
				sourcePath: stageArtifactPath,
				stageId: stage.stage
			});
		}
	}
	return nodes;
}

function resolveTowerStageLabel(
	stageId: MissionStageId,
	configuration: MissionStateData['configuration']
): string {
	const configuredLabel = configuration.workflow.stages[stageId]?.displayName?.trim();
	if (configuredLabel) {
		return configuredLabel.toUpperCase();
	}
	return stageId.toUpperCase();
}

function resolveStageArtifactPath(
	stageId: MissionStageId,
	productFiles: Partial<Record<MissionArtifactKey, string>>
): string | undefined {
	for (const artifactKey of getMissionStageDefinition(stageId).artifacts) {
		const filePath = productFiles[artifactKey];
		if (filePath) {
			return filePath;
		}
	}
	return undefined;
}

function progressTone(status: MissionStageStatus['status'] | MissionTaskState['status']): string {
	if (status === 'completed') {
		return '#3fb950';
	}
	if (status === 'active' || status === 'queued' || status === 'running') {
		return '#58a6ff';
	}
	if (status === 'ready') {
		return '#79c0ff';
	}
	if (status === 'failed') {
		return '#f85149';
	}
	if (status === 'cancelled') {
		return '#ffa657';
	}
	return '#8b949e';
}

function sessionTone(state: string, fallbackColor: string): string {
	if (state === 'starting') {
		return '#79c0ff';
	}
	if (state === 'running') {
		return '#58a6ff';
	}
	if (state === 'terminated') {
		return '#9be9a8';
	}
	if (state === 'failed') {
		return '#f85149';
	}
	if (state === 'cancelled') {
		return '#d29922';
	}
	if (state === 'completed') {
		return '#3fb950';
	}
	return fallbackColor;
}

function toStatusLabel(state: string): string {
	const normalized = state.trim();
	return normalized.length > 0 ? normalized.replace(/[_-]+/g, ' ') : 'unknown';
}

function buildRecommendedAction(
	stage: MissionStageId,
	activeTasks: MissionTaskState[],
	readyTasks: MissionTaskState[],
	stages: MissionStageStatus[]
): string {
	if (isMissionDelivered(stages)) {
		return 'Mission delivered.';
	}

	if (activeTasks.length > 0) {
		const leadTask = activeTasks[0];
		return activeTasks.length === 1
			? `Continue ${leadTask?.relativePath}; Mission tracks workflow state in mission.json.`
			: `Continue ${leadTask?.relativePath} and ${String(activeTasks.length - 1)} other active task(s); Mission tracks workflow state in mission.json.`;
	}

	if (readyTasks.length > 0) {
		const leadTask = readyTasks[0];
		return readyTasks.length === 1
			? `Activate the ready task through Mission controls, then continue ${leadTask?.relativePath}.`
			: `Activate one or more ready tasks through Mission controls, starting with ${leadTask?.relativePath}.`;
	}

	if (stage === 'delivery') {
		return 'Complete DELIVERY.md and deliver the mission.';
	}

	return `Review tasks/${MISSION_STAGE_FOLDERS[stage]} and add the next task file.`;
}