import {
    deriveAgentExecutionInteractionCapabilities,
    isTerminalFinalStatus,
    type AgentExecutionProcessType as AgentExecutionProcess
} from '../AgentExecutionSchema.js';
import type { AgentExecutionType } from '../AgentExecutionSchema.js';
import type { AgentExecutionTerminalFields } from '../terminal/AgentExecutionTerminalAttachment.js';

export type AgentExecutionProcessPatch = Omit<Partial<AgentExecutionProcess>, 'failureMessage'> & {
    failureMessage?: string | undefined;
};

export type AgentExecutionLaunchRecord = {
    agentExecutionId: string;
    agentId: string;
    ownerId: string;
    transportId?: string | undefined;
    agentJournalPath?: string | undefined;
    terminalRecordingPath?: string | undefined;
    terminalHandle?: AgentExecutionTerminalFields['terminalHandle'] | undefined;
    assignmentLabel?: string | undefined;
    currentTurnTitle?: string | undefined;
    lifecycle: AgentExecutionType['lifecycleState'];
    launchedAt: string;
    updatedAt: string;
};

export function cloneAgentExecutionProcess(process: AgentExecutionProcess): AgentExecutionProcess {
    const interactionCapabilities = process.interactionCapabilities
        ?? deriveAgentExecutionInteractionCapabilities({
            status: process.status,
            ...(process.transport ? { transport: process.transport } : {}),
            acceptsPrompts: process.acceptsPrompts,
            acceptedCommands: process.acceptedCommands
        });
    return {
        agentId: process.agentId,
        agentExecutionId: process.agentExecutionId,
        ownerId: process.ownerId,
        workingDirectory: process.workingDirectory,
        status: process.status,
        ...(process.attention ? { attention: process.attention } : {}),
        ...(process.currentInputRequestId !== undefined ? { currentInputRequestId: process.currentInputRequestId } : {}),
        progress: {
            ...process.progress,
            ...(process.progress.units ? { units: { ...process.progress.units } } : {})
        },
        waitingForInput: process.waitingForInput,
        acceptsPrompts: process.acceptsPrompts,
        acceptedCommands: [...process.acceptedCommands],
        interactionPosture: process.interactionPosture,
        interactionCapabilities: { ...interactionCapabilities },
        ...(process.transport ? { transport: { ...process.transport } } : {}),
        reference: {
            ...process.reference,
            ...(process.reference.transport ? { transport: { ...process.reference.transport } } : {})
        },
        startedAt: process.startedAt,
        updatedAt: process.updatedAt,
        ...(process.failureMessage ? { failureMessage: process.failureMessage } : {}),
        ...(process.endedAt ? { endedAt: process.endedAt } : {})
    };
}

export function extractAgentExecutionProcess(processOrExecution: AgentExecutionProcess | AgentExecutionType): AgentExecutionProcess {
    if ('process' in processOrExecution && processOrExecution.process) {
        return cloneAgentExecutionProcess(processOrExecution.process);
    }
    return cloneAgentExecutionProcess(processOrExecution as AgentExecutionProcess);
}

export function createRecoverableAgentExecutionProcessFromLaunch(input: {
    launch: AgentExecutionLaunchRecord;
    ownerId: string;
    workingDirectory: string;
    terminalFields: AgentExecutionTerminalFields;
}): AgentExecutionProcess {
    const status = input.launch.lifecycle;
    const transport = input.terminalFields.terminalHandle
        ? {
            kind: 'terminal' as const,
            terminalName: input.terminalFields.terminalHandle.terminalName,
            terminalPaneId: input.terminalFields.terminalHandle.terminalPaneId
        }
        : undefined;
    const acceptedCommands: AgentExecutionProcess['acceptedCommands'] = isTerminalFinalStatus(status)
        ? []
        : ['interrupt', 'checkpoint', 'nudge'];
    const progress = {
        state: status === 'completed'
            ? 'done' as const
            : status === 'failed' || status === 'cancelled' || status === 'terminated'
                ? 'failed' as const
                : 'working' as const,
        updatedAt: input.launch.updatedAt
    };
    return cloneAgentExecutionProcess({
        agentId: input.launch.agentId,
        agentExecutionId: input.launch.agentExecutionId,
        ownerId: input.ownerId,
        workingDirectory: input.workingDirectory,
        status,
        progress,
        waitingForInput: false,
        acceptsPrompts: !isTerminalFinalStatus(status),
        acceptedCommands,
        interactionPosture: transport ? 'native-terminal-escape-hatch' : 'structured-headless',
        interactionCapabilities: deriveAgentExecutionInteractionCapabilities({
            status,
            ...(transport ? { transport } : {}),
            acceptsPrompts: !isTerminalFinalStatus(status),
            acceptedCommands
        }),
        ...(transport ? { transport } : {}),
        reference: {
            agentId: input.launch.agentId,
            agentExecutionId: input.launch.agentExecutionId,
            ...(transport ? { transport } : {})
        },
        startedAt: input.launch.launchedAt,
        updatedAt: input.launch.updatedAt,
        ...(isTerminalFinalStatus(status) ? { endedAt: input.launch.updatedAt } : {})
    });
}

export function applyAgentExecutionProcessPatch(input: {
    process: AgentExecutionProcess;
    patch: AgentExecutionProcessPatch;
    updatedAt: string;
}): AgentExecutionProcess {
    const { process, patch, updatedAt } = input;
    const nextProcess: AgentExecutionProcess = {
        ...process,
        acceptedCommands: patch.acceptedCommands
            ? [...patch.acceptedCommands]
            : [...process.acceptedCommands],
        progress: patch.progress
            ? {
                ...patch.progress,
                ...(patch.progress.units ? { units: { ...patch.progress.units } } : {})
            }
            : {
                ...process.progress,
                ...(process.progress.units ? { units: { ...process.progress.units } } : {})
            },
        reference: patch.reference
            ? {
                ...patch.reference,
                ...(patch.reference.transport ? { transport: { ...patch.reference.transport } } : {})
            }
            : {
                ...process.reference,
                ...(process.reference.transport ? { transport: { ...process.reference.transport } } : {})
            },
        updatedAt
    };
    for (const key of Object.keys(patch) as Array<keyof AgentExecutionProcessPatch>) {
        const value = patch[key];
        if (key === 'failureMessage' && value === undefined) {
            continue;
        }
        if (value !== undefined) {
            Object.assign(nextProcess, { [key]: value });
        }
    }
    if ('failureMessage' in patch && patch.failureMessage === undefined) {
        delete nextProcess.failureMessage;
    }
    if (patch.waitingForInput === false && patch.currentInputRequestId === undefined) {
        nextProcess.currentInputRequestId = null;
    }
    nextProcess.interactionCapabilities = deriveAgentExecutionInteractionCapabilities(nextProcess);
    return cloneAgentExecutionProcess(nextProcess);
}
