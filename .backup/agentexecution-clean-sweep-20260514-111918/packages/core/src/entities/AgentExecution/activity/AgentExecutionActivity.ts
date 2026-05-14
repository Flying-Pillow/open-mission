import { deriveActivityStateFromProgressState } from '../activity/AgentExecutionActivityState.js';
import type { AgentExecutionProcess, AgentExecutionType } from '../AgentExecutionSchema.js';
import type {
    AgentExecutionActivityStateType,
    AgentExecutionLiveActivityType
} from '../AgentExecutionStateSchema.js';

export function deriveAgentExecutionActivity(input: {
    baseActivity: AgentExecutionActivityStateType | undefined;
    awaitingResponseToMessageId: string | null | undefined;
}): AgentExecutionActivityStateType | undefined {
    return input.awaitingResponseToMessageId !== undefined && input.awaitingResponseToMessageId !== null
        ? 'awaiting-agent-response'
        : input.baseActivity;
}

export function deriveAgentExecutionActivityFromProcess(input: {
    process: AgentExecutionProcess | undefined;
    fallbackActivity: AgentExecutionType['activityState'] | undefined;
    awaitingResponseToMessageId: AgentExecutionType['awaitingResponseToMessageId'] | undefined;
}): AgentExecutionActivityStateType | undefined {
    return input.process
        ? deriveAgentExecutionActivity({
            baseActivity: deriveActivityStateFromProgressState(input.process.progress.state) ?? input.fallbackActivity,
            awaitingResponseToMessageId: input.awaitingResponseToMessageId
        })
        : input.fallbackActivity;
}

export function createAgentExecutionLiveActivity(
    progress: AgentExecutionProcess['progress']
): AgentExecutionLiveActivityType {
    return {
        progress: {
            ...(progress.summary ? { summary: progress.summary } : {}),
            ...(progress.detail ? { detail: progress.detail } : {}),
            ...(progress.units ? { units: cloneStructured(progress.units) } : {})
        },
        updatedAt: progress.updatedAt
    };
}

function cloneStructured<T>(input: T): T {
    return JSON.parse(JSON.stringify(input)) as T;
}
