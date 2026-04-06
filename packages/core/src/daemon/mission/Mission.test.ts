import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createDefaultWorkflowSettings } from '../../workflow/engine/defaultWorkflow.js';
import { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import { FakeAgentRunner } from '../../testing/FakeAgentRunner.js';
import { Factory } from './Factory.js';
import type { MissionWorkflowBindings } from './Mission.js';

describe('Mission', () => {
    it('launches task sessions and translates runtime events into compatibility events', async () => {
        const workspaceRoot = await createTempRepo();
        const runner = new FakeAgentRunner('test-runner', 'Test Runner');

        try {
            const adapter = new FilesystemAdapter(workspaceRoot);
            const mission = await Factory.create(adapter, {
                brief: createBrief(201, 'Mission session compatibility'),
                branchRef: adapter.deriveMissionBranchName(201, 'Mission session compatibility')
            }, createWorkflowBindings(runner));

            try {
                const events: string[] = [];
                const agentMessages: string[] = [];
                const consoleLines: string[] = [];
                mission.onDidAgentEvent((event) => {
                    events.push(event.type);
                    if (event.type === 'agent-message') {
                        agentMessages.push(event.text);
                    }
                });
                mission.onDidAgentConsoleEvent((event) => {
                    if (event.type === 'lines') {
                        consoleLines.push(...event.lines);
                    }
                });

                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId || !startedStatus.missionDir) {
                    throw new Error('Expected a ready task and mission working directory after workflow start.');
                }

                const sessionRecord = await mission.launchAgentSession({
                    runtimeId: runner.id,
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'Complete the assigned task.'
                });
                const session = runner.getSession(sessionRecord.sessionId);
                if (!session) {
                    throw new Error(`Expected fake runner session '${sessionRecord.sessionId}' to exist.`);
                }

                session.emitMessage('runner output', 'stdout');
                session.emitAwaitingInput();
                await flushMicrotasks();

                const consoleState = mission.getAgentConsoleState(sessionRecord.sessionId);
                expect(sessionRecord).toMatchObject({
                    taskId,
                    runtimeId: runner.id,
                    assignmentLabel: expect.stringContaining('flight-deck/01-PRD/tasks/')
                });
                expect(events).toEqual(
                    expect.arrayContaining(['session-started', 'agent-message', 'session-state-changed'])
                );
                expect(agentMessages).toContain('runner output');
                expect(consoleLines).toContain('runner output');
                expect(consoleState).toMatchObject({
                    awaitingInput: true,
                    lines: ['runner output']
                });
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('cancels sessions through orchestrator-backed mission controls', async () => {
        const workspaceRoot = await createTempRepo();
        const runner = new FakeAgentRunner('test-runner', 'Test Runner');

        try {
            const adapter = new FilesystemAdapter(workspaceRoot);
            const mission = await Factory.create(adapter, {
                brief: createBrief(202, 'Mission session cancel'),
                branchRef: adapter.deriveMissionBranchName(202, 'Mission session cancel')
            }, createWorkflowBindings(runner));

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId || !startedStatus.missionDir) {
                    throw new Error('Expected a ready task and mission working directory after workflow start.');
                }

                const launched = await mission.launchAgentSession({
                    runtimeId: runner.id,
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'Cancel me.'
                });
                const cancelled = await mission.cancelAgentSession(launched.sessionId, 'operator cancelled');

                expect(cancelled.lifecycleState).toBe('cancelled');
                expect(runner.getSession(launched.sessionId)?.getSnapshot().phase).toBe('cancelled');
                expect(mission.getAgentSession(launched.sessionId)?.lifecycleState).toBe('cancelled');
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('terminates sessions through orchestrator-backed mission controls', async () => {
        const workspaceRoot = await createTempRepo();
        const runner = new FakeAgentRunner('test-runner', 'Test Runner');

        try {
            const adapter = new FilesystemAdapter(workspaceRoot);
            const mission = await Factory.create(adapter, {
                brief: createBrief(203, 'Mission session terminate'),
                branchRef: adapter.deriveMissionBranchName(203, 'Mission session terminate')
            }, createWorkflowBindings(runner));

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId || !startedStatus.missionDir) {
                    throw new Error('Expected a ready task and mission working directory after workflow start.');
                }

                const launched = await mission.launchAgentSession({
                    runtimeId: runner.id,
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'Terminate me.'
                });
                const terminated = await mission.terminateAgentSession(launched.sessionId, 'operator terminated');

                expect(terminated.lifecycleState).toBe('terminated');
                expect(runner.getSession(launched.sessionId)?.getSnapshot().phase).toBe('terminated');
                expect(mission.getAgentSession(launched.sessionId)?.lifecycleState).toBe('terminated');
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });
});

function createWorkflowBindings(runner: FakeAgentRunner): MissionWorkflowBindings {
    const workflow = createDefaultWorkflowSettings();
    workflow.autostart.mission = false;
    workflow.stages = Object.fromEntries(
        Object.entries(workflow.stages).map(([stageId, stage]) => [
            stageId,
            {
                ...stage,
                taskLaunchPolicy: {
                    ...stage.taskLaunchPolicy,
                    defaultAutostart: false,
                    launchMode: 'manual' as const
                }
            }
        ])
    ) as MissionWorkflowBindings['workflow']['stages'];
    return {
        workflow,
        resolveWorkflow: () => workflow,
        taskRunners: new Map([[runner.id, runner]])
    };
}

function createBrief(issueId: number, title: string) {
    return {
        issueId,
        title,
        body: `${title} body`,
        type: 'refactor' as const
    };
}

async function createTempRepo(): Promise<string> {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-core-mission-'));
    runGit(workspaceRoot, ['init']);
    runGit(workspaceRoot, ['config', 'user.email', 'mission@example.com']);
    runGit(workspaceRoot, ['config', 'user.name', 'Mission Test']);
    await fs.writeFile(path.join(workspaceRoot, 'README.md'), '# Mission Test\n', 'utf8');
    runGit(workspaceRoot, ['add', 'README.md']);
    runGit(workspaceRoot, ['commit', '-m', 'init']);
    return workspaceRoot;
}

function runGit(workspaceRoot: string, args: string[]): void {
    const result = spawnSync('git', args, {
        cwd: workspaceRoot,
        encoding: 'utf8'
    });
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed.`);
    }
}

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}