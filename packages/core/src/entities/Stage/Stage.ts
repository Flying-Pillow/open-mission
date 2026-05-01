import { Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import type { MissionStageId, MissionStageStatus } from '../../types.js';
import { Task } from '../Task/Task.js';
import type { MissionTaskState } from '../../types.js';
import {
	StageDataSchema,
	StageCommandAcknowledgementSchema,
	StageExecuteCommandInputSchema,
	StageLocatorSchema,
	StageCommandIds,
	stageEntityName,
	type StageDataType
} from './StageSchema.js';
import type { MissionSnapshotType } from '../Mission/MissionSchema.js';

export function createStage(input: StageDataType): StageDataType {
	return StageDataSchema.parse({
		...input,
		artifacts: input.artifacts.map((artifact) => structuredClone(artifact)),
		tasks: input.tasks.map((task) => structuredClone(task))
	});
}

export class Stage extends Entity<StageDataType, string> {
	public static override readonly entityName = stageEntityName;

	public constructor(data: StageDataType) {
		super(StageDataSchema.parse(data));
	}

	public get id(): string {
		return this.data.stageId;
	}

	public static async read(payload: unknown, context: EntityExecutionContext) {
		const input = StageLocatorSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			return Stage.requireData(await mission.buildMissionSnapshot(), input.stageId);
		} finally {
			mission.dispose();
		}
	}

	public static requireData(snapshot: MissionSnapshotType, stageId: string) {
		const stage = snapshot.stages.find((candidate) => candidate.stageId === stageId);
		if (!stage) {
			throw new Error(`Stage '${stageId}' could not be resolved in Mission '${snapshot.mission.missionId}'.`);
		}
		return StageDataSchema.parse(stage);
	}

	public static async resolve(payload: unknown, context: EntityExecutionContext): Promise<Stage> {
		const input = StageExecuteCommandInputSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			return new Stage(Stage.requireData(await mission.buildMissionSnapshot(), input.stageId));
		} finally {
			mission.dispose();
		}
	}

	public async executeCommand(payload: unknown, context: EntityExecutionContext) {
		const input = StageExecuteCommandInputSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			Stage.requireData(await mission.buildMissionSnapshot(), input.stageId);
			if (input.commandId !== StageCommandIds.generateTasks) {
				throw new Error(`Stage command '${input.commandId}' is not implemented in the daemon.`);
			}
			await mission.generateTasksForStage(input.stageId as MissionStageId);
			return StageCommandAcknowledgementSchema.parse({
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

}

async function loadMissionRegistry(context: EntityExecutionContext) {
	const { requireMissionRegistry } = await import('../../daemon/MissionRegistry.js');
	return requireMissionRegistry(context);
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