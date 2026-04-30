import type { EntityExecutionContext } from '../Entity/Entity.js';
import type { MissionStageId, MissionStageStatus } from '../../types.js';
import type { Artifact } from '../Artifact/Artifact.js';
import type { TaskData } from '../Task/Task.js';
import { Task } from '../Task/Task.js';
import type { MissionTaskState } from '../../types.js';
import {
	missionStageSnapshotSchema,
	stageCommandAcknowledgementSchema,
	stageExecuteCommandPayloadSchema,
	stageIdentityPayloadSchema
} from './StageSchema.js';

export type Stage = {
	stageId: MissionStageId;
	lifecycle: MissionStageStatus['status'];
	isCurrentStage: boolean;
	artifacts: Artifact[];
	tasks: TaskData[];
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

export class StageEntity {
	public static async read(payload: unknown, context: EntityExecutionContext) {
		const input = stageIdentityPayloadSchema.parse(payload);
		const service = await loadMissionDaemon(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			return missionStageSnapshotSchema.parse(service.requireStage(await service.buildMissionSnapshot(mission, input.missionId), input.stageId));
		} finally {
			mission.dispose();
		}
	}

	public static async executeCommand(payload: unknown, context: EntityExecutionContext) {
		const input = stageExecuteCommandPayloadSchema.parse(payload);
		const service = await loadMissionDaemon(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			service.requireStage(await service.buildMissionSnapshot(mission, input.missionId), input.stageId);
			await mission.executeOperatorAction(StageEntity.resolveActionId(input.commandId, input.stageId), []);
			return stageCommandAcknowledgementSchema.parse({
				ok: true,
				entity: 'Stage',
				method: 'executeCommand',
				id: input.stageId,
				missionId: input.missionId,
				stageId: input.stageId,
				commandId: input.commandId
			});
		} finally {
			mission.dispose();
		}
	}

	private static resolveActionId(commandId: string, stageId: string): string {
		if (commandId === 'stage.generateTasks') {
			return `generation.tasks.${stageId}`;
		}
		throw new Error(`Stage command '${commandId}' is not implemented in the daemon.`);
	}
}

async function loadMissionDaemon(context: EntityExecutionContext) {
	const { requireMissionDaemon } = await import('../../daemon/MissionDaemon.js');
	return requireMissionDaemon(context);
}

export function isMissionDelivered(stages: MissionStageStatus[]): boolean {
	return stages.some((stage) => stage.stage === 'delivery' && stage.status === 'completed');
}

export function resolveActiveStageTasks(stage: MissionStageStatus | undefined): MissionTaskState[] {
	return stage ? stage.tasks.filter((task) => Task.isActive(task)) : [];
}

export function resolveReadyStageTasks(stage: MissionStageStatus | undefined): MissionTaskState[] {
	return stage ? stage.tasks.filter((task) => Task.isReady(task)) : [];
}