import { describe, expect, it } from 'vitest';
import { AgentExecutionFactRecorder } from './AgentExecutionFactRecorder.js';
import { createMemoryAgentExecutionJournalWriter } from './testing/createMemoryAgentExecutionJournalWriter.js';

describe('AgentExecutionFactRecorder', () => {
    it('records authoritative artifact-read runtime facts independently of file IO', async () => {
        const { journalWriter, recordsByJournalId } = createMemoryAgentExecutionJournalWriter();
        const recorder = new AgentExecutionFactRecorder({ journalWriter });

        const result = await recorder.recordArtifactRead({
            agentExecutionId: 'agent-execution-1',
            scope: {
                kind: 'repository',
                repositoryRootPath: '/repo'
            },
            operationName: 'read_artifact',
            path: 'missions/1-initial-setup/BRIEF.md'
        });

        expect(result.eventId).toMatch(/^semantic-operation:read_artifact:/);

        const journalRecords = recordsByJournalId.values().next().value ?? [];
        expect(journalRecords).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'runtime-fact',
                factType: 'artifact-read',
                path: 'missions/1-initial-setup/BRIEF.md',
                payload: expect.objectContaining({ operationName: 'read_artifact' })
            })
        ]));
    });
});