import type {
	MissionStageId,
	MissionTaskState
} from '../../types.js';

export type Task = {
	taskId: string;
	stageId: MissionStageId;
	sequence: number;
	title: string;
	instruction: string;
	lifecycle: MissionTaskState['status'];
	dependsOn: string[];
	waitingOnTaskIds: string[];
	agentRunner: string;
	retries: number;
	fileName?: string;
	filePath?: string;
	relativePath?: string;
};

export function toTask(task: MissionTaskState): Task {
	return {
		taskId: task.taskId,
		stageId: task.stage,
		sequence: task.sequence,
		title: task.subject,
		instruction: task.instruction,
		lifecycle: task.status,
		dependsOn: [...task.dependsOn],
		waitingOnTaskIds: [...task.waitingOn],
		agentRunner: task.agent,
		retries: task.retries,
		...(task.fileName ? { fileName: task.fileName } : {}),
		...(task.filePath ? { filePath: task.filePath } : {}),
		...(task.relativePath ? { relativePath: task.relativePath } : {})
	};
}