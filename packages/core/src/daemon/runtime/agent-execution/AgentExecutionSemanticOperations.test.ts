import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentExecutionSemanticOperations } from './AgentExecutionSemanticOperations.js';
import { ArtifactService } from './ArtifactService.js';
import { createMemoryAgentExecutionJournalWriter } from './testing/createMemoryAgentExecutionJournalWriter.js';

describe('AgentExecutionSemanticOperations', () => {
    const temporaryDirectories = new Set<string>();

    afterEach(async () => {
        await Promise.all([...temporaryDirectories].map(async (directory) => {
            await fs.rm(directory, { recursive: true, force: true });
            temporaryDirectories.delete(directory);
        }));
    });

    it('reads artifacts through a transport-independent semantic operation and records authoritative Agent execution facts', async () => {
        const { journalWriter, recordsByJournalId } = createMemoryAgentExecutionJournalWriter();
        const semanticOperations = new AgentExecutionSemanticOperations({
            artifactService: new ArtifactService(),
            journalWriter
        });
        const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-semantic-read-artifact-'));
        temporaryDirectories.add(repositoryRoot);
        await fs.mkdir(path.join(repositoryRoot, 'missions', '1-initial-setup'), { recursive: true });
        await fs.writeFile(path.join(repositoryRoot, 'missions', '1-initial-setup', 'BRIEF.md'), '# Brief\n', 'utf8');

        const result = await semanticOperations.invoke({
            agentExecutionId: 'agent-execution-1',
            scope: {
                kind: 'repository',
                repositoryRootPath: repositoryRoot
            },
            name: 'read_artifact',
            input: {
                path: 'missions/1-initial-setup/BRIEF.md'
            }
        });

        expect(result).toMatchObject({
            operationName: 'read_artifact',
            agentExecutionId: 'agent-execution-1',
            path: 'missions/1-initial-setup/BRIEF.md',
            content: '# Brief\n',
            factType: 'artifact-read'
        });

        const journalRecords = recordsByJournalId.values().next().value ?? [];
        expect(journalRecords).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'agent-execution-fact',
                factType: 'artifact-read',
                path: 'missions/1-initial-setup/BRIEF.md',
                payload: expect.objectContaining({ operationName: 'read_artifact' })
            })
        ]));
    });
});