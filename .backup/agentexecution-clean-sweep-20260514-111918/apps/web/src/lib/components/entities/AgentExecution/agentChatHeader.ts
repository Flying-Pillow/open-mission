import type { AgentExecutionDataType } from "@flying-pillow/open-mission-core/entities/AgentExecution/AgentExecutionSchema";

type AgentExecutionScope = AgentExecutionDataType["scope"];
type AgentExecutionActivity =
    AgentExecutionDataType["projection"]["currentActivity"];

export type AgentChatHeaderExecution = {
    ownerId: string;
    scope?: AgentExecutionScope;
    taskId?: string;
    assignmentLabel?: string;
    currentTurnTitle?: string;
    lifecycleState?: AgentExecutionDataType["lifecycleState"];
    currentActivity?: AgentExecutionActivity;
};

function normalized(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function lastPathSegment(value: string): string {
    const segments = value.split(/[\\/]/u).filter((segment) => segment.length > 0);
    return segments.at(-1) ?? value;
}

function resolveOwnerIdentifier(
    execution: AgentChatHeaderExecution,
): { label: string; identifier?: string } | undefined {
    switch (execution.scope?.kind) {
        case "system":
            return {
                label: normalized(execution.scope.label) ?? "System",
            };
        case "repository":
            return {
                label: "Repository",
                identifier:
                    normalized(lastPathSegment(execution.scope.repositoryRootPath))
                    ?? normalized(execution.ownerId),
            };
        case "mission":
            return {
                label: "Mission",
                identifier: execution.scope.missionId,
            };
        case "task":
            return {
                label: "Task",
                identifier: execution.scope.taskId,
            };
        case "artifact":
            return {
                label: "Artifact",
                identifier: execution.scope.artifactId,
            };
    }

    if (normalized(execution.taskId)) {
        return {
            label: "Task",
            identifier: normalized(execution.taskId),
        };
    }

    const ownerId = normalized(execution.ownerId);
    if (!ownerId) {
        return undefined;
    }

    if (ownerId === "system") {
        return { label: "System" };
    }

    return {
        label: "Owner",
        identifier: lastPathSegment(ownerId),
    };
}

export function resolveAgentChatHeaderTitle(
    execution: AgentChatHeaderExecution | undefined,
    fallbackTitle: string,
): string {
    if (!execution) {
        return fallbackTitle;
    }

    const owner = resolveOwnerIdentifier(execution);
    if (!owner) {
        return fallbackTitle;
    }

    return owner.identifier ? `${owner.label} ${owner.identifier}` : owner.label;
}

export function resolveAgentChatHeaderDetail(
    execution: AgentChatHeaderExecution | undefined,
): string | undefined {
    const detail = normalized(execution?.currentTurnTitle);
    if (!detail) {
        return undefined;
    }

    return detail;
}

export function agentChatShowsWorkingShine(
    execution: AgentChatHeaderExecution | undefined,
): boolean {
    if (!execution) {
        return false;
    }

    if (execution.currentActivity?.activity === "idle") {
        return false;
    }

    return (
        execution.lifecycleState === "starting"
        || execution.lifecycleState === "running"
    );
}