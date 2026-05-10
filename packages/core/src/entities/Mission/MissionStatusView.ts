import type { AgentExecutionRecord } from '../AgentExecution/AgentExecutionSchema.js';
import type { MissionDossierFilesystem } from './MissionDossierFilesystem.js';
import {
	MISSION_ARTIFACTS,
	MISSION_STAGES,
	MISSION_STAGE_FOLDERS,
	type MissionArtifactKey,
	type MissionStageId
} from '../../workflow/mission/manifest.js';
import type {
	MissionDescriptor,
	MissionStageStatus,
	MissionTaskState,
	OperatorStatus
} from './MissionSchema.js';
import { DEFAULT_WORKFLOW_VERSION } from '../../workflow/mission/workflow.js';
import {
	createDraftMissionWorkflowRuntimeState,
	createMissionWorkflowConfigurationSnapshot,
	type MissionStateData,
	type WorkflowDefinition
} from '../../workflow/engine/index.js';
import { Task } from '../Task/Task.js';
import { Stage } from '../Stage/Stage.js';

export type MissionStatusViewInput = {
	adapter: MissionDossierFilesystem;
	missionDir: string;
	descriptor: MissionDescriptor;
	workflow: WorkflowDefinition;
	document?: MissionStateData;
	agentExecutions: AgentExecutionRecord[];
	hydrateRuntimeTasksForActions(tasks: MissionStateData['runtime']['tasks']): Promise<MissionStateData['runtime']['tasks']>;
};

export async function buildMissionStatusView(input: MissionStatusViewInput): Promise<OperatorStatus> {
	if (!input.document) {
		return buildDraftMissionStatusView(input);
	}

	const hydratedWorkflowTasks = await input.hydrateRuntimeTasksForActions(input.document.runtime.tasks);
	const stages = await buildWorkflowStageStatuses(input, input.document);
	const projectedTasksById = new Map(stages.flatMap((stage) => stage.tasks).map((task) => [task.taskId, task]));
	const currentStageId = resolveCurrentMissionStage(input.document);
	const currentStage = stages.find((stage) => stage.stage === currentStageId) ?? stages[0];
	const activeTasks = Stage.resolveActiveTasks(currentStage);
	const readyTasks = Stage.resolveReadyTasks(currentStage);
	const productFiles = await collectMissionArtifactPaths({ adapter: input.adapter, missionDir: input.missionDir });

	return {
		found: true,
		missionId: input.descriptor.missionId,
		title: input.descriptor.brief.title,
		...(input.descriptor.brief.issueId !== undefined ? { issueId: input.descriptor.brief.issueId } : {}),
		...(input.descriptor.brief.assignee ? { assignee: input.descriptor.brief.assignee } : {}),
		type: input.descriptor.brief.type,
		stage: currentStageId,
		branchRef: input.descriptor.branchRef,
		missionDir: input.adapter.getMissionWorkspacePath(input.missionDir),
		missionRootDir: input.missionDir,
		productFiles,
		...(activeTasks.length > 0 ? { activeTasks } : {}),
		...(readyTasks.length > 0 ? { readyTasks } : {}),
		stages,
		agentExecutions: input.agentExecutions,
		workflow: {
			lifecycle: input.document.runtime.lifecycle,
			pause: { ...input.document.runtime.pause },
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
				context: (task.context ?? []).map((contextArtifact) => ({ ...contextArtifact })),
				waitingOnTaskIds: [...task.waitingOnTaskIds],
				runtime: { ...task.runtime }
			})),
			gates: input.document.runtime.gates.map((gateView) => ({
				...gateView,
				reasons: [...gateView.reasons]
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

async function buildDraftMissionStatusView(input: MissionStatusViewInput): Promise<OperatorStatus> {
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
	const productFiles = await collectMissionArtifactPaths({ adapter: input.adapter, missionDir: input.missionDir });

	return {
		found: true,
		missionId: input.descriptor.missionId,
		title: input.descriptor.brief.title,
		...(input.descriptor.brief.issueId !== undefined ? { issueId: input.descriptor.brief.issueId } : {}),
		...(input.descriptor.brief.assignee ? { assignee: input.descriptor.brief.assignee } : {}),
		type: input.descriptor.brief.type,
		stage: currentStageId,
		branchRef: input.descriptor.branchRef,
		missionDir: input.adapter.getMissionWorkspacePath(input.missionDir),
		missionRootDir: input.missionDir,
		productFiles,
		stages,
		agentExecutions: [],
		workflow: {
			lifecycle: runtime.lifecycle,
			pause: { ...runtime.pause },
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
			gates: runtime.gates.map((gateView) => ({
				...gateView,
				reasons: [...gateView.reasons]
			})),
			updatedAt: runtime.updatedAt
		},
		recommendedAction: 'Mission is still draft. Start the workflow to capture repository settings and initialize tasks.'
	};
}

async function buildWorkflowStageStatuses(
	input: MissionStatusViewInput,
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

async function collectMissionArtifactPaths(input: {
	adapter: MissionDossierFilesystem;
	missionDir: string;
}): Promise<Partial<Record<MissionArtifactKey, string>>> {
	const entries = await Promise.all(
		(Object.keys(MISSION_ARTIFACTS) as MissionArtifactKey[]).map(async (artifact) => {
			const record = await input.adapter.readArtifactRecord(input.missionDir, artifact);
			const exists = await input.adapter.artifactExists(input.missionDir, artifact);
			return exists && record?.filePath ? ([artifact, record.filePath] as const) : undefined;
		})
	);

	const result: Partial<Record<MissionArtifactKey, string>> = {};
	for (const entry of entries) {
		if (!entry) {
			continue;
		}
		result[entry[0]] = entry[1];
	}
	return result;
}

function buildRecommendedAction(
	stage: MissionStageId,
	activeTasks: MissionTaskState[],
	readyTasks: MissionTaskState[],
	stages: MissionStageStatus[]
): string {
	if (Stage.isMissionDelivered(stages)) {
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