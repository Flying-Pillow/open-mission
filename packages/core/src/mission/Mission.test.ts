import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultWorkflowSettings } from '../workflow/mission/workflow.js';
import { FilesystemAdapter } from '../lib/FilesystemAdapter.js';
import { getMissionWorktreesPath } from '../lib/repoConfig.js';
import { FakeAgentRunner } from '../agent/testing/FakeAgentRunner.js';
import { Factory } from './Factory.js';
import type { MissionWorkflowBindings } from './Mission.js';

const temporaryWorkspaceRoots = new Set<string>();

afterEach(async () => {
    await Promise.all(
        [...temporaryWorkspaceRoots].map(async (workspaceRoot) => {
            temporaryWorkspaceRoots.delete(workspaceRoot);
            await fs.rm(getMissionWorktreesPath(workspaceRoot), { recursive: true, force: true }).catch(() => undefined);
            await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
        })
    );
});

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

    it('starts a ready task by launching its agent session', async () => {
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

                const startAction = (await mission.listAvailableActions()).find(
                    (action) => action.id === `task.start.${taskId}`
                );
                expect(startAction).toMatchObject({
                    action: '/task start',
                    enabled: true,
                    targetId: taskId
                });
                expect((await mission.listAvailableActions()).some(
                    (action) => action.id === `task.launch.${taskId}`
                )).toBe(false);

                const nextStatus = await mission.executeAction(`task.start.${taskId}`, [], {
                    terminalSessionName: 'airport-terminal-session'
                });
                expect(await runner.listSessions()).toHaveLength(1);
                expect(runner.getLastStartRequest()?.workingDirectory).toBe(startedStatus.missionDir);
                expect(runner.getLastStartRequest()?.terminalSessionName).toBe('airport-terminal-session');
                expect(runner.getLastStartRequest()?.initialPrompt?.text).toContain(
                    `Stay strictly within this mission workspace: ${startedStatus.missionDir}`
                );
                expect(runner.getLastStartRequest()?.initialPrompt?.text).toContain(
                    `Perform the task exactly as specified in <${task.fileName}>.`
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

    it('orders the tower tree with BRIEF first and stage artifacts after stage tasks', async () => {
        const workspaceRoot = await createTempRepo();
        const runner = new FakeAgentRunner('test-runner', 'Test Runner');

        try {
            const adapter = new FilesystemAdapter(workspaceRoot);
            const mission = await Factory.create(adapter, {
                brief: createBrief(206, 'Mission tree ordering'),
                branchRef: adapter.deriveMissionBranchName(206, 'Mission tree ordering')
            }, createWorkflowBindings(runner));

            try {
                const status = await mission.startWorkflow();
                const treeNodes = status.tower?.treeNodes ?? [];

                expect(treeNodes[0]).toMatchObject({
                    kind: 'mission-artifact',
                    label: 'BRIEF.md'
                });

                const prdTaskIndex = treeNodes.findIndex((node) => node.kind === 'task' && node.stageId === 'prd');
                const prdArtifactIndex = treeNodes.findIndex((node) => node.kind === 'stage-artifact' && node.stageId === 'prd');

                expect(prdTaskIndex).toBeGreaterThan(-1);
                expect(prdArtifactIndex).toBeGreaterThan(prdTaskIndex);
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('falls back to task artifact launch instructions when session prompt is empty', async () => {
        const workspaceRoot = await createTempRepo();
        const runner = new FakeAgentRunner('test-runner', 'Test Runner');

        try {
            const adapter = new FilesystemAdapter(workspaceRoot);
            const mission = await Factory.create(adapter, {
                brief: createBrief(207, 'Mission empty launch prompt fallback'),
                branchRef: adapter.deriveMissionBranchName(207, 'Mission empty launch prompt fallback')
            }, createWorkflowBindings(runner));

            try {
                const startedStatus = await mission.startWorkflow();
                const task = startedStatus.readyTasks?.[0];
                if (!task || !startedStatus.missionDir) {
                    throw new Error('Expected a ready task and mission working directory after workflow start.');
                }

                await mission.launchAgentSession({
                    runnerId: runner.id,
                    taskId: task.taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: ' '
                });

                expect(runner.getLastStartRequest()?.initialPrompt?.text).toContain(
                    `Perform the task exactly as specified in <${task.fileName}>.`
                );
                expect(runner.getLastStartRequest()?.initialPrompt?.text).toContain(
                    `Here are your instructions: @${task.filePath}`
                );
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('does not expose a separate launch action once a task is already running', async () => {
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
                expect(runningStatus.stages?.flatMap((stage) => stage.tasks).find((task) => task.taskId === taskId)?.status).toBe('running');
                expect(await runner.listSessions()).toHaveLength(1);
                expect(runningStatus.agentSessions?.length ?? 0).toBe(1);
                expect(runningStatus.agentSessions?.[0]).toMatchObject({
                    taskId,
                    runnerId: runner.id,
                    lifecycleState: 'running'
                });
                expect((await mission.listAvailableActions()).some(
                    (action) => action.id === `task.launch.${taskId}`
                )).toBe(false);
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('shows implementation task files in stage status while spec planning task is running', async () => {
        const workspaceRoot = await createTempRepo();
        const runner = new FakeAgentRunner('test-runner', 'Test Runner');

        try {
            const adapter = new FilesystemAdapter(workspaceRoot);
            const mission = await Factory.create(adapter, {
                brief: createBrief(208, 'Mission implementation task visibility during planning'),
                branchRef: adapter.deriveMissionBranchName(208, 'Mission implementation task visibility during planning')
            }, createWorkflowBindings(runner));

            try {
                const startedStatus = await mission.startWorkflow();
                const prdTaskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!prdTaskId || !startedStatus.missionDir) {
                    throw new Error('Expected a ready PRD task and mission working directory after workflow start.');
                }

                await mission.completeTask(prdTaskId);
                let specStatus = await mission.status();
                const specStages = specStatus.stages ?? [];
                const specStage = specStages.find((stage) => stage.stage === 'spec');
                if (!specStage) {
                    throw new Error('Expected spec stage after completing PRD task.');
                }

                let planTask = specStage.tasks.find((task) => task.taskId === 'spec/02-plan');
                if (!planTask) {
                    throw new Error('Expected spec/02-plan task in spec stage.');
                }

                if (planTask.status !== 'ready') {
                    await mission.completeTask('spec/01-spec-from-prd');
                    specStatus = await mission.status();
                    const refreshedSpecStages = specStatus.stages ?? [];
                    const refreshedSpecStage = refreshedSpecStages.find((stage) => stage.stage === 'spec');
                    planTask = refreshedSpecStage?.tasks.find((task) => task.taskId === 'spec/02-plan');
                    if (!planTask || planTask.status !== 'ready') {
                        throw new Error('Expected spec/02-plan to be ready after completing spec/01 task.');
                    }
                }

                await mission.launchAgentSession({
                    runnerId: runner.id,
                    taskId: planTask.taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'Plan implementation tasks now.'
                });

                await adapter.writeTaskRecord(
                    mission.getMissionDir(),
                    'implementation',
                    '01-visible-while-planning.md',
                    {
                        subject: 'Visible While Planning',
                        instruction: 'Make implementation slices visible in the mission-control tree during planning.',
                        agent: runner.id
                    }
                );

                const statusDuringPlanning = await mission.status();
                const planningStages = statusDuringPlanning.stages ?? [];
                const runningPlanTask = planningStages
                    .flatMap((stage) => stage.tasks)
                    .find((task) => task.taskId === 'spec/02-plan');
                expect(runningPlanTask?.status).toBe('running');

                const implementationStage = planningStages.find((stage) => stage.stage === 'implementation');
                expect(implementationStage?.tasks.map((task) => task.taskId)).toContain('implementation/01-visible-while-planning');
                expect(implementationStage?.tasks.find((task) => task.taskId === 'implementation/01-visible-while-planning')?.status).toBe('pending');
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('marks an active agent session completed before advancing a task to done', async () => {
        const workspaceRoot = await createTempRepo();
        const runner = new FakeAgentRunner('test-runner', 'Test Runner');

        try {
            const adapter = new FilesystemAdapter(workspaceRoot);
            const mission = await Factory.create(adapter, {
                brief: createBrief(209, 'Mission completes active session on task done'),
                branchRef: adapter.deriveMissionBranchName(209, 'Mission completes active session on task done')
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
                    prompt: 'Finish this task.'
                });

                expect(launched.lifecycleState).toBe('running');

                await mission.completeTask(taskId);

                const completedSession = mission.getAgentSession(launched.sessionId);
                expect(completedSession?.lifecycleState).toBe('completed');
                expect(runner.getSession(launched.sessionId)?.getSnapshot().status).toBe('completed');
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

    it('serves loaded mission status from in-memory runtime instead of rereading out-of-band mission.json edits', async () => {
        const workspaceRoot = await createTempRepo();
        const runner = new FakeAgentRunner('test-runner', 'Test Runner');

        try {
            const adapter = new FilesystemAdapter(workspaceRoot);
            const mission = await Factory.create(adapter, {
                brief: createBrief(208, 'Mission live daemon cache'),
                branchRef: adapter.deriveMissionBranchName(208, 'Mission live daemon cache')
            }, createWorkflowBindings(runner));

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId) {
                    throw new Error('Expected a ready task after workflow start.');
                }

                const persisted = await adapter.readMissionRuntimeRecord(mission.getMissionDir());
                if (!persisted) {
                    throw new Error('Expected a persisted mission runtime record.');
                }

                persisted.runtime.tasks = persisted.runtime.tasks.map((task) =>
                    task.taskId === taskId
                        ? {
                            ...task,
                            lifecycle: 'completed',
                            completedAt: '2026-04-14T10:00:00.000Z',
                            updatedAt: '2026-04-14T10:00:00.000Z'
                        }
                        : task
                );
                await adapter.writeMissionRuntimeRecord(mission.getMissionDir(), persisted);

                const status = await mission.status();
                expect(status.readyTasks?.some((task) => task.taskId === taskId)).toBe(true);
                expect(status.stages?.flatMap((stage) => stage.tasks).find((task) => task.taskId === taskId)?.status).toBe('ready');
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('refreshes mission action snapshots after pause and resume transitions', async () => {
        const workspaceRoot = await createTempRepo();
        const runner = new FakeAgentRunner('test-runner', 'Test Runner');

        try {
            const adapter = new FilesystemAdapter(workspaceRoot);
            const mission = await Factory.create(adapter, {
                brief: createBrief(209, 'Mission action snapshot freshness'),
                branchRef: adapter.deriveMissionBranchName(209, 'Mission action snapshot freshness')
            }, createWorkflowBindings(runner));

            try {
                await mission.startWorkflow();

                const runningActions = await mission.listAvailableActionsSnapshot();
                expect(runningActions.actions.find((action) => action.id === 'mission.pause')?.enabled).toBe(true);
                expect(runningActions.actions.find((action) => action.id === 'mission.resume')?.enabled).toBe(false);

                await mission.pauseMission();
                const pausedActions = await mission.listAvailableActionsSnapshot();
                expect(pausedActions.actions.find((action) => action.id === 'mission.resume')?.enabled).toBe(true);
                expect(pausedActions.actions.find((action) => action.id === 'mission.pause')?.enabled).toBe(false);

                await mission.resumeMission();
                const resumedActions = await mission.listAvailableActionsSnapshot();
                expect(resumedActions.actions.find((action) => action.id === 'mission.pause')?.enabled).toBe(true);
                expect(resumedActions.actions.find((action) => action.id === 'mission.resume')?.enabled).toBe(false);
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
                    defaultAutostart: false
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
    temporaryWorkspaceRoots.add(workspaceRoot);
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