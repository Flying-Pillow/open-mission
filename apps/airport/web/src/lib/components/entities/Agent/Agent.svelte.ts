import {
    AgentConnectionTestResultSchema,
    AgentFindResultSchema,
    type AgentConnectionTestResultType,
    type AgentType,
    type AgentFindType,
    type AgentOwnerSettingsType,
    type AgentTestConnectionInputType,
} from "@flying-pillow/mission-core/entities/Agent/AgentSchema";
import { cmd } from "../../../../routes/api/entities/remote/command.remote";
import { qry } from "../../../../routes/api/entities/remote/query.remote";

type AgentQuery = ReturnType<typeof qry>;
type AgentOwnerSettingsDraft = Omit<AgentOwnerSettingsType, "defaultAgentAdapter"> & {
    defaultAgentAdapter: string;
};

export type AgentConnectionTestRequest = Omit<AgentTestConnectionInputType, "launchMode"> & {
    agentName?: string;
    launchMode?: AgentTestConnectionInputType["launchMode"] | AgentOwnerSettingsType["defaultAgentMode"];
};

export class Agent {
    public static findQuery(input: AgentFindType): AgentQuery {
        return qry({
            entity: "Agent",
            method: "find",
            payload: input,
        });
    }

    public static async find(input: AgentFindType): Promise<AgentType[]> {
        return AgentFindResultSchema.parse(await Agent.findQuery(input).run());
    }

    public static readFindQueryCurrent(input?: {
        current?: unknown;
    }): AgentType[] {
        return Array.isArray(input?.current)
            ? AgentFindResultSchema.parse(input.current)
            : [];
    }

    public static readQueryLoading(input?: { loading?: boolean }): boolean {
        return input?.loading ?? false;
    }

    public static readQueryError(input?: { error?: unknown }): string | null {
        if (!input?.error) {
            return null;
        }

        return input.error instanceof Error
            ? input.error.message
            : String(input.error);
    }

    public static async testConnection(
        input: AgentConnectionTestRequest,
    ): Promise<AgentConnectionTestResultType> {
        const { agentName, launchMode, ...rest } = input;
        const payload: AgentTestConnectionInputType = {
            ...rest,
            ...(launchMode
                ? { launchMode: Agent.connectionTestLaunchMode(launchMode) }
                : {}),
        };
        try {
            return AgentConnectionTestResultSchema.parse(
                await cmd({
                    entity: "Agent",
                    method: "testConnection",
                    payload,
                }),
            );
        } catch (error) {
            return AgentConnectionTestResultSchema.parse({
                ok: false,
                kind: "unknown",
                agentId: payload.agentId,
                agentName: agentName ?? payload.agentId,
                summary: "Connection test failed.",
                detail: error instanceof Error ? error.message : String(error),
                diagnosticCode: "airport-command-failed",
            });
        }
    }

    public static connectionTestLaunchMode(
        launchMode: AgentConnectionTestRequest["launchMode"],
    ): AgentTestConnectionInputType["launchMode"] {
        return launchMode === "autonomous" ? "print" : launchMode;
    }

    public static availableAgents(agents: AgentType[]): AgentType[] {
        return agents.filter((agent) => agent.availability.available);
    }

    public static selectedAgent(
        agents: AgentType[],
        defaultAgentAdapter: string,
    ): AgentType | undefined {
        return Agent.availableAgents(agents).find(
            (agent) => agent.agentId === defaultAgentAdapter,
        );
    }

    public static isAgentEnabled(
        settings: Pick<AgentOwnerSettingsDraft, "enabledAgentAdapters">,
        agentId: string,
    ): boolean {
        return settings.enabledAgentAdapters.includes(agentId);
    }

    public static isDefaultAgent(
        settings: Pick<AgentOwnerSettingsDraft, "defaultAgentAdapter">,
        agentId: string,
    ): boolean {
        return settings.defaultAgentAdapter === agentId;
    }

    public static toggleEnabledAgentSettings(input: {
        settings: AgentOwnerSettingsDraft;
        agentId: string;
        enabled: boolean;
    }): AgentOwnerSettingsDraft {
        if (input.enabled) {
            const enabledAgentAdapters = [
                ...new Set([
                    ...input.settings.enabledAgentAdapters,
                    input.agentId,
                ]),
            ];
            return {
                ...input.settings,
                enabledAgentAdapters,
                defaultAgentAdapter:
                    input.settings.defaultAgentAdapter || input.agentId,
            };
        }

        const enabledAgentAdapters = input.settings.enabledAgentAdapters.filter(
            (candidate) => candidate !== input.agentId,
        );
        return {
            ...input.settings,
            enabledAgentAdapters,
            defaultAgentAdapter:
                input.settings.defaultAgentAdapter === input.agentId
                    ? (enabledAgentAdapters[0] ?? "")
                    : input.settings.defaultAgentAdapter,
        };
    }

    public static chooseDefaultAgentSettings(input: {
        settings: AgentOwnerSettingsDraft;
        agentId: string;
    }): AgentOwnerSettingsDraft {
        return {
            ...input.settings,
            defaultAgentAdapter: input.agentId,
            enabledAgentAdapters: [
                ...new Set([
                    ...input.settings.enabledAgentAdapters,
                    input.agentId,
                ]),
            ],
        };
    }

    public static normalizeOwnerSettings(input: {
        availableAgents: AgentType[];
        settings: AgentOwnerSettingsDraft;
    }): AgentOwnerSettingsDraft {
        const availableAgentIds = input.availableAgents.map(
            (agent) => agent.agentId,
        );
        if (availableAgentIds.length === 0) {
            return input.settings;
        }

        const enabledAgentAdapters = [
            ...new Set(
                input.settings.enabledAgentAdapters.filter((agentId) =>
                    availableAgentIds.includes(agentId),
                ),
            ),
        ];
        const nextEnabledAgentAdapters =
            enabledAgentAdapters.length > 0
                ? enabledAgentAdapters
                : [...availableAgentIds];

        return {
            ...input.settings,
            enabledAgentAdapters: nextEnabledAgentAdapters,
            defaultAgentAdapter: nextEnabledAgentAdapters.includes(
                input.settings.defaultAgentAdapter,
            )
                ? input.settings.defaultAgentAdapter
                : (nextEnabledAgentAdapters[0] ?? ""),
            defaultAgentMode:
                input.settings.defaultAgentMode ?? "interactive",
        };
    }

    public static canSaveOwnerSettings(input: {
        availableAgents: AgentType[];
        settings: AgentOwnerSettingsDraft;
    }): boolean {
        return (
            input.availableAgents.length === 0 ||
            (input.settings.enabledAgentAdapters.length > 0 &&
                input.settings.enabledAgentAdapters.includes(
                    input.settings.defaultAgentAdapter,
                ) &&
                !!(input.settings.defaultAgentMode ?? "interactive"))
        );
    }
}