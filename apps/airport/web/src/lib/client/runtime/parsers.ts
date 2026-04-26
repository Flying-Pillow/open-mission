import type {
    AirportRuntimeEventEnvelope,
    GitHubIssueDetail,
    MissionSessionTerminalSnapshot,
    MissionSessionTerminalSocketServerMessage,
    MissionTerminalSnapshot,
    MissionTerminalSocketServerMessage,
    RepositorySnapshot,
    TrackedIssueSummary,
    MissionRuntimeSnapshot
} from '@flying-pillow/mission-core/schemas';

type UnknownRecord = Record<string, unknown>;

export function parseRepositorySummary(value: unknown): RepositorySnapshot['repository'] {
    const candidate = requireRecord(value, 'Repository summary must be an object.');
    requireString(candidate.repositoryId, 'Repository summary is missing repositoryId.');
    requireString(candidate.repositoryRootPath, 'Repository summary is missing repositoryRootPath.');
    requireString(candidate.label, 'Repository summary is missing label.');
    return candidate as RepositorySnapshot['repository'];
}

export function parseRepositorySnapshot(value: unknown): RepositorySnapshot {
    const candidate = requireRecord(value, 'Repository snapshot must be an object.');
    parseRepositorySummary(candidate.repository);
    if (!Array.isArray(candidate.missions)) {
        throw new Error('Repository snapshot is missing missions.');
    }
    return candidate as RepositorySnapshot;
}

export function parseMissionRuntimeSnapshot(value: unknown): MissionRuntimeSnapshot {
    const candidate = requireRecord(value, 'Mission snapshot must be an object.');
    requireString(candidate.missionId, 'Mission snapshot is missing missionId.');
    requireRecord(candidate.status, 'Mission snapshot is missing status.');
    if (!Array.isArray(candidate.sessions)) {
        throw new Error('Mission snapshot is missing sessions.');
    }
    return candidate as MissionRuntimeSnapshot;
}

export function parseAirportRuntimeEventEnvelope(value: unknown): AirportRuntimeEventEnvelope {
    const candidate = requireRecord(value, 'Runtime event must be an object.');
    requireString(candidate.eventId, 'Runtime event is missing eventId.');
    requireString(candidate.type, 'Runtime event is missing type.');
    requireString(candidate.occurredAt, 'Runtime event is missing occurredAt.');
    return candidate as AirportRuntimeEventEnvelope;
}

export function parseTrackedIssueSummaryList(value: unknown): TrackedIssueSummary[] {
    if (!Array.isArray(value)) {
        throw new Error('Issue list must be an array.');
    }

    return value.map((entry) => parseTrackedIssueSummary(entry));
}

export function parseTrackedIssueSummary(value: unknown): TrackedIssueSummary {
    const candidate = requireRecord(value, 'Issue summary must be an object.');
    if (typeof candidate.number !== 'number') {
        throw new Error('Issue summary is missing number.');
    }
    requireString(candidate.title, 'Issue summary is missing title.');
    return candidate as TrackedIssueSummary;
}

export function parseGitHubIssueDetail(value: unknown): GitHubIssueDetail {
    const candidate = requireRecord(value, 'Issue detail must be an object.');
    if (typeof candidate.number !== 'number') {
        throw new Error('Issue detail is missing number.');
    }
    requireString(candidate.title, 'Issue detail is missing title.');
    return candidate as GitHubIssueDetail;
}

export function parseMissionTaskCommandPayload(value: unknown): {
    action: 'start' | 'complete' | 'reopen';
    terminalSessionName?: string;
} {
    const candidate = requireRecord(value, 'Mission task command payload must be an object.');
    if (candidate.action !== 'start' && candidate.action !== 'complete' && candidate.action !== 'reopen') {
        throw new Error('Mission task command payload has an invalid action.');
    }

    return candidate as {
        action: 'start' | 'complete' | 'reopen';
        terminalSessionName?: string;
    };
}

export function parseMissionCommandPayload(value: unknown): {
    action: 'pause' | 'resume' | 'panic' | 'clearPanic' | 'restartQueue' | 'deliver';
} {
    const candidate = requireRecord(value, 'Mission command payload must be an object.');
    if (
        candidate.action !== 'pause'
        && candidate.action !== 'resume'
        && candidate.action !== 'panic'
        && candidate.action !== 'clearPanic'
        && candidate.action !== 'restartQueue'
        && candidate.action !== 'deliver'
    ) {
        throw new Error('Mission command payload has an invalid action.');
    }

    return candidate as {
        action: 'pause' | 'resume' | 'panic' | 'clearPanic' | 'restartQueue' | 'deliver';
    };
}

export function parseMissionSessionCommandPayload(value: unknown):
    | { action: 'complete' }
    | { action: 'cancel' | 'terminate'; reason?: string }
    | { action: 'prompt'; prompt: unknown }
    | { action: 'command'; command: unknown } {
    const candidate = requireRecord(value, 'Mission session command payload must be an object.');
    if (
        candidate.action !== 'complete'
        && candidate.action !== 'cancel'
        && candidate.action !== 'terminate'
        && candidate.action !== 'prompt'
        && candidate.action !== 'command'
    ) {
        throw new Error('Mission session command payload has an invalid action.');
    }

    return candidate as
        | { action: 'complete' }
        | { action: 'cancel' | 'terminate'; reason?: string }
        | { action: 'prompt'; prompt: unknown }
        | { action: 'command'; command: unknown };
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