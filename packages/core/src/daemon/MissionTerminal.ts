import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { TerminalAgentTransport, type TerminalSessionHandle } from './runtime/agent/TerminalAgentTransport.js';
import { MissionAgentEventEmitter } from './runtime/agent/events.js';
import type { MissionSelector } from '../types.js';
import { FilesystemAdapter } from '../lib/FilesystemAdapter.js';
import type { MissionAgentTerminalState } from './protocol/contracts.js';

type MissionTerminalInput = {
    data?: string;
    literal?: boolean;
    cols?: number;
    rows?: number;
};

type MissionTerminalRecord = {
    key: string;
    surfacePath: string;
    missionId: string;
    sessionId: string;
    workingDirectory: string;
    handle: TerminalSessionHandle;
};

export type MissionTerminalUpdate = {
    workspaceRoot: string;
    missionId: string;
    state: MissionAgentTerminalState;
};

const missionTerminalTransport = new TerminalAgentTransport();
const missionTerminals = new Map<string, MissionTerminalRecord>();
const missionTerminalSessions = new Map<string, MissionTerminalRecord>();
const missionTerminalEventEmitter = new MissionAgentEventEmitter<MissionTerminalUpdate>();

TerminalAgentTransport.onDidSessionUpdate((event) => {
    const record = missionTerminalSessions.get(event.sessionName);
    if (!record) {
        return;
    }

    missionTerminalEventEmitter.fire({
        workspaceRoot: record.surfacePath,
        missionId: record.missionId,
        state: createMissionTerminalStateFromSnapshot(record, event)
    });
});

export function observeMissionTerminalUpdates(listener: (event: MissionTerminalUpdate) => void): { dispose(): void } {
    return missionTerminalEventEmitter.event(listener);
}

export async function readMissionTerminalState(input: {
    surfacePath: string;
    selector?: MissionSelector;
}): Promise<MissionAgentTerminalState | null> {
    const resolved = await readExistingMissionTerminalRecord(input);
    if (!resolved) {
        return null;
    }
    return createMissionTerminalState(resolved);
}

export async function ensureMissionTerminalState(input: {
    surfacePath: string;
    selector?: MissionSelector;
}): Promise<MissionAgentTerminalState | null> {
    const resolved = await ensureMissionTerminalRecord(input);
    if (!resolved) {
        return null;
    }
    return createMissionTerminalState(resolved);
}

export async function sendMissionTerminalInput(input: {
    surfacePath: string;
    selector?: MissionSelector;
    terminalInput: MissionTerminalInput;
}): Promise<MissionAgentTerminalState | null> {
    const resolved = await readExistingMissionTerminalRecord(input);
    if (!resolved) {
        return null;
    }

    if (typeof input.terminalInput.data === 'string' && input.terminalInput.data.length > 0) {
        await missionTerminalTransport.sendKeys(
            resolved.handle,
            input.terminalInput.data,
            {
                ...(input.terminalInput.literal !== undefined
                    ? { literal: input.terminalInput.literal }
                    : {})
            }
        );
    }
    if (input.terminalInput.cols && input.terminalInput.rows) {
        await missionTerminalTransport.resizeSession(
            resolved.handle,
            input.terminalInput.cols,
            input.terminalInput.rows
        );
    }

    return createMissionTerminalState(resolved);
}

async function readExistingMissionTerminalRecord(input: {
    surfacePath: string;
    selector?: MissionSelector;
}): Promise<MissionTerminalRecord | undefined> {
    const context = await resolveMissionTerminalContext(input);
    if (!context) {
        return undefined;
    }

    const existing = missionTerminals.get(context.key);
    return existing?.workingDirectory === context.workingDirectory ? existing : undefined;
}

async function ensureMissionTerminalRecord(input: {
    surfacePath: string;
    selector?: MissionSelector;
}): Promise<MissionTerminalRecord | undefined> {
    const context = await resolveMissionTerminalContext(input);
    if (!context) {
        return undefined;
    }

    const existing = missionTerminals.get(context.key);
    if (existing?.workingDirectory === context.workingDirectory) {
        const snapshot = await missionTerminalTransport.readSnapshot(existing.handle);
        if (!snapshot.dead) {
            return existing;
        }
        missionTerminals.delete(context.key);
        missionTerminalSessions.delete(existing.handle.sessionName);
    }

    const handle = await missionTerminalTransport.openSession({
        workingDirectory: context.workingDirectory,
        command: resolveShellCommand(),
        args: resolveShellArgs(),
        sessionName: context.sessionId
    });
    const record: MissionTerminalRecord = {
        key: context.key,
        surfacePath: context.surfacePath,
        missionId: context.missionId,
        sessionId: context.sessionId,
        workingDirectory: context.workingDirectory,
        handle
    };
    missionTerminals.set(context.key, record);
    missionTerminalSessions.set(handle.sessionName, record);
    return record;
}

async function resolveMissionTerminalContext(input: {
    surfacePath: string;
    selector?: MissionSelector;
}): Promise<{
    key: string;
    surfacePath: string;
    missionId: string;
    sessionId: string;
    workingDirectory: string;
} | undefined> {
    const surfacePath = path.resolve(input.surfacePath.trim());
    const missionId = input.selector?.missionId?.trim();
    if (!surfacePath || !missionId) {
        return undefined;
    }

    const adapter = new FilesystemAdapter(surfacePath);
    const mission = await adapter.resolveKnownMission({ missionId });
    if (!mission) {
        return undefined;
    }

    const workingDirectory = adapter.getMissionWorkspacePath(mission.missionDir);
    const key = `${path.resolve(surfacePath)}:${missionId}`;
    const sessionId = buildMissionTerminalSessionId(surfacePath, missionId);
    return {
        key,
        surfacePath,
        missionId,
        sessionId,
        workingDirectory
    };
}

async function createMissionTerminalState(record: MissionTerminalRecord): Promise<MissionAgentTerminalState> {
    const snapshot = await missionTerminalTransport.readSnapshot(record.handle);
    return createMissionTerminalStateFromSnapshot(record, snapshot);
}

function createMissionTerminalStateFromSnapshot(
    record: MissionTerminalRecord,
    snapshot: Awaited<ReturnType<typeof missionTerminalTransport.readSnapshot>>
): MissionAgentTerminalState {
    return {
        sessionId: record.sessionId,
        connected: snapshot.connected,
        dead: snapshot.dead,
        exitCode: snapshot.exitCode,
        screen: snapshot.screen,
        ...(snapshot.truncated ? { truncated: true } : {}),
        ...(typeof snapshot.chunk === 'string' ? { chunk: snapshot.chunk } : {}),
        terminalHandle: {
            sessionName: snapshot.sessionName,
            paneId: snapshot.paneId,
            ...(snapshot.sharedSessionName ? { sharedSessionName: snapshot.sharedSessionName } : {})
        }
    };
}

function buildMissionTerminalSessionId(surfacePath: string, missionId: string): string {
    const workspaceName = path.basename(surfacePath) || 'repository';
    const digest = createHash('sha1').update(path.resolve(surfacePath)).digest('hex').slice(0, 8);
    return `mission-shell:${workspaceName}:${digest}:${missionId}`;
}

function resolveShellCommand(): string {
    return process.env['SHELL']?.trim() || '/bin/bash';
}

function resolveShellArgs(): string[] {
    const shell = resolveShellCommand();
    return shell.endsWith('bash') || shell.endsWith('/sh') ? ['-i'] : [];
}
