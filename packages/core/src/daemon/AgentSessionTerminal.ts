import * as path from 'node:path';
import { TerminalAgentTransport, type TerminalSessionHandle, type TerminalSessionSnapshot } from './runtime/agent/TerminalAgentTransport.js';
import { MissionAgentEventEmitter } from './runtime/agent/events.js';
import { MissionDossierFilesystem } from '../entities/Mission/MissionDossierFilesystem.js';
import type { AgentSessionTerminalHandleType, AgentSessionTerminalSnapshotType } from '../entities/AgentSession/AgentSessionSchema.js';

type AgentSessionTerminalInput = {
    sessionId?: string;
    data?: string;
    literal?: boolean;
    cols?: number;
    rows?: number;
};

type AgentSessionTerminalRecord = {
    workspaceRoot: string;
    missionId: string;
    sessionId: string;
    terminalHandle: AgentSessionTerminalHandleType;
    missionDir?: string;
    sessionLogPath?: string;
    handle?: TerminalSessionHandle;
};

export type AgentSessionTerminalRuntimeRecord = Omit<AgentSessionTerminalRecord, 'handle'>;

export type AgentSessionTerminalUpdate = {
    workspaceRoot: string;
    missionId: string;
    sessionId: string;
    state: AgentSessionTerminalSnapshotType;
};

const agentSessionTerminalTransport = new TerminalAgentTransport();
const agentSessionTerminalRecords = new Map<string, AgentSessionTerminalRecord>();
const agentSessionTerminalSessions = new Map<string, AgentSessionTerminalRecord>();
const agentSessionTerminalEventEmitter = new MissionAgentEventEmitter<AgentSessionTerminalUpdate>();

TerminalAgentTransport.onDidSessionUpdate((event) => {
    const record = agentSessionTerminalSessions.get(event.sessionName);
    if (!record) {
        return;
    }

    agentSessionTerminalEventEmitter.fire({
        workspaceRoot: record.workspaceRoot,
        missionId: record.missionId,
        sessionId: record.sessionId,
        state: createAgentSessionTerminalStateFromSnapshot(record, event)
    });
});

export function observeAgentSessionTerminalUpdates(listener: (event: AgentSessionTerminalUpdate) => void): { dispose(): void } {
    return agentSessionTerminalEventEmitter.event(listener);
}

export async function readAgentSessionTerminalState(input: {
    record: AgentSessionTerminalRuntimeRecord;
}): Promise<AgentSessionTerminalSnapshotType | null> {
    const resolved = await resolveAgentSessionTerminalRecord(input.record);
    if (!resolved) {
        return null;
    }
    return createAgentSessionTerminalState(resolved);
}

export async function sendAgentSessionTerminalInput(input: {
    record: AgentSessionTerminalRuntimeRecord;
    terminalInput: AgentSessionTerminalInput;
}): Promise<AgentSessionTerminalSnapshotType | null> {
    const resolved = await resolveAgentSessionTerminalRecord(input.record);
    if (!resolved?.handle) {
        return resolved ? createAgentSessionTerminalState(resolved) : null;
    }

    if (typeof input.terminalInput.data === 'string' && input.terminalInput.data.length > 0) {
        await agentSessionTerminalTransport.sendKeys(resolved.handle, input.terminalInput.data, {
            ...(input.terminalInput.literal !== undefined ? { literal: input.terminalInput.literal } : {})
        });
    }
    if (input.terminalInput.cols && input.terminalInput.rows) {
        await agentSessionTerminalTransport.resizeSession(resolved.handle, input.terminalInput.cols, input.terminalInput.rows);
    }

    return createAgentSessionTerminalState(resolved);
}

