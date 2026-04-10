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
                    runnerId: runner.id,
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'Complete the assigned task.'
                });
                expect(await runner.listSessions()).toHaveLength(1);
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
                    runnerId: runner.id,
                    assignmentLabel: expect.stringContaining('01-PRD/tasks/')
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
                    runnerId: runner.id,
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

    it('reconciles stale task sessions before relaunching the same task', async () => {
        const workspaceRoot = await createTempRepo();
        const runner = new FakeAgentRunner('test-runner', 'Test Runner');

        try {
            const adapter = new FilesystemAdapter(workspaceRoot);
            const mission = await Factory.create(adapter, {
                brief: createBrief(203, 'Mission stale session relaunch'),
                branchRef: adapter.deriveMissionBranchName(203, 'Mission stale session relaunch')
            }, createWorkflowBindings(runner));

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId || !startedStatus.missionDir) {
                    throw new Error('Expected a ready task and mission working directory after workflow start.');
                }

                const firstSession = await mission.launchAgentSession({
                    runnerId: runner.id,
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'First attempt.'
                });
                runner.deleteSession(firstSession.sessionId);

                const relaunchedSession = await mission.launchAgentSession({
                    runnerId: runner.id,
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'Second attempt.'
                });

                expect(relaunchedSession.sessionId).not.toBe(firstSession.sessionId);
                expect(mission.getAgentSession(firstSession.sessionId)?.lifecycleState).toBe('terminated');
                expect(mission.getAgentSession(relaunchedSession.sessionId)?.lifecycleState).toBe('running');
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('replaces a live task session when its working directory no longer matches the launch request', async () => {
        const workspaceRoot = await createTempRepo();
        const runner = new FakeAgentRunner('test-runner', 'Test Runner');

        try {
            const adapter = new FilesystemAdapter(workspaceRoot);
            const mission = await Factory.create(adapter, {
                brief: createBrief(204, 'Mission mismatched session workspace'),
                branchRef: adapter.deriveMissionBranchName(204, 'Mission mismatched session workspace')
            }, createWorkflowBindings(runner));

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId || !startedStatus.missionDir) {
                    throw new Error('Expected a ready task and mission working directory after workflow start.');
                }

                const firstSession = await mission.launchAgentSession({
                    runnerId: runner.id,
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'First attempt.'
                });
                runner.overrideSessionWorkingDirectory(firstSession.sessionId, path.join(workspaceRoot, 'wrong-workspace'));

                const relaunchedSession = await mission.launchAgentSession({
                    runnerId: runner.id,
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'Second attempt.'
                });

                expect(relaunchedSession.sessionId).not.toBe(firstSession.sessionId);
                expect(mission.getAgentSession(firstSession.sessionId)?.lifecycleState).toBe('terminated');
                expect(mission.getAgentSession(relaunchedSession.sessionId)?.lifecycleState).toBe('running');
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
                    runnerId: runner.id,
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

    it('exposes and executes a task launch action for ready tasks', async () => {
        const workspaceRoot = await createTempRepo();
        const runner = new FakeAgentRunner('test-runner', 'Test Runner');

        try {
            const adapter = new FilesystemAdapter(workspaceRoot);
            const mission = await Factory.create(adapter, {
                brief: createBrief(204, 'Mission task launch action'),
                branchRef: adapter.deriveMissionBranchName(204, 'Mission task launch action')
            }, createWorkflowBindings(runner));

            try {
                const startedStatus = await mission.startWorkflow();
                const task = startedStatus.readyTasks?.[0];
                const taskId = task?.taskId;
                if (!taskId || !startedStatus.missionDir || !task?.filePath) {
                    throw new Error('Expected a ready task after workflow start.');
                }

                const launchAction = (await mission.listAvailableActions()).find(
                    (action) => action.id === `task.launch.${taskId}`
                );
                expect(launchAction).toMatchObject({
                    action: '/launch',
                    enabled: true,
                    targetId: taskId
                });

                const nextStatus = await mission.executeAction(`task.launch.${taskId}`);
                expect(await runner.listSessions()).toHaveLength(1);
                expect(runner.getLastStartRequest()?.workingDirectory).toBe(startedStatus.missionDir);
                expect(runner.getLastStartRequest()?.initialPrompt?.text).toContain(
                    `Stay strictly within this mission workspace: ${startedStatus.missionDir}`
                );
                expect(runner.getLastStartRequest()?.initialPrompt?.text).toContain(
                    `Here are your instructions: @${task.filePath}`
                );
                expect(nextStatus.agentSessions?.length ?? 0).toBe(1);
                expect(nextStatus.agentSessions?.[0]).toMatchObject({
                    taskId,
                    runnerId: runner.id,
                    assignmentLabel: expect.stringContaining('01-PRD/tasks/')
                });
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('launches an agent session for a running task without violating workflow validation', async () => {
        const workspaceRoot = await createTempRepo();
        const runner = new FakeAgentRunner('test-runner', 'Test Runner');

        try {
            const adapter = new FilesystemAdapter(workspaceRoot);
            const mission = await Factory.create(adapter, {
                brief: createBrief(205, 'Mission running task launch action'),
                branchRef: adapter.deriveMissionBranchName(205, 'Mission running task launch action')
            }, createWorkflowBindings(runner));

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId) {
                    throw new Error('Expected a ready task after workflow start.');
                }

                const runningStatus = await mission.executeAction(`task.start.${taskId}`);
                expect(runningStatus.stages?.flatMap((stage) => stage.tasks).find((task) => task.taskId === taskId)?.status).toBe('active');

                const launchedStatus = await mission.executeAction(`task.launch.${taskId}`);
                expect(await runner.listSessions()).toHaveLength(1);
                expect(launchedStatus.agentSessions?.length ?? 0).toBe(1);
                expect(launchedStatus.agentSessions?.[0]).toMatchObject({
                    taskId,
                    runnerId: runner.id,
                    lifecycleState: 'running'
                });
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('fills missing transport identity for persisted copilot-cli runtime sessions', async () => {
        const workspaceRoot = await createTempRepo();
        const runner = new FakeAgentRunner('copilot-cli', 'Copilot CLI', 'terminal');

        try {
            const adapter = new FilesystemAdapter(workspaceRoot);
            const mission = await Factory.create(adapter, {
                brief: createBrief(206, 'Mission transport identity migration'),
                branchRef: adapter.deriveMissionBranchName(206, 'Mission transport identity migration')
            }, createWorkflowBindings(runner));

            const missionId = mission.getRecord().id;
            const missionDir = mission.getMissionDir();

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId || !startedStatus.missionDir) {
                    throw new Error('Expected a ready task and mission working directory after workflow start.');
                }

                const launched = await mission.launchAgentSession({
                    runnerId: runner.id,
                    transportId: 'terminal',
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'Migrate me.'
                });
                mission.dispose();

                const persisted = await adapter.readMissionRuntimeRecord(missionDir);
                if (!persisted) {
                    throw new Error('Expected persisted mission runtime record.');
                }
                persisted.runtime.sessions = persisted.runtime.sessions.map((session) =>
                    session.sessionId === launched.sessionId
                        ? {
                            ...session,
                            runnerId: 'copilot-cli'
                        }
                        : session
                );
                for (const session of persisted.runtime.sessions) {
                    delete (session as { transportId?: string }).transportId;
                }
                await adapter.writeMissionRuntimeRecord(missionDir, persisted);

                const reloaded = await Factory.load(adapter, { missionId }, createWorkflowBindings(runner));
                if (!reloaded) {
                    throw new Error('Expected mission to reload.');
                }

                try {
                    const status = await reloaded.status();
                    const migratedSession = status.agentSessions?.find((session) => session.sessionId === launched.sessionId);
                    expect(migratedSession).toMatchObject({
                        runnerId: 'copilot-cli',
                        transportId: 'terminal'
                    });

                    const migratedDocument = await adapter.readMissionRuntimeRecord(missionDir);
                    expect(migratedDocument?.runtime.sessions.find((session) => session.sessionId === launched.sessionId)).toMatchObject({
                        runnerId: 'copilot-cli',
                        transportId: 'terminal'
                    });
                } finally {
                    reloaded.dispose();
                }
            } catch (error) {
                mission.dispose();
                throw error;
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('keeps persisted sessions visible when status reconciliation fails', async () => {
        const workspaceRoot = await createTempRepo();
        const runner = new FakeAgentRunner('test-runner', 'Test Runner');

        try {
            const adapter = new FilesystemAdapter(workspaceRoot);
            const mission = await Factory.create(adapter, {
                brief: createBrief(207, 'Mission status fallback'),
                branchRef: adapter.deriveMissionBranchName(207, 'Mission status fallback')
            }, createWorkflowBindings(runner));

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId || !startedStatus.missionDir) {
                    throw new Error('Expected a ready task and mission working directory after workflow start.');
                }

                const launched = await mission.launchAgentSession({
                    runnerId: runner.id,
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'Stay visible.'
                });

                const workflowController = (mission as unknown as {
                    workflowController: { reconcileSessions(): Promise<unknown> };
                }).workflowController;
                workflowController.reconcileSessions = async () => {
                    throw new Error('synthetic reconcile failure');
                };

                const status = await mission.status();
                expect(status.agentSessions?.find((session) => session.sessionId === launched.sessionId)).toMatchObject({
                    sessionId: launched.sessionId,
                    runnerId: runner.id,
                    lifecycleState: 'running'
                });
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