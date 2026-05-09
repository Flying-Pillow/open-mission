import { describe, expect, it } from 'vitest';
import { AgentExecutionJournalReferenceSchema } from './AgentExecutionJournalSchema.js';

describe('AgentExecutionJournalContract', () => {
    it('keeps owner-scoped journal identity separate from storage backend paths', () => {
        expect(AgentExecutionJournalReferenceSchema.parse({
            journalId: 'agent-execution-journal:Task/task-1/agent-execution-1',
            ownerEntity: 'Task',
            ownerId: 'task-1',
            agentExecutionId: 'agent-execution-1',
            recordCount: 3,
            lastSequence: 2
        })).toMatchObject({
            ownerEntity: 'Task',
            ownerId: 'task-1',
            agentExecutionId: 'agent-execution-1',
            recordCount: 3,
            lastSequence: 2
        });
    });

    it('rejects backend storage fields on journal references', () => {
        expect(() => AgentExecutionJournalReferenceSchema.parse({
            journalId: 'agent-execution-journal:System/system/agent-execution-1',
            ownerEntity: 'System',
            ownerId: 'system',
            agentExecutionId: 'agent-execution-1',
            recordCount: 0,
            lastSequence: 0,
            rootPath: '/tmp/mission',
            relativePath: 'agent-journals/agent-execution-1.interaction.jsonl'
        })).toThrow();
    });
});
