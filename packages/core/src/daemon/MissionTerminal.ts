import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { TerminalRegistry, type TerminalHandle, type TerminalSnapshot } from '../entities/Terminal/TerminalRegistry.js';
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
    missionTerminalId: string;
    workingDirectory: string;
    handle: TerminalHandle;
};

export type MissionTerminalUpdate = {
    workspaceRoot: string;
    missionId: string;
    state: MissionTerminalSnapshotType;
};

const missionTerminalRegistry = TerminalRegistry.shared();
const missionTerminals = new Map<string, MissionTerminalRecord>();
const missionTerminalEventEmitter = new MissionAgentEventEmitter<MissionTerminalUpdate>();
const missionContextCache = new Map<string, { context: { key: string; surfacePath: string; missionId: string; missionTerminalId: string; workingDirectory: string } | undefined; timestamp: number }>();
const CONTEXT_CACHE_TTL_MS = 60_000;

missionTerminalRegistry.onDidTerminalUpdate((event) => {
    const record = missionTerminals.get(event.terminalName);
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
        missionTerminalRegistry.sendKeys(
            resolved.handle.terminalName,
            input.terminalInput.data!,
            {
                ...(input.terminalInput.literal !== undefined
                    ? { literal: input.terminalInput.literal }
                    : {})
            }
        );
    }
    if (isResize) {
        missionTerminalRegistry.resize(
            resolved.handle.terminalName,
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
        const snapshot = readTerminalSnapshot(existing.handle);
        if (!snapshot.dead) {
            return existing;
        }
        missionTerminals.delete(context.key);
        missionTerminals.delete(existing.handle.terminalName);
    }

    const handle = missionTerminalRegistry.openTerminal({
        workingDirectory: context.workingDirectory,
        command: resolveShellCommand(),
        args: resolveShellArgs(),
        terminalName: context.missionTerminalId
    });
    const record: MissionTerminalRecord = {
        key: context.key,
        surfacePath: context.surfacePath,
        missionId: context.missionId,
        missionTerminalId: context.missionTerminalId,
        workingDirectory: context.workingDirectory,
        handle
    };
    missionTerminals.set(context.key, record);
    missionTerminals.set(handle.terminalName, record);
    return record;
}

async function resolveMissionTerminalContext(input: {
    surfacePath: string;
    selector?: MissionSelector;
}): Promise<{
    key: string;
    surfacePath: string;
    missionId: string;
    missionTerminalId: string;
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
    const missionTerminalId = buildMissionTerminalId(surfacePath, missionId);
    const context = {
        key,
        surfacePath,
        missionId,
        missionTerminalId,
        workingDirectory
    };
    missionContextCache.set(cacheKey, { context, timestamp: Date.now() });
    return context;
}

async function createMissionTerminalState(record: MissionTerminalRecord): Promise<MissionTerminalSnapshotType> {
    const snapshot = readTerminalSnapshot(record.handle);
    return createMissionTerminalStateFromSnapshot(record, snapshot);
}

function createMissionTerminalStateFromSnapshot(
    record: MissionTerminalRecord,
    snapshot: TerminalSnapshot
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
            terminalName: snapshot.terminalName,
            terminalPaneId: snapshot.terminalPaneId,
            ...(snapshot.sharedTerminalName ? { sharedTerminalName: snapshot.sharedTerminalName } : {})
        }
    };
}

function readTerminalSnapshot(handle: TerminalHandle): TerminalSnapshot {
    return missionTerminalRegistry.readSnapshot(handle.terminalName) ?? {
        terminalName: handle.terminalName,
        terminalPaneId: handle.terminalPaneId,
        connected: false,
        dead: true,
        exitCode: null,
        screen: '',
        truncated: false
    };
}

function buildMissionTerminalId(surfacePath: string, missionId: string): string {
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
