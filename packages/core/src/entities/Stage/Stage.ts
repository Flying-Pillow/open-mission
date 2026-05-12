import { createEntityId, Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import type { MissionStageId } from '../../workflow/mission/manifest.js';
import { Task } from '../Task/Task.js';
import {
	StageDataSchema,
	StageCommandAcknowledgementSchema,
	StageCommandInputSchema,
	StageLocatorSchema,
	StageCommandIds,
	stageEntityName,
	type StageDataType,
	type StageStatusViewType
} from './StageSchema.js';
import type { MissionType } from '../Mission/MissionSchema.js';
import type { TaskDossierRecordType } from '../Task/TaskSchema.js';

export class Stage extends Entity<StageDataType, string> {
	public static override readonly entityName = stageEntityName;

	public static create(input: StageDataType): StageDataType {
		return StageDataSchema.parse({
			...input,
			artifacts: input.artifacts.map((artifact) => structuredClone(artifact)),
			tasks: input.tasks.map((task) => structuredClone(task))
		});
	}

	public static createEntityId(missionId: string, stageId: string): string {
		return createEntityId('stage', `${missionId}/${stageId}`);
	}

	public static isMissionDelivered(stages: StageStatusViewType[]): boolean {
		return stages.some((stage) => stage.stage === 'delivery' && stage.status === 'completed');
	}

	public static resolveActiveTasks(stage: StageStatusViewType | undefined): TaskDossierRecordType[] {
		return stage ? stage.tasks.filter((task) => Task.isActive(task)) : [];
	}

	public static resolveReadyTasks(stage: StageStatusViewType | undefined): TaskDossierRecordType[] {
		return stage ? stage.tasks.filter((task) => Task.isReady(task)) : [];
	}

	public constructor(data: StageDataType) {
		super(StageDataSchema.parse(data));
	}

	public get id(): string {
		return this.data.id;
	}

	public get stageId(): string {
		return this.data.stageId;
	}

	public static async read(payload: unknown, context: EntityExecutionContext) {
		const input = StageLocatorSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			return Stage.requireData(await mission.buildMission(), input.stageId);
		} finally {
			mission.dispose();
		}
	}

	public static requireData(data: MissionType, stageId: string) {
		const stage = data.stages.find((candidate) => candidate.stageId === stageId);
		if (!stage) {
			throw new Error(`Stage '${stageId}' could not be resolved in Mission '${data.missionId}'.`);
		}
		return StageDataSchema.parse(stage);
	}

	public static async resolve(payload: unknown, context: EntityExecutionContext): Promise<Stage> {
		const input = StageLocatorSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			return new Stage(Stage.requireData(await mission.buildMission(), input.stageId));
		} finally {
			mission.dispose();
		}
	}

	public async canGenerateTasks() {
		if (!this.data.isCurrentStage) {
			return this.unavailable('Stage is not the current Mission stage.');
		}
		if (this.data.tasks.length > 0) {
			return this.unavailable('Stage already has tasks.');
		}
		return this.available();
	}

	public async generateTasks(payload: unknown, context: EntityExecutionContext) {
		const input = StageLocatorSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			Stage.requireData(await mission.buildMission(), input.stageId);
			await mission.generateTasksForStage(input.stageId as MissionStageId);
			return StageCommandAcknowledgementSchema.parse({
				ok: true,
				entity: 'Stage',
				method: 'generateTasks',
				id: input.stageId,
				missionId: input.missionId,
				stageId: input.stageId,
				commandId: StageCommandIds.generateTasks
			});
		} finally {
			mission.dispose();
		}
	}

	public async command(payload: unknown, context: EntityExecutionContext) {
		const input = StageCommandInputSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			Stage.requireData(await mission.buildMission(), input.stageId);
			if (input.commandId !== StageCommandIds.generateTasks) {
				throw new Error(`Stage command '${input.commandId}' is not implemented in the daemon.`);
			}
			await mission.generateTasksForStage(input.stageId as MissionStageId);
			return StageCommandAcknowledgementSchema.parse({
				ok: true,
				entity: 'Stage',
				method: 'command',
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