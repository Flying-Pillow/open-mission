import type { EntityExecutionContext } from '../../Entity/Entity.js';
import { Terminal } from '../../Terminal/Terminal.js';
import type { AgentExecutionProcess, AgentExecutionType } from '../AgentExecutionSchema.js';
import {
    AgentExecutionTerminalSchema,
    type AgentExecutionTerminalHandleType
} from './AgentExecutionTerminalSchema.js';

export type AgentExecutionTerminalUpdate = {
    terminalName: string;
    chunk?: string;
    dead: boolean;
    exitCode: number | null;
};

export type AgentExecutionTerminalUpdateSource = {
    onDidTerminalUpdate(listener: (update: AgentExecutionTerminalUpdate) => void): { dispose(): void };
};

export type AgentExecutionTerminalFields = {
    transportId?: string;
    terminalHandle?: AgentExecutionTerminalHandleType;
};

export function getAgentExecutionTerminalFields(process: AgentExecutionProcess | undefined): AgentExecutionTerminalFields {
    if (process?.transport?.kind !== 'terminal') {
        return {};
    }
    return {
        transportId: 'terminal',
        terminalHandle: {
            terminalName: process.transport.terminalName,
            terminalPaneId: process.transport.terminalPaneId ?? process.transport.terminalName
        }
    };
}

export function readAgentExecutionTerminal(input: {
    ownerId: string;
    execution: AgentExecutionType;
}) {
    const terminalHandle = requireAgentExecutionTerminalHandle(input.execution);
    const terminalSnapshot = Terminal.read({
        terminalName: terminalHandle.terminalName,
        terminalPaneId: terminalHandle.terminalPaneId
    });
    return AgentExecutionTerminalSchema.parse({
        ownerId: input.ownerId,
        agentExecutionId: input.execution.agentExecutionId,
        connected: terminalSnapshot.connected,
        dead: terminalSnapshot.dead,
        exitCode: terminalSnapshot.exitCode,
        ...(terminalSnapshot.cols ? { cols: terminalSnapshot.cols } : {}),
        ...(terminalSnapshot.rows ? { rows: terminalSnapshot.rows } : {}),
        screen: terminalSnapshot.screen,
        ...(typeof terminalSnapshot.chunk === 'string' ? { chunk: terminalSnapshot.chunk } : {}),
        ...(terminalSnapshot.truncated ? { truncated: true } : {}),
        terminalHandle: {
            terminalName: terminalHandle.terminalName,
            terminalPaneId: terminalHandle.terminalPaneId,
            ...(terminalHandle.sharedTerminalName ? { sharedTerminalName: terminalHandle.sharedTerminalName } : {})
        }
    });
}

export function sendAgentExecutionTerminalInput(input: {
    execution: AgentExecutionType;
    data?: string;
    literal?: boolean;
    cols?: number;
    rows?: number;
    context: EntityExecutionContext;
}): void {
    const terminalHandle = requireAgentExecutionTerminalHandle(input.execution);
    Terminal.sendInput({
        terminalName: terminalHandle.terminalName,
        terminalPaneId: terminalHandle.terminalPaneId,
        ...(input.data !== undefined ? { data: input.data } : {}),
        ...(input.literal !== undefined ? { literal: input.literal } : {}),
        ...(input.cols !== undefined ? { cols: input.cols } : {}),
        ...(input.rows !== undefined ? { rows: input.rows } : {})
    }, input.context);
}

export function requireAgentExecutionTerminalHandle(execution: AgentExecutionType): AgentExecutionTerminalHandleType {
    if (!execution.terminalHandle) {
        throw new Error(`AgentExecution '${execution.agentExecutionId}' is not backed by a Terminal.`);
    }
    return execution.terminalHandle;
}

export function splitAgentExecutionTerminalOutputLines(text: string): string[] {
    return text
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0);
}
