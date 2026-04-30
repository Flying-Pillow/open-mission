import type { GitHubIssueDetailType, RepositorySnapshotType, TrackedIssueSummaryType } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import type { AgentSessionTerminalSnapshot as MissionSessionTerminalSnapshot, AgentSessionTerminalSocketServerMessage as MissionSessionTerminalSocketServerMessage } from '@flying-pillow/mission-core/entities/AgentSession/AgentSessionSchema';
import type { MissionTerminalSnapshot, MissionTerminalSocketServerMessage } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import { GitHubIssueDetailSchema, RepositorySchema, RepositorySnapshotSchema, TrackedIssueSummarySchema } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import { missionMissionCommandSchema } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import {
    airportRuntimeEventEnvelopeSchema,
    type AirportRuntimeEventEnvelope
} from '$lib/contracts/runtime-events';

type UnknownRecord = Record<string, unknown>;

export function parseRepositorySummary(value: unknown): RepositorySnapshotType['repository'] {
    return RepositorySchema.parse(value);
}

export function parseRepositorySnapshot(value: unknown): RepositorySnapshotType {
    return RepositorySnapshotSchema.parse(value);
}

export function parseAirportRuntimeEventEnvelope(value: unknown): AirportRuntimeEventEnvelope {
    return airportRuntimeEventEnvelopeSchema.parse(value) as AirportRuntimeEventEnvelope;
}

export function parseTrackedIssueSummaryList(value: unknown): TrackedIssueSummaryType[] {
    return TrackedIssueSummarySchema.array().parse(value);
}

export function parseTrackedIssueSummary(value: unknown): TrackedIssueSummaryType {
    return TrackedIssueSummarySchema.parse(value);
}

export function parseGitHubIssueDetail(value: unknown): GitHubIssueDetailType {
    return GitHubIssueDetailSchema.parse(value);
}

export function parseMissionCommandPayload(value: unknown): {
    action: 'pause' | 'resume' | 'panic' | 'clearPanic' | 'restartQueue' | 'deliver';
} {
    return missionMissionCommandSchema.parse(value) as {
        action: 'pause' | 'resume' | 'panic' | 'clearPanic' | 'restartQueue' | 'deliver';
    };
}

export function parseMissionTerminalSnapshot(value: unknown): MissionTerminalSnapshot {
    const candidate = requireTerminalSnapshot(value, 'Mission terminal snapshot must be an object.');
    requireString(candidate.missionId, 'Mission terminal snapshot is missing missionId.');
    return candidate as MissionTerminalSnapshot;
}

export function parseMissionSessionTerminalSnapshot(value: unknown): MissionSessionTerminalSnapshot {
    const candidate = requireTerminalSnapshot(value, 'Mission session terminal snapshot must be an object.');
    requireString(candidate.sessionId, 'Mission session terminal snapshot is missing sessionId.');
    return candidate as MissionSessionTerminalSnapshot;
}

export function parseMissionTerminalSocketServerMessage(value: unknown): MissionTerminalSocketServerMessage {
    return parseTerminalServerMessage(value, parseMissionTerminalSnapshot) as MissionTerminalSocketServerMessage;
}

export function parseMissionSessionTerminalSocketServerMessage(value: unknown): MissionSessionTerminalSocketServerMessage {
    return parseTerminalServerMessage(value, parseMissionSessionTerminalSnapshot) as MissionSessionTerminalSocketServerMessage;
}

function requireTerminalSnapshot(value: unknown, message: string): UnknownRecord {
    const candidate = requireRecord(value, message);
    if (typeof candidate.connected !== 'boolean' || typeof candidate.dead !== 'boolean') {
        throw new Error('Terminal snapshot is missing connection state.');
    }
    if (candidate.exitCode !== null && typeof candidate.exitCode !== 'number') {
        throw new Error('Terminal snapshot has an invalid exitCode.');
    }
    requireString(candidate.screen, 'Terminal snapshot is missing screen content.');
    return candidate;
}

function parseTerminalServerMessage<TSnapshot>(
    value: unknown,
    parseSnapshot: (value: unknown) => TSnapshot
): unknown {
    const candidate = requireRecord(value, 'Terminal server message must be an object.');
    if (candidate.type === 'snapshot' || candidate.type === 'disconnected') {
        parseSnapshot(candidate.snapshot);
        return candidate;
    }
    if (candidate.type === 'output') {
        const output = requireRecord(candidate.output, 'Terminal output message is missing output.');
        requireString(output.chunk, 'Terminal output message is missing chunk.');
        if (typeof output.dead !== 'boolean') {
            throw new Error('Terminal output message is missing dead state.');
        }
        if (output.exitCode !== null && typeof output.exitCode !== 'number') {
            throw new Error('Terminal output message has an invalid exitCode.');
        }
        return candidate;
    }
    if (candidate.type === 'error') {
        requireString(candidate.message, 'Terminal error message is missing text.');
        return candidate;
    }
    throw new Error('Terminal server message has an invalid type.');
}

function requireRecord(value: unknown, message: string): UnknownRecord {
    if (!value || typeof value !== 'object') {
        throw new Error(message);
    }

    return value as UnknownRecord;
}

function requireString(value: unknown, message: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(message);
    }

    return value;
}