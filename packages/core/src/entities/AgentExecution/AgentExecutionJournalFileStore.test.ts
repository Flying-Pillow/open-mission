import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentExecutionProtocolDescriptor } from './AgentExecutionProtocolDescriptor.js';
import {
    AgentExecutionJournalFileStore,
    resolveAgentExecutionJournalFilePath
} from './AgentExecutionJournalFileStore.js';
import type { AgentExecutionJournalRecordType, AgentExecutionJournalReferenceType } from './AgentExecutionJournalSchema.js';

describe('AgentExecutionJournalFileStore', () => {
    it('ensures, appends, and reads schema-validated journal records', async () => {
        const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-execution-journal-store-'));
        try {
            const reference = createReference();
            const store = createStore(rootPath);

            await store.ensureJournal(reference);
            await store.appendRecord(reference, {
                ...baseRecord('journal.header', 0),
                kind: 'agent-execution-interaction-journal',
                agentId: 'copilot-cli',
                protocolDescriptor: createAgentExecutionProtocolDescriptor({
                    scope: {
                        kind: 'task',
                        missionId: 'mission-1',
                        taskId: 'task-1'
                    },
                    messages: []
                })
            });
            await store.appendRecord(reference, {
                ...baseRecord('turn.accepted', 1),
                messageId: 'message-1',
                source: 'operator',
                messageType: 'prompt',
                payload: { text: 'Continue.' },
                mutatesContext: false
            });

            expect(await store.readRecords(reference)).toEqual([
                expect.objectContaining({ type: 'journal.header', sequence: 0 }),
                expect.objectContaining({ type: 'turn.accepted', sequence: 1 })
            ]);
        } finally {
            await fs.rm(rootPath, { recursive: true, force: true });
        }
    });

    it('returns an empty record set for missing journals', async () => {
        const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-execution-journal-missing-'));
        try {
            await expect(createStore(rootPath).readRecords(createReference())).resolves.toEqual([]);
        } finally {
            await fs.rm(rootPath, { recursive: true, force: true });
        }
    });

    it('fails clean-slate validation for invalid journal lines', async () => {
        const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-execution-journal-invalid-'));
        try {
            const reference = createReference();
            const target = createTarget(rootPath);
            await fs.mkdir(path.dirname(resolveAgentExecutionJournalFilePath(reference, target)), { recursive: true });
            await fs.writeFile(resolveAgentExecutionJournalFilePath(reference, target), '{"type":"output"}\n', 'utf8');

            await expect(createStore(rootPath).readRecords(reference))
                .rejects.toThrow('has invalid JSONL at line 1');
        } finally {
            await fs.rm(rootPath, { recursive: true, force: true });
        }
    });

    it('keeps file path resolution as store-local adapter plumbing', async () => {
        const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-execution-journal-path-'));
        try {
            expect(resolveAgentExecutionJournalFilePath(createReference(), createTarget(rootPath))).toBe(
                path.join(rootPath, 'agent-journals', 'agent-execution-1.interaction.jsonl')
            );

            expect(() => resolveAgentExecutionJournalFilePath(createReference(), {
                rootPath,
                relativePath: '../agent-execution-1.interaction.jsonl'
            })).toThrow('must stay within journal root');
        } finally {
            await fs.rm(rootPath, { recursive: true, force: true });
        }
    });
});

function createReference(): AgentExecutionJournalReferenceType {
    return {
        journalId: 'agent-execution-journal:Task/task-1/agent-execution-1',
        ownerEntity: 'Task',
        ownerId: 'task-1',
        agentExecutionId: 'agent-execution-1',
        recordCount: 0,
        lastSequence: 0
    };
}

function createStore(rootPath: string): AgentExecutionJournalFileStore {
    return new AgentExecutionJournalFileStore({
        resolvePath: () => createTarget(rootPath)
    });
}

function createTarget(rootPath: string) {
    return {
        rootPath,
        relativePath: 'agent-journals/agent-execution-1.interaction.jsonl'
    };
}

function baseRecord<const TType extends AgentExecutionJournalRecordType['type']>(type: TType, sequence: number) {
    return {
        recordId: `record-${sequence}`,
        sequence,
        type,
        family: type === 'journal.header'
            ? 'journal.header'
            : type === 'turn.accepted'
                ? 'turn.accepted'
                : type,
        entrySemantics: 'event' as const,
        authority: type === 'turn.accepted' ? 'operator' : 'daemon',
        assertionLevel: type === 'turn.accepted' ? 'authoritative' : 'authoritative',
        replayClass: 'replay-critical' as const,
        origin: 'daemon' as const,
        schemaVersion: 1 as const,
        agentExecutionId: 'agent-execution-1',
        executionContext: {
            owner: {
                entityType: 'Task' as const,
                entityId: 'task-1'
            },
            mission: {
                missionId: 'mission-1',
                taskId: 'task-1'
            },
            runtime: {
                agentAdapter: 'copilot-cli'
            },
            daemon: {
                runtimeVersion: 'test-runtime',
                protocolVersion: '2026-05-10'
            }
        },
        occurredAt: '2026-05-09T00:00:00.000Z'
    };
}
