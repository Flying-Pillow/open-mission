import type { EntityCommandDescriptor } from '../../schemas/EntityRemote.js';
import {
    agentSessionCommandAcknowledgementSchema,
    agentSessionCommandListSnapshotSchema,
    agentSessionExecuteCommandPayloadSchema,
    agentSessionIdentityPayloadSchema,
    agentSessionSendCommandPayloadSchema,
    agentSessionSendPromptPayloadSchema,
    missionAgentSessionSnapshotSchema,
    type AgentSessionCommandAcknowledgement,
    type AgentSessionCommandListSnapshot,
    type AgentSessionExecuteCommandPayload,
    type AgentSessionIdentityPayload,
    type AgentSessionSendCommandPayload,
    type AgentSessionSendPromptPayload,
    type MissionAgentSessionSnapshot
} from '../../schemas/AgentSession.js';
import type { OperatorActionDescriptor } from '../../types.js';
import {
    buildMissionSnapshot,
    getReason,
    loadRequiredMissionRuntime,
    normalizeAgentCommand,
    normalizeAgentPrompt,
    requireAgentSession,
    type MissionCommandContext
} from '../Mission/MissionRuntimeAccess.js';

export class AgentSessionCommands {
    public static async read(
        input: AgentSessionIdentityPayload,
        context: MissionCommandContext
    ): Promise<MissionAgentSessionSnapshot> {
        const payload = agentSessionIdentityPayloadSchema.parse(input);
        const mission = await loadRequiredMissionRuntime(payload, context);
        try {
            return missionAgentSessionSnapshotSchema.parse(requireAgentSession(await buildMissionSnapshot(mission, payload.missionId), payload.sessionId));
        } finally {
            mission.dispose();
        }
    }

    public static async listCommands(
        input: AgentSessionIdentityPayload,
        context: MissionCommandContext
    ): Promise<AgentSessionCommandListSnapshot> {
        const payload = agentSessionIdentityPayloadSchema.parse(input);
        const mission = await loadRequiredMissionRuntime(payload, context);
        try {
            const snapshot = await buildMissionSnapshot(mission, payload.missionId);
            requireAgentSession(snapshot, payload.sessionId);
            const actions = await mission.listAvailableActionsSnapshot();
            return agentSessionCommandListSnapshotSchema.parse({
                entity: 'AgentSession',
                entityId: payload.sessionId,
                missionId: payload.missionId,
                sessionId: payload.sessionId,
                commands: toEntityCommandDescriptors(actions.actions, agentSessionCommandMappings(payload.sessionId))
            });
        } finally {
            mission.dispose();
        }
    }

    public static async executeCommand(
        input: AgentSessionExecuteCommandPayload,
        context: MissionCommandContext
    ): Promise<AgentSessionCommandAcknowledgement> {
        const payload = agentSessionExecuteCommandPayloadSchema.parse(input);
        const mission = await loadRequiredMissionRuntime(payload, context);
        try {
            requireAgentSession(await buildMissionSnapshot(mission, payload.missionId), payload.sessionId);
            switch (payload.commandId) {
                case 'agentSession.complete':
                    await mission.completeAgentSession(payload.sessionId);
                    break;
                case 'agentSession.cancel':
                    await mission.cancelAgentSession(payload.sessionId, getReason(payload.input));
                    break;
                case 'agentSession.terminate':
                    await mission.terminateAgentSession(payload.sessionId, getReason(payload.input));
                    break;
                default:
                    throw new Error(`AgentSession command '${payload.commandId}' is not implemented in the daemon.`);
            }
            return agentSessionCommandAcknowledgementSchema.parse({
                ok: true,
                entity: 'AgentSession',
                method: 'executeCommand',
                id: payload.sessionId,
                missionId: payload.missionId,
                sessionId: payload.sessionId,
                commandId: payload.commandId
            });
        } finally {
            mission.dispose();
        }
    }

    public static async sendPrompt(
        input: AgentSessionSendPromptPayload,
        context: MissionCommandContext
    ): Promise<AgentSessionCommandAcknowledgement> {
        const payload = agentSessionSendPromptPayloadSchema.parse(input);
        const mission = await loadRequiredMissionRuntime(payload, context);
        try {
            requireAgentSession(await buildMissionSnapshot(mission, payload.missionId), payload.sessionId);
            await mission.sendAgentSessionPrompt(payload.sessionId, normalizeAgentPrompt(payload.prompt));
            return agentSessionCommandAcknowledgementSchema.parse({
                ok: true,
                entity: 'AgentSession',
                method: 'sendPrompt',
                id: payload.sessionId,
                missionId: payload.missionId,
                sessionId: payload.sessionId
            });
        } finally {
            mission.dispose();
        }
    }

    public static async sendCommand(
        input: AgentSessionSendCommandPayload,
        context: MissionCommandContext
    ): Promise<AgentSessionCommandAcknowledgement> {
        const payload = agentSessionSendCommandPayloadSchema.parse(input);
        const mission = await loadRequiredMissionRuntime(payload, context);
        try {
            requireAgentSession(await buildMissionSnapshot(mission, payload.missionId), payload.sessionId);
            await mission.sendAgentSessionCommand(payload.sessionId, normalizeAgentCommand(payload.command));
            return agentSessionCommandAcknowledgementSchema.parse({
                ok: true,
                entity: 'AgentSession',
                method: 'sendCommand',
                id: payload.sessionId,
                missionId: payload.missionId,
                sessionId: payload.sessionId
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

function agentSessionCommandMappings(sessionId: string): EntityActionCommandMapping[] {
    return [
        { actionId: `session.cancel.${sessionId}`, commandId: 'agentSession.cancel' },
        { actionId: `session.terminate.${sessionId}`, commandId: 'agentSession.terminate' }
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