async function resolveAgentSessionTerminalRecord(input: {
    workspaceRoot: string;
    missionId: string;
    sessionId: string;
    terminalHandle: AgentSessionTerminalHandleType;
    missionDir?: string;
    sessionLogPath?: string;
}): Promise<AgentSessionTerminalRecord | undefined> {
    const workspaceRoot = path.resolve(input.workspaceRoot.trim());
    const missionId = input.missionId.trim();
    const sessionId = input.sessionId.trim();
    const terminalSessionName = input.terminalHandle.sessionName.trim();
    const terminalPaneId = input.terminalHandle.paneId.trim();
    if (!workspaceRoot || !missionId || !sessionId || !terminalSessionName || !terminalPaneId) {
        return undefined;
    }

    const key = `${workspaceRoot}:${missionId}:${sessionId}`;
    const cached = agentSessionTerminalRecords.get(key);
    if (cached?.terminalHandle.sessionName === terminalSessionName && cached.terminalHandle.paneId === terminalPaneId) {
        return attachAgentSessionTerminal(cached);
    }

    const record: AgentSessionTerminalRecord = {
        workspaceRoot,
        missionId,
        sessionId,
        terminalHandle: {
            sessionName: terminalSessionName,
            paneId: terminalPaneId,
            ...(input.terminalHandle.sharedSessionName ? { sharedSessionName: input.terminalHandle.sharedSessionName } : {})
        },
        ...(input.missionDir?.trim() ? { missionDir: input.missionDir.trim() } : {}),
        ...(input.sessionLogPath?.trim() ? { sessionLogPath: input.sessionLogPath.trim() } : {})
    };
    agentSessionTerminalRecords.set(key, record);
    return attachAgentSessionTerminal(record);
}

async function attachAgentSessionTerminal(record: AgentSessionTerminalRecord): Promise<AgentSessionTerminalRecord> {
    if (record.handle) {
        return record;
    }
    const handle = await agentSessionTerminalTransport.attachSession(record.terminalHandle.sessionName, {
        sharedSessionName: record.terminalHandle.sharedSessionName ?? record.terminalHandle.sessionName,
        paneId: record.terminalHandle.paneId
    });
    if (!handle) {
        return record;
    }
    const attached = {
        ...record,
        handle
    };
    agentSessionTerminalRecords.set(`${record.workspaceRoot}:${record.missionId}:${record.sessionId}`, attached);
    agentSessionTerminalSessions.set(handle.sessionName, attached);
    return attached;
}

async function createAgentSessionTerminalState(record: AgentSessionTerminalRecord): Promise<AgentSessionTerminalSnapshotType> {
    if (record.handle) {
        const snapshot = await agentSessionTerminalTransport.readSnapshot(record.handle);
        return createAgentSessionTerminalStateFromSnapshot(record, snapshot);
    }

    const transcript = record.sessionLogPath && record.missionDir
        ? await new MissionDossierFilesystem(record.workspaceRoot).readMissionSessionLog(record.missionDir, record.sessionLogPath) ?? ''
        : '';
    return {
        missionId: record.missionId,
        sessionId: record.sessionId,
        connected: false,
        dead: true,
        exitCode: null,
        screen: transcript,
        terminalHandle: {
            sessionName: record.terminalHandle.sessionName,
            paneId: record.terminalHandle.paneId,
            ...(record.terminalHandle.sharedSessionName ? { sharedSessionName: record.terminalHandle.sharedSessionName } : {})
        }
    };
}

function createAgentSessionTerminalStateFromSnapshot(
    record: AgentSessionTerminalRecord,
    snapshot: TerminalSessionSnapshot
): AgentSessionTerminalSnapshotType {
    const isIncrementalOutput = typeof snapshot.chunk === 'string' && snapshot.chunk.length > 0 && snapshot.connected && !snapshot.dead;
    return {
        missionId: record.missionId,
        sessionId: record.sessionId,
        connected: snapshot.connected,
        dead: snapshot.dead,
        exitCode: snapshot.exitCode,
        screen: isIncrementalOutput ? snapshot.chunk! : snapshot.screen,
        ...(snapshot.truncated ? { truncated: true } : {}),
        ...(typeof snapshot.chunk === 'string' ? { chunk: snapshot.chunk } : {}),
        terminalHandle: {
            sessionName: snapshot.sessionName,
            paneId: snapshot.paneId,
            ...(snapshot.sharedSessionName ? { sharedSessionName: snapshot.sharedSessionName } : {})
        }
    };
}