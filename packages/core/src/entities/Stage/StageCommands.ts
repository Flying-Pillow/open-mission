import type { EntityCommandDescriptor } from '../../schemas/EntityRemote.js';
import {
    missionStageSnapshotSchema,
    stageCommandAcknowledgementSchema,
    stageCommandListSnapshotSchema,
    stageExecuteCommandPayloadSchema,
    stageIdentityPayloadSchema,
    type MissionStageSnapshot,
    type StageCommandAcknowledgement,
    type StageCommandListSnapshot,
    type StageExecuteCommandPayload,
    type StageIdentityPayload
} from '../../schemas/Stage.js';
import type { OperatorActionDescriptor } from '../../types.js';
import {
    buildMissionSnapshot,
    loadRequiredMissionRuntime,
    requireStage,
    type MissionCommandContext
} from '../Mission/MissionRuntimeAccess.js';

export class StageCommands {
    public static async read(
        input: StageIdentityPayload,
        context: MissionCommandContext
    ): Promise<MissionStageSnapshot> {
        const payload = stageIdentityPayloadSchema.parse(input);
        const mission = await loadRequiredMissionRuntime(payload, context);
        try {
            return missionStageSnapshotSchema.parse(requireStage(await buildMissionSnapshot(mission, payload.missionId), payload.stageId));
        } finally {
            mission.dispose();
        }
    }

    public static async listCommands(
        input: StageIdentityPayload,
        context: MissionCommandContext
    ): Promise<StageCommandListSnapshot> {
        const payload = stageIdentityPayloadSchema.parse(input);
        const mission = await loadRequiredMissionRuntime(payload, context);
        try {
            const snapshot = await buildMissionSnapshot(mission, payload.missionId);
            requireStage(snapshot, payload.stageId);
            const actions = await mission.listAvailableActionsSnapshot();
            return stageCommandListSnapshotSchema.parse({
                entity: 'Stage',
                entityId: payload.stageId,
                missionId: payload.missionId,
                stageId: payload.stageId,
                commands: toEntityCommandDescriptors(actions.actions, stageCommandMappings(payload.stageId))
            });
        } finally {
            mission.dispose();
        }
    }

    public static async executeCommand(
        input: StageExecuteCommandPayload,
        context: MissionCommandContext
    ): Promise<StageCommandAcknowledgement> {
        const payload = stageExecuteCommandPayloadSchema.parse(input);
        const mission = await loadRequiredMissionRuntime(payload, context);
        try {
            requireStage(await buildMissionSnapshot(mission, payload.missionId), payload.stageId);
            await mission.executeAction(resolveStageActionId(payload.commandId, payload.stageId), []);
            return stageCommandAcknowledgementSchema.parse({
                ok: true,
                entity: 'Stage',
                method: 'executeCommand',
                id: payload.stageId,
                missionId: payload.missionId,
                stageId: payload.stageId,
                commandId: payload.commandId
            });
        } finally {
            mission.dispose();
        }
    }
}

type EntityActionCommandMapping = {
    actionId: string;
    commandId: string;
};

function stageCommandMappings(stageId: string): EntityActionCommandMapping[] {
    return [
        { actionId: `generation.tasks.${stageId}`, commandId: 'stage.generateTasks' }
    ];
}

function toEntityCommandDescriptors(
    actions: OperatorActionDescriptor[],
    mappings: EntityActionCommandMapping[]
): EntityCommandDescriptor[] {
    return mappings.flatMap((mapping) => {
        const action = actions.find((candidate) => candidate.id === mapping.actionId);
        if (!action) {
            return [];
        }

        return [{
            commandId: mapping.commandId,
            label: action.label,
            ...(action.reason ? { description: action.reason } : {}),
            disabled: action.disabled,
            ...(action.disabledReason ? { disabledReason: action.disabledReason } : {}),
            ...(action.ui?.requiresConfirmation
                ? {
                    confirmation: {
                        required: true,
                        ...(action.ui.confirmationPrompt ? { prompt: action.ui.confirmationPrompt } : {})
                    }
                }
                : {})
        }];
    });
}

function resolveStageActionId(commandId: string, stageId: string): string {
    if (commandId === 'stage.generateTasks') {
        return `generation.tasks.${stageId}`;
    }
    throw new Error(`Stage command '${commandId}' is not implemented in the daemon.`);
}
