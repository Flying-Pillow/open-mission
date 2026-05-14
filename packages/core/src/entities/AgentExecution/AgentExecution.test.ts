import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSurrealEntityFactory } from '../../lib/factory.js';
import {
    resolveRepositoryDatabasePath,
    SurrealDatabase
} from '../../lib/database/SurrealDatabase.js';
import { SurrealEntityStore } from '../../lib/database/SurrealEntityStore.js';
import { AgentExecution } from './AgentExecution.js';
import { agentExecutionJournalTableName } from './AgentExecutionSchema.js';

describe('AgentExecution repository storage smoke test', () => {
    it('creates a repository-owned AgentExecution in the repository SurrealDB database', async () => {
        const repositoryRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-agent-execution-repo-'));
        const ownerLocation = {
            ownerEntity: 'Repository' as const,
            repositoryRootPath
        };
        const namespace = 'open_mission_agent_execution_smoke_test';
        const factory = createSurrealEntityFactory({ ownerLocation, namespace });
        const database = SurrealDatabase.sharedForOwner({ ...ownerLocation, namespace });
        const databasePath = resolveRepositoryDatabasePath(repositoryRootPath);
        const data = AgentExecution.createData({
            ownerEntity: 'Repository',
            ownerId: 'repository-smoke',
            agentId: 'agent-smoke',
            agentExecutionId: 'execution-smoke'
        });

        try {
            const created = await factory.create(AgentExecution, data);
            const read = await factory.read(AgentExecution, created.id);

            expect(created.toData()).toEqual(data);
            expect(read?.toData()).toEqual(data);
            expect(database.readStatus()).toMatchObject({
                available: true,
                engine: 'surrealkv',
                namespace,
                database: 'mission',
                storagePath: databasePath
            });
            await expect(fs.stat(databasePath)).resolves.toBeDefined();
        } finally {
            await database.stop();
            await fs.rm(repositoryRootPath, { recursive: true, force: true });
        }
    });

    it('starts and stops a real background process without the daemon', async () => {
        const repositoryRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'open-mission-agent-execution-process-'));
        const execution = new AgentExecution(AgentExecution.createData({
            ownerEntity: 'Repository',
            ownerId: 'repository-process-smoke',
            agentId: 'node-process-smoke',
            agentExecutionId: 'execution-process-smoke'
        }));

        try {
            const started = await execution.startProcess({
                command: process.execPath,
                args: ['-e', 'setInterval(() => undefined, 1000);'],
                workingDirectory: repositoryRootPath
            });

            expect(started.status).toBe('running');
            expect(started.pid).toEqual(expect.any(Number));
            expect(execution.toData()).toMatchObject({
                lifecycle: 'running',
                activity: 'executing'
            });

            const stopped = await execution.stopProcess('AgentExecution smoke test stop.');
            expect(stopped.status).toBe('terminated');
            expect(execution.toData()).toMatchObject({
                lifecycle: 'terminated',
                activity: 'idle'
            });
        } finally {
            await execution.stopProcess().catch(() => undefined);
            await fs.rm(repositoryRootPath, { recursive: true, force: true });
        }
    });

    it('can launch Copilot CLI with a hello prompt when local Copilot auth is available', async () => {
        const copilotCommand = await resolveCopilotCommand();
        if (!copilotCommand) {
            console.warn('Skipping Copilot CLI smoke test because no copilot command is available.');
            return;
        }

        const repositoryRootPath = resolveCurrentRepositoryRootPath();
        const ownerLocation = {
            ownerEntity: 'Repository' as const,
            repositoryRootPath
        };
        const database = SurrealDatabase.sharedForOwner(ownerLocation);
        const factory = createSurrealEntityFactory({ ownerLocation });
        const journalStore = new SurrealEntityStore(database);
        const execution = await factory.save(AgentExecution, AgentExecution.createData({
            ownerEntity: 'Repository',
            ownerId: 'open-mission',
            agentId: 'copilot-cli',
            agentExecutionId: 'execution-copilot-smoke'
        }));

        try {
            await execution.startProcess({
                command: copilotCommand,
                args: [
                    '--allow-all',
                    '--no-color',
                    '--output-format',
                    'text',
                    '--no-auto-update',
                    '-p',
                    'Say exactly: hello from AgentExecution smoke test'
                ],
                workingDirectory: repositoryRootPath,
                env: createCopilotSmokeEnvironment()
            });
            const startRecord = execution.appendJournalRecord({
                kind: 'process.started',
                summary: 'Copilot CLI process started.',
                payload: {
                    command: copilotCommand,
                    workingDirectory: repositoryRootPath
                }
            });
            await journalStore.write(agentExecutionJournalTableName, startRecord.id, startRecord);
            await factory.save(AgentExecution, execution.toData());
            const completed = await execution.waitForProcessExit(60_000);
            const completionRecord = execution.appendJournalRecord({
                kind: toProcessJournalRecordKind(completed.status),
                summary: `Copilot CLI process ${completed.status}.`,
                payload: {
                    status: completed.status,
                    stdout: completed.stdout,
                    stderr: completed.stderr,
                    ...(completed.exitCode !== undefined ? { exitCode: completed.exitCode } : {}),
                    ...(completed.signal ? { signal: completed.signal } : {})
                }
            });
            await journalStore.write(agentExecutionJournalTableName, completionRecord.id, completionRecord);
            await factory.save(AgentExecution, execution.toData());
            if (isCopilotAuthenticationFailure(completed)) {
                console.warn('Skipping Copilot CLI hello assertion because local Copilot auth cannot complete a request.');
                return;
            }

            expect(completed.status).toBe('completed');
            expect(completed.stdout.toLowerCase()).toContain('hello from agentexecution smoke test');
            expect(execution.toData()).toMatchObject({
                lifecycle: 'completed',
                activity: 'idle'
            });
            const persisted = await factory.read(AgentExecution, execution.id);
            expect(persisted?.toData()).toMatchObject({
                agentExecutionId: 'execution-copilot-smoke',
                lifecycle: 'completed',
                activity: 'idle',
                journal: {
                    recordCount: 2,
                    lastSequence: 2
                }
            });
            const journalRows = await database.query<Array<{ kind: string; sequence: number }>>(
                'SELECT kind, sequence FROM agent_execution_journal WHERE journalId = $journalId ORDER BY sequence ASC;',
                { journalId: execution.toData().journal.journalId }
            );
            expect(journalRows[0]).toEqual([
                { kind: 'process.started', sequence: 1 },
                { kind: 'process.completed', sequence: 2 }
            ]);
            expect(database.readStatus()).toMatchObject({
                engine: 'surrealkv',
                namespace: 'open_mission',
                database: 'mission',
                storagePath: resolveRepositoryDatabasePath(repositoryRootPath)
            });
        } finally {
            await execution.stopProcess().catch(() => undefined);
            await database.stop();
        }
    }, 75_000);
});

