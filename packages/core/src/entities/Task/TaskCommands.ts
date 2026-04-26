import type { EntityCommandDescriptor } from '../../schemas/EntityRemote.js';
import {
    missionTaskSnapshotSchema,
    taskCommandAcknowledgementSchema,
    taskCommandListSnapshotSchema,
    taskExecuteCommandPayloadSchema,
    taskIdentityPayloadSchema,
    type MissionTaskSnapshot,
    type TaskCommandAcknowledgement,
    type TaskCommandListSnapshot,
    type TaskExecuteCommandPayload,
    type TaskIdentityPayload
} from '../../schemas/Task.js';
import type { OperatorActionDescriptor } from '../../types.js';
import {
    buildMissionSnapshot,
    getTerminalSessionName,
    loadRequiredMissionRuntime,
    requireTask,
    type MissionCommandContext
} from '../Mission/MissionRuntimeAccess.js';

export class TaskCommands {
    public static async read(
        input: TaskIdentityPayload,
        context: MissionCommandContext
    ): Promise<MissionTaskSnapshot> {
        const payload = taskIdentityPayloadSchema.parse(input);
        const mission = await loadRequiredMissionRuntime(payload, context);
        try {
            return missionTaskSnapshotSchema.parse(requireTask(await buildMissionSnapshot(mission, payload.missionId), payload.taskId));
        } finally {
            mission.dispose();
        }
    }

    public static async listCommands(
        input: TaskIdentityPayload,
        context: MissionCommandContext
    ): Promise<TaskCommandListSnapshot> {
        const payload = taskIdentityPayloadSchema.parse(input);
        const mission = await loadRequiredMissionRuntime(payload, context);
        try {
            const snapshot = await buildMissionSnapshot(mission, payload.missionId);
            requireTask(snapshot, payload.taskId);
            const actions = await mission.listAvailableActionsSnapshot();
            return taskCommandListSnapshotSchema.parse({
                entity: 'Task',
                entityId: payload.taskId,
                missionId: payload.missionId,
                taskId: payload.taskId,
                commands: toEntityCommandDescriptors(actions.actions, taskCommandMappings(payload.taskId))
            });
        } finally {
            mission.dispose();
        }
    }

    public static async executeCommand(
        input: TaskExecuteCommandPayload,
        context: MissionCommandContext
    ): Promise<TaskCommandAcknowledgement> {
        const payload = taskExecuteCommandPayloadSchema.parse(input);
        const terminalSessionName = getTerminalSessionName(payload.input);
        const mission = await loadRequiredMissionRuntime(payload, context, terminalSessionName);
        try {
            requireTask(await buildMissionSnapshot(mission, payload.missionId), payload.taskId);
            switch (payload.commandId) {
                case 'task.start':
                    await mission.startTask(payload.taskId, terminalSessionName ? { terminalSessionName } : {});
                    break;
                case 'task.complete':
                    await mission.completeTask(payload.taskId);
                    break;
                case 'task.reopen':
                    await mission.reopenTask(payload.taskId);
                    break;
                default:
                    throw new Error(`Task command '${payload.commandId}' is not implemented in the daemon.`);
            }
            return taskCommandAcknowledgementSchema.parse({
                ok: true,
                entity: 'Task',
                method: 'executeCommand',
                id: payload.taskId,
                missionId: payload.missionId,
                taskId: payload.taskId,
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

function taskCommandMappings(taskId: string): EntityActionCommandMapping[] {
    return [
        { actionId: `task.start.${taskId}`, commandId: 'task.start' },
        { actionId: `task.done.${taskId}`, commandId: 'task.complete' },
        { actionId: `task.reopen.${taskId}`, commandId: 'task.reopen' }
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
