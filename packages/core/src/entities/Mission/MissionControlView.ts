import {
    MissionControlSchema,
    MissionSchema,
    MissionWorkflowStateSchema,
    type MissionStorageType,
    type MissionControlType,
    type MissionType,
    type MissionWorkflowStateType
} from './MissionSchema.js';
import { EntityCommandDescriptorSchema, type EntityCommandDescriptorType } from '../Entity/EntitySchema.js';
import { StageSchema, type StageType } from '../Stage/StageSchema.js';
import type { WorkflowStateData } from '../../workflow/engine/index.js';

export function buildMission(input: {
    missionId: string;
    mission: MissionStorageType;
    commands: EntityCommandDescriptorType[];
    stages?: StageType[];
    workflowDocument?: WorkflowStateData;
}): MissionType {
    EntityCommandDescriptorSchema.array().parse(input.commands);
    const stages = input.stages
        ? StageSchema.array().parse(input.stages)
        : input.mission.stages;
    const workflow = toMissionWorkflowState(input.mission, input.workflowDocument);
    return MissionSchema.parse({
        ...input.mission,
        ...(workflow ? { workflow } : {}),
        commands: input.commands,
        stages,
        tasks: stages.flatMap((stage) => stage.tasks),
        artifacts: input.mission.artifacts,
        agentExecutions: input.mission.agentExecutions
    });
}

export function buildMissionControl(input: {
    data: MissionType;
}): MissionControlType {
    return MissionControlSchema.parse({
        missionId: input.data.missionId,
        mission: input.data,
        updatedAt: input.data.updatedAt
    });
}

function toMissionWorkflowState(
    data: MissionStorageType,
    workflowDocument?: WorkflowStateData
): MissionWorkflowStateType | undefined {
    const runtime = workflowDocument?.runtime;
    if (!data.lifecycle && !data.updatedAt && !data.currentStageId && !runtime) {
        return undefined;
    }

    return MissionWorkflowStateSchema.parse({
        ...(data.lifecycle ? { lifecycle: data.lifecycle } : {}),
        ...(data.updatedAt ? { updatedAt: data.updatedAt } : {}),
        ...(runtime?.activeStageId ?? data.currentStageId
            ? { currentStageId: runtime?.activeStageId ?? data.currentStageId }
            : {}),
        ...(runtime?.pause ? { pause: runtime.pause } : {}),
        ...(runtime?.stages ? { stages: runtime.stages } : {}),
        ...(runtime?.tasks ? { tasks: runtime.tasks } : {}),
        ...(runtime?.gates ? { gates: runtime.gates } : {})
    });
}