function resolveCurrentRepositoryRootPath(): string {
    return path.resolve(process.cwd(), '../..');
}

function createCopilotSmokeEnvironment(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env['GH_TOKEN'];
    delete env['GITHUB_TOKEN'];
    delete env['COPILOT_GITHUB_TOKEN'];
    return env;
}

function toProcessJournalRecordKind(status: string): 'process.completed' | 'process.failed' | 'process.terminated' {
    if (status === 'completed') {
        return 'process.completed';
    }
    if (status === 'terminated') {
        return 'process.terminated';
    }
    return 'process.failed';
}

async function resolveCopilotCommand(): Promise<string | undefined> {
    const candidates = [
        process.env['OPEN_MISSION_COPILOT_CLI_COMMAND'],
        '/home/dev/.vscode-server/data/User/globalStorage/github.copilot-chat/copilotCli/copilot',
        ...resolvePathCommands('copilot')
    ].filter((candidate): candidate is string => Boolean(candidate?.trim()));

    for (const candidate of candidates) {
        const command = candidate.trim();
        if (await canExecute(command)) {
            return command;
        }
    }
    return undefined;
}

function resolvePathCommands(commandName: string): string[] {
    return (process.env['PATH'] ?? '')
        .split(path.delimiter)
        .filter(Boolean)
        .map((directory) => path.join(directory, commandName));
}

async function canExecute(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function isCopilotAuthenticationFailure(snapshot: { stdout: string; stderr: string }): boolean {
    return /authentication failed|no authentication information found|copilot requests/i.test(`${snapshot.stdout}\n${snapshot.stderr}`);
}
