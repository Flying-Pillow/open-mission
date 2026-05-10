import { describe, expect, it } from "vitest";
import {
    agentChatShowsWorkingShine,
    resolveAgentChatHeaderDetail,
    resolveAgentChatHeaderTitle,
    type AgentChatHeaderExecution,
} from "./agentChatHeader";

describe("agentChatHeader", () => {
    it("uses the scoped repository owner in the chat title", () => {
        const execution = createExecution({
            ownerId: "/repositories",
            scope: {
                kind: "repository",
                repositoryRootPath: "/repositories",
            },
        });

        expect(resolveAgentChatHeaderTitle(execution, "Agent chat")).toBe(
            "Repository repositories",
        );
    });

    it("uses the task owner in the chat title and keeps the current turn as detail", () => {
        const execution = createExecution({
            ownerId: "task-1",
            taskId: "implementation/01-spec",
            currentTurnTitle: "Write the implementation spec",
            scope: {
                kind: "task",
                missionId: "mission-1",
                taskId: "implementation/01-spec",
            },
        });

        expect(resolveAgentChatHeaderTitle(execution, "Agent chat")).toBe(
            "Task implementation/01-spec",
        );
        expect(resolveAgentChatHeaderDetail(execution)).toBe(
            "Write the implementation spec",
        );
    });

    it("does not duplicate the system identifier in the header title", () => {
        const execution = createExecution({
            ownerId: "system",
            scope: { kind: "system" },
        });

        expect(resolveAgentChatHeaderTitle(execution, "Agent chat")).toBe(
            "System",
        );
    });

    it("animates the shine for live non-idle execution states", () => {
        const workingExecution = createExecution({
            lifecycleState: "running",
            currentActivity: { activity: "executing", updatedAt: "2026-05-09T12:00:00.000Z" },
        });
        const idleExecution = createExecution({
            lifecycleState: "running",
            currentActivity: { activity: "idle", updatedAt: "2026-05-09T12:00:00.000Z" },
        });
        const startingExecution = createExecution({
            lifecycleState: "starting",
        });
        const completedExecution = createExecution({
            lifecycleState: "completed",
            currentActivity: { activity: "executing", updatedAt: "2026-05-09T12:00:00.000Z" },
        });

        expect(agentChatShowsWorkingShine(workingExecution)).toBe(true);
        expect(agentChatShowsWorkingShine(idleExecution)).toBe(false);
        expect(agentChatShowsWorkingShine(startingExecution)).toBe(true);
        expect(agentChatShowsWorkingShine(completedExecution)).toBe(false);
    });
});

function createExecution(
    overrides: Partial<AgentChatHeaderExecution>,
): AgentChatHeaderExecution {
    return {
        ownerId: "mission-1",
        lifecycleState: "running",
        ...overrides,
    };
}