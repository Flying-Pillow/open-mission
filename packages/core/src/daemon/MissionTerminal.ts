import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { TerminalAgentTransport, type TerminalSessionHandle } from './runtime/agent/TerminalAgentTransport.js';
import { MissionAgentEventEmitter } from './runtime/agent/events.js';
import type { MissionSelector } from '../entities/Mission/MissionSchema.js';
import { MissionDossierFilesystem } from '../entities/Mission/MissionDossierFilesystem.js';
import type { MissionTerminalSnapshotType } from '../entities/Mission/MissionSchema.js';

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
    state: MissionTerminalSnapshotType;
};

const missionTerminalTransport = new TerminalAgentTransport();
const missionTerminals = new Map<string, MissionTerminalRecord>();
const missionTerminalSessions = new Map<string, MissionTerminalRecord>();
const missionTerminalEventEmitter = new MissionAgentEventEmitter<MissionTerminalUpdate>();
const missionContextCache = new Map<string, { context: { key: string; surfacePath: string; missionId: string; sessionId: string; workingDirectory: string } | undefined; timestamp: number }>();
const CONTEXT_CACHE_TTL_MS = 60_000;

TerminalAgentTransport.onDidSessionUpdate((event) => {
    const record = missionTerminalSessions.get(event.sessionName);
    if (!record) {
        return;
    }

    const snapshot = createMissionTerminalStateFromSnapshot(record, event);
    missionTerminalEventEmitter.fire({
        workspaceRoot: record.surfacePath,
        missionId: record.missionId,
        state: {
            ...snapshot,
            screen: snapshot.chunk ?? ''
        }
    });
});

export function observeMissionTerminalUpdates(listener: (event: MissionTerminalUpdate) => void): { dispose(): void } {
    return missionTerminalEventEmitter.event(listener);
}

export async function readMissionTerminalState(input: {
    surfacePath: string;
    selector?: MissionSelector;
}): Promise<MissionTerminalSnapshotType | null> {
    const resolved = await readExistingMissionTerminalRecord(input);
    if (!resolved) {
        return null;
    }
    return createMissionTerminalState(resolved);
}

export async function ensureMissionTerminalState(input: {
    surfacePath: string;
    selector?: MissionSelector;
}): Promise<MissionTerminalSnapshotType | null> {
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
}): Promise<MissionTerminalSnapshotType | null> {
    const resolved = await readExistingMissionTerminalRecord(input);
    if (!resolved) {
        return null;
    }

    const isKeyboardInput = typeof input.terminalInput.data === 'string' && input.terminalInput.data.length > 0;
    const isResize = input.terminalInput.cols && input.terminalInput.rows;

    if (isKeyboardInput) {
        await missionTerminalTransport.sendKeys(
            resolved.handle,
            input.terminalInput.data!,
            {
                ...(input.terminalInput.literal !== undefined
                    ? { literal: input.terminalInput.literal }
                    : {})
            }
        );
    }
    if (isResize) {
        await missionTerminalTransport.resizeSession(
            resolved.handle,
            input.terminalInput.cols!,
            input.terminalInput.rows!
        );
    }

    if (isKeyboardInput && !isResize) {
        return null;
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

    const cacheKey = `${surfacePath}:${missionId}`;
    const cached = missionContextCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CONTEXT_CACHE_TTL_MS) {
        return cached.context;
    }

    const adapter = new MissionDossierFilesystem(surfacePath);
    const mission = await adapter.resolveKnownMission({ missionId });
    if (!mission) {
        return undefined;
    }

    const workingDirectory = adapter.getMissionWorkspacePath(mission.missionDir);
    const key = `${path.resolve(surfacePath)}:${missionId}`;
    const sessionId = buildMissionTerminalSessionId(surfacePath, missionId);
    const context = {
        key,
        surfacePath,
        missionId,
        sessionId,
        workingDirectory
    };
    missionContextCache.set(cacheKey, { context, timestamp: Date.now() });
    return context;
}

async function createMissionTerminalState(record: MissionTerminalRecord): Promise<MissionTerminalSnapshotType> {
    const snapshot = await missionTerminalTransport.readSnapshot(record.handle);
    return createMissionTerminalStateFromSnapshot(record, snapshot);
}

function createMissionTerminalStateFromSnapshot(
    record: MissionTerminalRecord,
    snapshot: Awaited<ReturnType<typeof missionTerminalTransport.readSnapshot>>
): MissionTerminalSnapshotType {
    return {
        missionId: record.missionId,
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
