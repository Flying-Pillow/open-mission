import type { MissionStageId, MissionStageStatus } from '../types.js';
import type { Artifact } from './Artifact.js';
import type { Task } from './Task.js';

export type Stage = {
	stageId: MissionStageId;
	lifecycle: MissionStageStatus['status'];
	isCurrentStage: boolean;
	artifacts: Artifact[];
	tasks: Task[];
};

export function createStage(input: Stage): Stage {
	return {
		stageId: input.stageId,
		lifecycle: input.lifecycle,
		isCurrentStage: input.isCurrentStage,
		artifacts: input.artifacts.map((artifact) => structuredClone(artifact)),
		tasks: input.tasks.map((task) => structuredClone(task))
	};
}
