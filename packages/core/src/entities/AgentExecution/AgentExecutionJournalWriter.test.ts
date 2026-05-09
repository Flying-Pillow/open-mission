import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentExecutionProtocolDescriptor } from './AgentExecutionProtocolDescriptor.js';
import type { AgentExecutionSignalDecision } from './AgentExecutionProtocolTypes.js';
import {
    AgentExecutionJournalWriter,
    createAgentExecutionJournalReference,
    resolveFileBackedJournalPath
} from './AgentExecutionJournalWriter.js';

describe('AgentExecutionJournalWriter', () => {
    const temporaryDirectories = new Set<string>();

    afterEach(async () => {
        await Promise.all([...temporaryDirectories].map(async (directory) => {
            await fs.rm(directory, { recursive: true, force: true });
            temporaryDirectories.delete(directory);
        }));
    });

    it('creates owner-scoped journal references from execution scope', () => {
        expect(createAgentExecutionJournalReference({
            agentExecutionId: 'agent-execution-1',
            scope: {
                kind: 'task',
                missionId: 'mission-1',
                taskId: 'task-1',
                stageId: 'implementation',
                repositoryRootPath: '/tmp/repository'
            }
        })).toEqual({
            journalId: 'agent-execution-journal:Task/task-1/agent-execution-1',
            ownerEntity: 'Task',
            ownerId: 'task-1',
            agentExecutionId: 'agent-execution-1',
            recordCount: 0,
            lastSequence: 0
        });
    });

    it('resolves task-scoped file-backed journal paths under the mission dossier', () => {
        expect(resolveFileBackedJournalPath({
            agentExecutionId: 'agent-execution-1',
            scope: {
                kind: 'task',
                missionId: 'mission-1',
                taskId: 'task-1',
                stageId: 'implementation',
                repositoryRootPath: '/tmp/repository'
            }
        })).toEqual({
            rootPath: path.join('/tmp/repository', '.mission', 'missions', 'mission-1'),
            relativePath: 'agent-journals/agent-execution-1.interaction.jsonl'
        });
    });

    it('writes journal.header to the resolved file-backed journal before runtime launch', async () => {
        const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-journal-writer-'));
        temporaryDirectories.add(repositoryRoot);
        const writer = new AgentExecutionJournalWriter();

        const reference = await writer.ensureLaunchJournal({
            agentExecutionId: 'agent-execution-1',
            agentId: 'agent-1',
            scope: {
                kind: 'repository',
                repositoryRootPath: repositoryRoot
            },
            protocolDescriptor: createAgentExecutionProtocolDescriptor({
                scope: {
                    kind: 'repository',
                    repositoryRootPath: repositoryRoot
                },
                messages: []
            }),
            transportState: {
                selected: 'stdout-marker',
                degraded: false
            },
            workingDirectory: repositoryRoot
        });

        expect(reference).toEqual({
            journalId: `agent-execution-journal:Repository/${repositoryRoot}/agent-execution-1`,
            ownerEntity: 'Repository',
            ownerId: repositoryRoot,
            agentExecutionId: 'agent-execution-1',
            recordCount: 1,
            lastSequence: 0
        });

        const journalPath = path.join(repositoryRoot, '.mission', 'agent-journals', 'agent-execution-1.interaction.jsonl');
        const journalLines = (await fs.readFile(journalPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

        expect(journalLines).toHaveLength(1);
        expect(journalLines[0]).toMatchObject({
            type: 'journal.header',
            sequence: 0,
            agentExecutionId: 'agent-execution-1',
            ownerId: repositoryRoot,
            agentId: 'agent-1',
            workingDirectory: repositoryRoot
        });
    });

    it('normalizes awaiting-input into running semantic state records', async () => {
        const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-journal-state-'));
        temporaryDirectories.add(repositoryRoot);
        const writer = new AgentExecutionJournalWriter();

        await writer.ensureLaunchJournal({
            agentExecutionId: 'agent-execution-1',
            agentId: 'agent-1',
            scope: {
                kind: 'repository',
                repositoryRootPath: repositoryRoot
            },
            protocolDescriptor: createAgentExecutionProtocolDescriptor({
                scope: {
                    kind: 'repository',
                    repositoryRootPath: repositoryRoot
                },
                messages: []
            })
        });

        const decision: Extract<AgentExecutionSignalDecision, { action: 'update-execution' }> = {
            action: 'update-execution',
            eventType: 'execution.awaiting-input',
            snapshotPatch: {
                status: 'awaiting-input',
                attention: 'awaiting-operator',
                waitingForInput: true,
                progress: {
                    state: 'waiting-input',
                    summary: 'Need operator confirmation.',
                    updatedAt: '2026-05-09T00:00:01.000Z'
                }
            }
        };

        const record = await writer.appendStateChanged({
            agentExecutionId: 'agent-execution-1',
            scope: {
                kind: 'repository',
                repositoryRootPath: repositoryRoot
            },
            decision,
            currentInputRequestId: 'observation-1'
        });

        expect(record).toMatchObject({
            type: 'state.changed',
            lifecycle: 'running',
            attention: 'awaiting-operator',
            activity: 'communicating',
            currentInputRequestId: 'observation-1'
        });
    });
});