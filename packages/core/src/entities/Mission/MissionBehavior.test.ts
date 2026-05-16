import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultWorkflowSettings } from '../../workflow/mission/workflow.js';
import { MissionDossierFilesystem } from './MissionDossierFilesystem.js';
import { Repository } from '../Repository/Repository.js';
import { Agent } from '../Agent/Agent.js';
import { AgentRegistry } from '../Agent/AgentRegistry.js';
import { DaemonLogger } from '../../daemon/runtime/DaemonLogger.js';
import { FakeAgentAdapter } from '../../daemon/runtime/agent-execution/testing/FakeAgentAdapter.js';
import { AgentExecutionCommandIds } from '../AgentExecution/AgentExecutionSchema.js';
import type { AgentExecutionRuntimeType } from '../../daemon/runtime/agent-execution/AgentExecutionRegistry.js';
import { TaskCommandIds } from '../Task/TaskSchema.js';
import { Mission } from './Mission.js';
import { MissionCommandIds } from './MissionSchema.js';
import type { MissionWorkflowBindings } from './Mission.js';

const temporaryWorkspaceRoots = new Set<string>();

afterEach(async () => {
    await Promise.all(
        [...temporaryWorkspaceRoots].map(async (workspaceRoot) => {
            temporaryWorkspaceRoots.delete(workspaceRoot);
            await fs.rm(Repository.getMissionWorktreesPath(workspaceRoot), { recursive: true, force: true }).catch(() => undefined);
            await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
        })
    );
});

describe('Mission', () => {
    it('builds mission snapshots and control views from the Mission instance', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(200, 'Mission owned control views'),
                branchRef: adapter.deriveMissionBranchName(200, 'Mission owned control views')
            }, createWorkflowBindings(agentAdapter));

            try {
                await mission.startWorkflow();
                const missionId = mission.getRecord().id;

                const data = await mission.buildMission();
                const control = await mission.buildMissionControl();

                expect(data.missionId).toBe(missionId);
                expect(data.commands).toEqual(expect.any(Array));
                expect(control.missionId).toBe(missionId);
                expect(data.commands?.length).toBeGreaterThan(0);
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('launches task agentExecutions and translates runtime events into compatibility events', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(201, 'Mission AgentExecution compatibility'),
                branchRef: adapter.deriveMissionBranchName(201, 'Mission AgentExecution compatibility')
            }, createWorkflowBindings(agentAdapter));

            try {
                const events: string[] = [];
                const agentMessages: string[] = [];
                const consoleLines: string[] = [];
                const agentExecutionStateChanges: AgentExecutionRuntimeType[] = [];
                mission.onDidAgentEvent((event) => {
                    events.push(event.type);
                    if (event.type === 'agent-message') {
                        agentMessages.push(event.text);
                    }
                    if (event.type === 'agent-execution-changed') {
                        agentExecutionStateChanges.push(event.execution);
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

                const agentExecutionData = await mission.launchAgentExecution({
                    agentId: agentAdapter.id,
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'Complete the assigned task.'
                });
                expect(await agentAdapter.listExecutions()).toHaveLength(1);
                const execution = agentAdapter.getAgentExecution(agentExecutionData.agentExecutionId);
                if (!execution) {
                    throw new Error(`Expected fake adapter execution '${agentExecutionData.agentExecutionId}' to exist.`);
                }

                execution.emitMessage('adapter output', 'stdout');
                execution.emitAwaitingInput();
                await flushMicrotasks();

                const consoleState = mission.getAgentConsoleState(agentExecutionData.agentExecutionId);
                expect(agentExecutionData).toMatchObject({
                    taskId,
                    agentId: agentAdapter.id,
                    assignmentLabel: expect.stringContaining('01-PRD/tasks/')
                });
                expect(events).toEqual(
                    expect.arrayContaining(['agent-execution-started', 'agent-message', 'agent-execution-changed'])
                );
                expect(agentMessages).toContain('adapter output');
                expect(consoleLines).toContain('adapter output');
                expect(consoleState).toMatchObject({
                    awaitingInput: true,
                    lines: ['adapter output']
                });
                expect(agentExecutionStateChanges.at(-1)?.lifecycleState).toBe('running');
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('cancels agentExecutions through orchestrator-backed mission controls', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(202, 'Mission AgentExecution cancel'),
                branchRef: adapter.deriveMissionBranchName(202, 'Mission AgentExecution cancel')
            }, createWorkflowBindings(agentAdapter));

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId || !startedStatus.missionDir) {
                    throw new Error('Expected a ready task and mission working directory after workflow start.');
                }

                const launched = await mission.launchAgentExecution({
                    agentId: agentAdapter.id,
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'Cancel me.'
                });
                const cancelled = await mission.cancelAgentExecution(launched.agentExecutionId, 'operator cancelled');

                expect(cancelled.lifecycleState).toBe('cancelled');
                expect(agentAdapter.getAgentExecution(launched.agentExecutionId)?.getSnapshot().phase).toBe('cancelled');
                expect(mission.getAgentExecution(launched.agentExecutionId)?.lifecycleState).toBe('cancelled');
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('reconciles stale task agentExecutions before relaunching the same task', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(203, 'Mission stale AgentExecution relaunch'),
                branchRef: adapter.deriveMissionBranchName(203, 'Mission stale AgentExecution relaunch')
            }, createWorkflowBindings(agentAdapter));

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId || !startedStatus.missionDir) {
                    throw new Error('Expected a ready task and mission working directory after workflow start.');
                }

                const firstAgentExecution = await mission.launchAgentExecution({
                    agentId: agentAdapter.id,
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'First attempt.'
                });
                agentAdapter.deleteAgentExecution(firstAgentExecution.agentExecutionId);

                const relaunchedAgentExecution = await mission.launchAgentExecution({
                    agentId: agentAdapter.id,
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'Second attempt.'
                });

                expect(relaunchedAgentExecution.agentExecutionId).not.toBe(firstAgentExecution.agentExecutionId);
                expect(mission.getAgentExecution(firstAgentExecution.agentExecutionId)?.lifecycleState).toBe('terminated');
                expect(mission.getAgentExecution(relaunchedAgentExecution.agentExecutionId)?.lifecycleState).toBe('running');
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('replaces a live task AgentExecution when its working directory no longer matches the launch request', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(204, 'Mission mismatched AgentExecution workspace'),
                branchRef: adapter.deriveMissionBranchName(204, 'Mission mismatched AgentExecution workspace')
            }, createWorkflowBindings(agentAdapter));

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId || !startedStatus.missionDir) {
                    throw new Error('Expected a ready task and mission working directory after workflow start.');
                }

                const firstAgentExecution = await mission.launchAgentExecution({
                    agentId: agentAdapter.id,
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'First attempt.'
                });
                agentAdapter.overrideAgentExecutionWorkingDirectory(firstAgentExecution.agentExecutionId, path.join(workspaceRoot, 'wrong-workspace'));

                const relaunchedAgentExecution = await mission.launchAgentExecution({
                    agentId: agentAdapter.id,
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'Second attempt.'
                });

                expect(relaunchedAgentExecution.agentExecutionId).not.toBe(firstAgentExecution.agentExecutionId);
                expect(mission.getAgentExecution(firstAgentExecution.agentExecutionId)?.lifecycleState).toBe('terminated');
                expect(mission.getAgentExecution(relaunchedAgentExecution.agentExecutionId)?.lifecycleState).toBe('running');
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('terminates agentExecutions through orchestrator-backed mission controls', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(203, 'Mission AgentExecution terminate'),
                branchRef: adapter.deriveMissionBranchName(203, 'Mission AgentExecution terminate')
            }, createWorkflowBindings(agentAdapter));

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId || !startedStatus.missionDir) {
                    throw new Error('Expected a ready task and mission working directory after workflow start.');
                }

                const launched = await mission.launchAgentExecution({
                    agentId: agentAdapter.id,
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'Terminate me.'
                });
                const terminated = await mission.terminateAgentExecution(launched.agentExecutionId, 'operator terminated');

                expect(terminated.lifecycleState).toBe('terminated');
                expect(agentAdapter.getAgentExecution(launched.agentExecutionId)?.getSnapshot().phase).toBe('terminated');
                expect(mission.getAgentExecution(launched.agentExecutionId)?.lifecycleState).toBe('terminated');
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('starts a ready task by launching its agent execution', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(204, 'Mission task launch command'),
                branchRef: adapter.deriveMissionBranchName(204, 'Mission task launch command')
            }, createWorkflowBindings(agentAdapter));

            try {
                const startedStatus = await mission.startWorkflow();
                const task = startedStatus.readyTasks?.[0];
                const taskId = task?.taskId;
                if (!taskId || !startedStatus.missionDir || !task?.filePath) {
                    throw new Error('Expected a ready task after workflow start.');
                }

                const startCommand = (await mission.listCommands()).find(
                    (command) => command.entity === 'Task' && command.id?.endsWith(`/${taskId}`) && command.commandId === TaskCommandIds.start
                );
                expect(startCommand).toMatchObject({
                    commandId: TaskCommandIds.start,
                    available: true
                });
                expect((await mission.listCommands()).some(
                    (command) => command.entity === 'Task' && command.id?.endsWith(`/${taskId}`) && command.commandId === 'task.launch'
                )).toBe(false);

                await mission.startTask(taskId, {
                    agentAdapter: agentAdapter.id,
                    terminalName: 'open-mission-terminal-AgentExecution'
                });
                const nextMission = await mission.buildMission();
                expect(await agentAdapter.listExecutions()).toHaveLength(1);
                expect(agentAdapter.getLastStartRequest()?.workingDirectory).toBe(startedStatus.missionDir);
                expect(agentAdapter.getLastStartRequest()?.terminalName).toBe('open-mission-terminal-AgentExecution');
                expect(agentAdapter.getLastStartRequest()?.initialPrompt?.text).toContain(
                    `Stay strictly within this mission workspace: ${startedStatus.missionDir}`
                );
                expect(agentAdapter.getLastStartRequest()?.initialPrompt?.text).toContain(
                    `Perform the task exactly as specified in <${task.fileName}>.`
                );
                expect(agentAdapter.getLastStartRequest()?.initialPrompt?.text).toContain(
                    `Here are your instructions: @${task.filePath}`
                );
                expect(nextMission.agentExecutions.length).toBe(1);
                expect(nextMission.agentExecutions[0]).toMatchObject({
                    taskId,
                    agentId: agentAdapter.id,
                    assignmentLabel: expect.stringContaining('01-PRD/tasks/')
                });
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('passes operator-selected launch settings through task start', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter', 'terminal');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(205, 'Mission task selected launch settings'),
                branchRef: adapter.deriveMissionBranchName(205, 'Mission task selected launch settings')
            }, createWorkflowBindings(agentAdapter));

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId) {
                    throw new Error('Expected a ready task after workflow start.');
                }

                await mission.startTask(taskId, {
                    agentAdapter: agentAdapter.id,
                    model: 'gpt-5-codex',
                    reasoningEffort: 'high',
                    terminalName: 'open-mission-terminal-AgentExecution'
                });

                expect(agentAdapter.getLastStartRequest()?.requestedAdapterId).toBe(agentAdapter.id);
                expect(agentAdapter.getLastStartRequest()?.metadata).toMatchObject({
                    model: 'gpt-5-codex',
                    reasoningEffort: 'high',
                    terminalName: 'open-mission-terminal-AgentExecution'
                });
                const persisted = await Mission.readStateData(adapter, mission.getMissionDir());
                const persistedTask = persisted?.runtime.tasks.find((task) => task.taskId === taskId);
                expect(persistedTask).toMatchObject({
                    agentAdapter: agentAdapter.id,
                    model: 'gpt-5-codex',
                    reasoningEffort: 'high'
                });
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('persists task configuration before start and uses it for launch', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter', 'terminal');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(206, 'Mission task configured launch settings'),
                branchRef: adapter.deriveMissionBranchName(206, 'Mission task configured launch settings')
            }, createWorkflowBindings(agentAdapter));

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId) {
                    throw new Error('Expected a ready task after workflow start.');
                }

                await mission.configureTask(taskId, {
                    agentAdapter: agentAdapter.id,
                    model: 'gpt-5.5',
                    reasoningEffort: 'high',
                    autostart: false,
                    context: [{ name: 'Operator note', path: 'context/operator-note.md', selectionPosition: 0 }]
                });

                const configuredMission = await mission.buildMission();
                const configuredTask = configuredMission.workflow?.tasks?.find((task) => task.taskId === taskId);
                expect(configuredTask).toMatchObject({
                    taskId,
                    agentAdapter: agentAdapter.id,
                    model: 'gpt-5.5',
                    reasoningEffort: 'high',
                    runtime: { autostart: false },
                    context: [{ name: 'Operator note', path: 'context/operator-note.md', selectionPosition: 0 }]
                });

                const persisted = await Mission.readStateData(adapter, mission.getMissionDir());
                const persistedTask = persisted?.runtime.tasks.find((task) => task.taskId === taskId);
                expect(persistedTask).toMatchObject({
                    agentAdapter: agentAdapter.id,
                    model: 'gpt-5.5',
                    reasoningEffort: 'high',
                    runtime: { autostart: false },
                    context: [{ name: 'Operator note', path: 'context/operator-note.md', selectionPosition: 0 }]
                });

                await mission.startTask(taskId, { agentAdapter: agentAdapter.id });

                expect(agentAdapter.getLastStartRequest()?.requestedAdapterId).toBe(agentAdapter.id);
                expect(agentAdapter.getLastStartRequest()?.metadata).toMatchObject({
                    model: 'gpt-5.5',
                    reasoningEffort: 'high'
                });
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('exposes and executes task rework as an input-taking operator command', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(2041, 'Mission task rework command'),
                branchRef: adapter.deriveMissionBranchName(2041, 'Mission task rework command')
            }, createWorkflowBindings(agentAdapter));

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId) {
                    throw new Error('Expected an initial ready task after workflow start.');
                }

                await mission.completeTask(taskId);

                const reworkCommand = (await mission.listCommands()).find(
                    (command) => command.entity === 'Task' && command.id?.endsWith(`/${taskId}`) && command.commandId === 'task.rework'
                );
                expect(reworkCommand).toMatchObject({
                    commandId: 'task.rework',
                    available: true,
                    input: expect.objectContaining({ kind: 'text', required: true })
                });

                await mission.reworkTask(taskId, {
                    actor: 'human',
                    reasonCode: 'manual.instruction',
                    summary: 'The previous output missed the requested review criteria.',
                    artifactRefs: []
                });
                const nextMission = await mission.buildMission();

                const workflowTask = nextMission.workflow?.tasks?.find((task: { taskId: string }) => task.taskId === taskId);
                expect(workflowTask).toMatchObject({
                    taskId,
                    lifecycle: 'ready',
                    reworkIterationCount: 1,
                    reworkRequest: expect.objectContaining({
                        actor: 'human',
                        reasonCode: 'manual.instruction',
                        summary: 'The previous output missed the requested review criteria.'
                    }),
                    pendingLaunchContext: expect.objectContaining({
                        reasonCode: 'manual.instruction',
                        summary: 'The previous output missed the requested review criteria.'
                    })
                });
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('reworks the paired implementation task when triggered from a verification task', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(2042, 'Mission verification-triggered rework command'),
                branchRef: adapter.deriveMissionBranchName(2042, 'Mission verification-triggered rework command')
            }, createWorkflowBindings(agentAdapter));

            const missionId = mission.getRecord().id;
            const missionDir = mission.getMissionDir();

            try {
                await mission.startWorkflow();
                await adapter.writeTaskRecord(missionDir, 'implementation', '02-boundary.md', {
                    subject: 'Implement Boundary',
                    instruction: 'Build the boundary slice.',
                    taskKind: 'implementation',
                    pairedTaskId: 'implementation/02-boundary-verify',
                    agent: 'copilot-cli'
                });
                await adapter.writeTaskRecord(missionDir, 'implementation', '02-boundary-verify.md', {
                    subject: 'Verify Boundary',
                    instruction: 'Validate the boundary slice and document failures.',
                    taskKind: 'verification',
                    pairedTaskId: 'implementation/02-boundary',
                    dependsOn: ['02-boundary'],
                    agent: 'copilot-cli'
                });

                const persisted = await Mission.readStateData(adapter, missionDir);
                if (!persisted) {
                    throw new Error('Expected a persisted mission runtime data.');
                }

                persisted.runtime.activeStageId = 'implementation';
                persisted.runtime.tasks = [
                    {
                        taskId: 'implementation/02-boundary',
                        stageId: 'implementation',
                        title: 'Implement Boundary',
                        instruction: 'Build the boundary slice.',
                        taskKind: 'implementation',
                        pairedTaskId: 'implementation/02-boundary-verify',
                        dependsOn: [],
                        lifecycle: 'completed',
                        waitingOnTaskIds: [],
                        runtime: { autostart: false },
                        retries: 0,
                        createdAt: '2026-04-14T10:00:00.000Z',
                        updatedAt: '2026-04-14T10:10:00.000Z',
                        completedAt: '2026-04-14T10:10:00.000Z'
                    },
                    {
                        taskId: 'implementation/02-boundary-verify',
                        stageId: 'implementation',
                        title: 'Verify Boundary',
                        instruction: 'Validate the boundary slice and document failures.',
                        taskKind: 'verification',
                        pairedTaskId: 'implementation/02-boundary',
                        dependsOn: ['implementation/02-boundary'],
                        lifecycle: 'completed',
                        waitingOnTaskIds: [],
                        runtime: { autostart: false },
                        retries: 0,
                        createdAt: '2026-04-14T10:11:00.000Z',
                        updatedAt: '2026-04-14T10:20:00.000Z',
                        completedAt: '2026-04-14T10:20:00.000Z'
                    }
                ];
                persisted.runtime.stages = persisted.runtime.stages.map((stage) =>
                    stage.stageId === 'implementation'
                        ? {
                            ...stage,
                            lifecycle: 'running',
                            taskIds: ['implementation/02-boundary', 'implementation/02-boundary-verify'],
                            readyTaskIds: [],
                            queuedTaskIds: [],
                            runningTaskIds: [],
                            completedTaskIds: ['implementation/02-boundary', 'implementation/02-boundary-verify'],
                            enteredAt: '2026-04-14T10:00:00.000Z'
                        }
                        : {
                            ...stage,
                            taskIds: [],
                            readyTaskIds: [],
                            queuedTaskIds: [],
                            runningTaskIds: [],
                            completedTaskIds: []
                        }
                );
                await Mission.writeStateData(adapter, missionDir, persisted);
            } finally {
                mission.dispose();
            }

            const reloaded = await Mission.load(adapter, { missionId }, createWorkflowBindings(agentAdapter));
            if (!reloaded) {
                throw new Error('Expected mission to reload.');
            }

            try {
                const reworkCommand = (await reloaded.listCommands()).find(
                    (command) => command.entity === 'Task'
                        && command.id?.endsWith('/implementation/02-boundary-verify')
                        && command.commandId === 'task.reworkFromVerification'
                );
                expect(reworkCommand).toMatchObject({
                    commandId: 'task.reworkFromVerification',
                    available: true,
                    label: 'Send Back'
                });

                await reloaded.reworkTaskFromVerification('implementation/02-boundary-verify');
                const nextMission = await reloaded.buildMission();
                const implementationTask = nextMission.workflow?.tasks?.find((task: { taskId: string }) => task.taskId === 'implementation/02-boundary');
                const verificationTask = nextMission.workflow?.tasks?.find((task: { taskId: string }) => task.taskId === 'implementation/02-boundary-verify');

                expect(implementationTask).toMatchObject({
                    taskId: 'implementation/02-boundary',
                    reworkRequest: expect.objectContaining({
                        actor: 'workflow',
                        reasonCode: 'verification.failed',
                        sourceTaskId: 'implementation/02-boundary-verify',
                        artifactRefs: expect.arrayContaining([
                            expect.objectContaining({ path: '03-IMPLEMENTATION/tasks/02-boundary-verify.md' })
                        ])
                    })
                });
                expect(verificationTask?.lifecycle).toBe('pending');
            } finally {
                reloaded.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('resolves verification-driven rework from file task metadata when runtime pairing metadata is absent', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(2043, 'Mission verification-triggered rework command from file metadata'),
                branchRef: adapter.deriveMissionBranchName(2043, 'Mission verification-triggered rework command from file metadata')
            }, createWorkflowBindings(agentAdapter));

            const missionId = mission.getRecord().id;
            const missionDir = mission.getMissionDir();

            try {
                await mission.startWorkflow();
                await adapter.writeTaskRecord(missionDir, 'implementation', '02-boundary.md', {
                    subject: 'Implement Boundary',
                    instruction: 'Build the boundary slice.',
                    taskKind: 'implementation',
                    pairedTaskId: 'implementation/02-boundary-verify',
                    agent: 'copilot-cli'
                });
                await adapter.writeTaskRecord(missionDir, 'implementation', '02-boundary-verify.md', {
                    subject: 'Verify Boundary',
                    instruction: 'Validate the boundary slice and document failures.',
                    taskKind: 'verification',
                    pairedTaskId: 'implementation/02-boundary',
                    dependsOn: ['02-boundary'],
                    agent: 'copilot-cli'
                });

                const persisted = await Mission.readStateData(adapter, missionDir);
                if (!persisted) {
                    throw new Error('Expected a persisted mission runtime data.');
                }

                persisted.runtime.activeStageId = 'implementation';
                persisted.runtime.tasks = [
                    {
                        taskId: 'implementation/02-boundary',
                        stageId: 'implementation',
                        title: 'Implement Boundary',
                        instruction: 'Build the boundary slice.',
                        dependsOn: [],
                        lifecycle: 'completed',
                        waitingOnTaskIds: [],
                        runtime: { autostart: false },
                        retries: 0,
                        createdAt: '2026-04-14T10:00:00.000Z',
                        updatedAt: '2026-04-14T10:10:00.000Z',
                        completedAt: '2026-04-14T10:10:00.000Z'
                    },
                    {
                        taskId: 'implementation/02-boundary-verify',
                        stageId: 'implementation',
                        title: 'Verify Boundary',
                        instruction: 'Validate the boundary slice and document failures.',
                        dependsOn: ['implementation/02-boundary'],
                        lifecycle: 'completed',
                        waitingOnTaskIds: [],
                        runtime: { autostart: false },
                        retries: 0,
                        createdAt: '2026-04-14T10:11:00.000Z',
                        updatedAt: '2026-04-14T10:20:00.000Z',
                        completedAt: '2026-04-14T10:20:00.000Z'
                    }
                ];
                persisted.runtime.stages = persisted.runtime.stages.map((stage) =>
                    stage.stageId === 'implementation'
                        ? {
                            ...stage,
                            lifecycle: 'running',
                            taskIds: ['implementation/02-boundary', 'implementation/02-boundary-verify'],
                            readyTaskIds: [],
                            queuedTaskIds: [],
                            runningTaskIds: [],
                            completedTaskIds: ['implementation/02-boundary', 'implementation/02-boundary-verify'],
                            enteredAt: '2026-04-14T10:00:00.000Z'
                        }
                        : {
                            ...stage,
                            taskIds: [],
                            readyTaskIds: [],
                            queuedTaskIds: [],
                            runningTaskIds: [],
                            completedTaskIds: []
                        }
                );
                await Mission.writeStateData(adapter, missionDir, persisted);
            } finally {
                mission.dispose();
            }

            const reloaded = await Mission.load(adapter, { missionId }, createWorkflowBindings(agentAdapter));
            if (!reloaded) {
                throw new Error('Expected mission to reload.');
            }

            try {
                const reworkCommand = (await reloaded.listCommands()).find(
                    (command) => command.entity === 'Task'
                        && command.id?.endsWith('/implementation/02-boundary-verify')
                        && command.commandId === 'task.reworkFromVerification'
                );
                expect(reworkCommand).toMatchObject({
                    commandId: 'task.reworkFromVerification',
                    available: true,
                    label: 'Send Back'
                });

                await reloaded.reworkTaskFromVerification('implementation/02-boundary-verify');
                const nextMission = await reloaded.buildMission();
                const implementationTask = nextMission.workflow?.tasks?.find((task: { taskId: string }) => task.taskId === 'implementation/02-boundary');
                const verificationTask = nextMission.workflow?.tasks?.find((task: { taskId: string }) => task.taskId === 'implementation/02-boundary-verify');

                expect(implementationTask).toMatchObject({
                    taskId: 'implementation/02-boundary',
                    reworkRequest: expect.objectContaining({
                        actor: 'workflow',
                        reasonCode: 'verification.failed',
                        sourceTaskId: 'implementation/02-boundary-verify',
                        artifactRefs: expect.arrayContaining([
                            expect.objectContaining({ path: '03-IMPLEMENTATION/tasks/02-boundary-verify.md' })
                        ])
                    })
                });
                expect(verificationTask?.lifecycle).toBe('pending');
            } finally {
                reloaded.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('falls back to task artifact launch instructions when AgentExecution prompt is empty', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(207, 'Mission empty launch prompt fallback'),
                branchRef: adapter.deriveMissionBranchName(207, 'Mission empty launch prompt fallback')
            }, createWorkflowBindings(agentAdapter));

            try {
                const startedStatus = await mission.startWorkflow();
                const task = startedStatus.readyTasks?.[0];
                if (!task || !startedStatus.missionDir) {
                    throw new Error('Expected a ready task and mission working directory after workflow start.');
                }

                await mission.launchAgentExecution({
                    agentId: agentAdapter.id,
                    taskId: task.taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: ' '
                });

                expect(agentAdapter.getLastStartRequest()?.initialPrompt?.text).toContain(
                    `Perform the task exactly as specified in <${task.fileName}>.`
                );
                expect(agentAdapter.getLastStartRequest()?.initialPrompt?.text).toContain(
                    `Here are your instructions: @${task.filePath}`
                );
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('does not expose a separate launch command once a task is already running', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(205, 'Mission running task launch command'),
                branchRef: adapter.deriveMissionBranchName(205, 'Mission running task launch command')
            }, createWorkflowBindings(agentAdapter));

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId) {
                    throw new Error('Expected a ready task after workflow start.');
                }

                await mission.startTask(taskId);
                const runningMission = await mission.buildMission();
                expect(runningMission.tasks.find((task) => task.taskId === taskId)?.lifecycle).toBe('running');
                expect(await agentAdapter.listExecutions()).toHaveLength(1);
                expect(runningMission.agentExecutions.length).toBe(1);
                expect(runningMission.agentExecutions[0]).toMatchObject({
                    taskId,
                    agentId: agentAdapter.id,
                    lifecycleState: 'running'
                });
                expect((await mission.listCommands()).some(
                    (command) => command.entity === 'Task' && command.id?.endsWith(`/${taskId}`) && command.commandId === 'task.launch'
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
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(208, 'Mission implementation task visibility during planning'),
                branchRef: adapter.deriveMissionBranchName(208, 'Mission implementation task visibility during planning')
            }, createWorkflowBindings(agentAdapter));

            try {
                const startedStatus = await mission.startWorkflow();
                const prdTaskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!prdTaskId || !startedStatus.missionDir) {
                    throw new Error('Expected a ready PRD task and mission working directory after workflow start.');
                }

                await mission.completeTask(prdTaskId);
                let specMission = await mission.buildMission();
                const specStage = specMission.stages.find((stage) => stage.stageId === 'spec');
                if (!specStage) {
                    throw new Error('Expected spec stage after completing PRD task.');
                }

                let planTask = specStage.tasks.find((task) => task.taskId === 'spec/02-plan');
                if (!planTask) {
                    throw new Error('Expected spec/02-plan task in spec stage.');
                }

                if (planTask.lifecycle !== 'ready') {
                    await mission.completeTask('spec/01-spec-from-prd');
                    specMission = await mission.buildMission();
                    const refreshedSpecStage = specMission.stages.find((stage) => stage.stageId === 'spec');
                    planTask = refreshedSpecStage?.tasks.find((task) => task.taskId === 'spec/02-plan');
                    if (!planTask || planTask.lifecycle !== 'ready') {
                        throw new Error('Expected spec/02-plan to be ready after completing spec/01 task.');
                    }
                }

                await mission.launchAgentExecution({
                    agentId: agentAdapter.id,
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
                        agent: agentAdapter.id
                    }
                );

                const missionDuringPlanning = await mission.buildMission();
                const runningPlanTask = missionDuringPlanning.tasks.find((task) => task.taskId === 'spec/02-plan');
                expect(runningPlanTask?.lifecycle).toBe('running');

                const implementationStage = missionDuringPlanning.stages.find((stage) => stage.stageId === 'implementation');
                expect(implementationStage?.tasks.map((task) => task.taskId)).toContain('implementation/01-visible-while-planning');
                expect(implementationStage?.tasks.find((task) => task.taskId === 'implementation/01-visible-while-planning')?.lifecycle).toBe('pending');
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('marks an active agent execution completed before advancing a task to done', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(209, 'Mission completes active AgentExecution on task done'),
                branchRef: adapter.deriveMissionBranchName(209, 'Mission completes active AgentExecution on task done')
            }, createWorkflowBindings(agentAdapter));

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId || !startedStatus.missionDir) {
                    throw new Error('Expected a ready task and mission working directory after workflow start.');
                }

                const launched = await mission.launchAgentExecution({
                    agentId: agentAdapter.id,
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'Finish this task.'
                });

                expect(launched.lifecycleState).toBe('running');

                await mission.completeTask(taskId);

                const completedAgentExecution = mission.getAgentExecution(launched.agentExecutionId);
                expect(completedAgentExecution?.lifecycleState).toBe('completed');
                expect(agentAdapter.getAgentExecution(launched.agentExecutionId)?.getSnapshot().status).toBe('completed');
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('does not rewrite missing transport identity for persisted runtime agentExecutions', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('copilot-cli', 'Copilot CLI', 'terminal');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(206, 'Mission transport identity migration'),
                branchRef: adapter.deriveMissionBranchName(206, 'Mission transport identity migration')
            }, createWorkflowBindings(agentAdapter));

            const missionId = mission.getRecord().id;
            const missionDir = mission.getMissionDir();

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId || !startedStatus.missionDir) {
                    throw new Error('Expected a ready task and mission working directory after workflow start.');
                }

                const launched = await mission.launchAgentExecution({
                    agentId: agentAdapter.id,
                    transportId: 'terminal',
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'Migrate me.'
                });
                mission.dispose();

                const persisted = await Mission.readStateData(adapter, missionDir);
                if (!persisted) {
                    throw new Error('Expected persisted mission runtime data.');
                }
                persisted.runtime.agentExecutions = persisted.runtime.agentExecutions.map((execution) =>
                    execution.agentExecutionId === launched.agentExecutionId
                        ? {
                            ...execution,
                            agentId: 'copilot-cli'
                        }
                        : execution
                );
                for (const AgentExecution of persisted.runtime.agentExecutions) {
                    delete (AgentExecution as { transportId?: string }).transportId;
                }
                await Mission.writeStateData(adapter, missionDir, persisted);

                const reloaded = await Mission.load(adapter, { missionId }, createWorkflowBindings(agentAdapter));
                if (!reloaded) {
                    throw new Error('Expected mission to reload.');
                }

                try {
                    const missionData = await reloaded.buildMission();
                    const migratedAgentExecution = missionData.agentExecutions.find((execution) => execution.agentExecutionId === launched.agentExecutionId);
                    expect(migratedAgentExecution).toMatchObject({
                        agentId: 'copilot-cli',
                        transportId: 'terminal'
                    });

                    const persistedDocument = await Mission.readStateData(adapter, missionDir);
                    const persistedAgentExecution = persistedDocument?.runtime.agentExecutions.find((execution) => execution.agentExecutionId === launched.agentExecutionId);
                    expect(persistedAgentExecution).toMatchObject({
                        agentId: 'copilot-cli'
                    });
                    expect(persistedAgentExecution).not.toHaveProperty('transportId');
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

    it('keeps persisted agentExecutions visible when status reconciliation fails', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(207, 'Mission status fallback'),
                branchRef: adapter.deriveMissionBranchName(207, 'Mission status fallback')
            }, createWorkflowBindings(agentAdapter));

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId || !startedStatus.missionDir) {
                    throw new Error('Expected a ready task and mission working directory after workflow start.');
                }

                const launched = await mission.launchAgentExecution({
                    agentId: agentAdapter.id,
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'Stay visible.'
                });

                const workflowController = (mission as unknown as {
                    workflowController: { reconcileExecutions(): Promise<unknown> };
                }).workflowController;
                workflowController.reconcileExecutions = async () => {
                    throw new Error('synthetic reconcile failure');
                };

                const missionData = await mission.buildMission();
                expect(missionData.agentExecutions.find((execution) => execution.agentExecutionId === launched.agentExecutionId)).toMatchObject({
                    agentExecutionId: launched.agentExecutionId,
                    agentId: agentAdapter.id,
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
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(208, 'Mission live daemon cache'),
                branchRef: adapter.deriveMissionBranchName(208, 'Mission live daemon cache')
            }, createWorkflowBindings(agentAdapter));

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId) {
                    throw new Error('Expected a ready task after workflow start.');
                }

                const persisted = await Mission.readStateData(adapter, mission.getMissionDir());
                if (!persisted) {
                    throw new Error('Expected a persisted mission runtime data.');
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
                await Mission.writeStateData(adapter, mission.getMissionDir(), persisted);

                const missionData = await mission.buildMission();
                expect(missionData.tasks.some((task) => task.taskId === taskId && task.lifecycle === 'ready')).toBe(true);
                expect(missionData.stages.flatMap((stage) => stage.tasks).find((task) => task.taskId === taskId)?.lifecycle).toBe('ready');
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('refreshes mission command snapshots after pause and resume transitions', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(209, 'Mission command snapshot freshness'),
                branchRef: adapter.deriveMissionBranchName(209, 'Mission command snapshot freshness')
            }, createWorkflowBindings(agentAdapter));

            try {
                await mission.startWorkflow();

                const runningCommands = await mission.readCommands();
                expect(findMissionCommand(runningCommands, MissionCommandIds.pause)?.available).toBe(true);
                expect(findMissionCommand(runningCommands, MissionCommandIds.resume)?.available).toBe(false);

                await mission.pauseMission();
                const pausedCommands = await mission.readCommands();
                expect(findMissionCommand(pausedCommands, MissionCommandIds.resume)?.available).toBe(true);
                expect(findMissionCommand(pausedCommands, MissionCommandIds.pause)?.available).toBe(false);

                await mission.resumeMission();
                const resumedCommands = await mission.readCommands();
                expect(findMissionCommand(resumedCommands, MissionCommandIds.pause)?.available).toBe(true);
                expect(findMissionCommand(resumedCommands, MissionCommandIds.resume)?.available).toBe(false);
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('keeps AgentExecution stop commands enabled while an agent has a semantic input request', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(210, 'Mission semantic input-request AgentExecution commands'),
                branchRef: adapter.deriveMissionBranchName(210, 'Mission semantic input-request AgentExecution commands')
            }, createWorkflowBindings(agentAdapter));

            try {
                const startedStatus = await mission.startWorkflow();
                const taskId = startedStatus.readyTasks?.[0]?.taskId;
                if (!taskId || !startedStatus.missionDir) {
                    throw new Error('Expected a ready task and mission working directory after workflow start.');
                }

                const launched = await mission.launchAgentExecution({
                    agentId: agentAdapter.id,
                    taskId,
                    workingDirectory: startedStatus.missionDir,
                    prompt: 'Need operator input.'
                });
                const execution = agentAdapter.getAgentExecution(launched.agentExecutionId);
                if (!execution) {
                    throw new Error(`Expected fake adapter execution '${launched.agentExecutionId}' to exist.`);
                }

                execution.emitAwaitingInput();
                await flushMicrotasks();

                const commands = await mission.readCommands();
                expect(findAgentExecutionCommand(commands, launched.agentExecutionId, AgentExecutionCommandIds.cancel)?.available).toBe(true);
                expect(commands.filter((command) => command.entity === 'AgentExecution' && command.id?.endsWith(`/${launched.agentExecutionId}`))).toHaveLength(1);
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('does not expose deliver when the delivery stage is already completed', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const mission = await Mission.create(adapter, {
                brief: createBrief(210, 'Mission delivered command availability'),
                branchRef: adapter.deriveMissionBranchName(210, 'Mission delivered command availability')
            }, createWorkflowBindings(agentAdapter));

            try {
                await mission.startWorkflow();

                const persisted = await Mission.readStateData(adapter, mission.getMissionDir());
                if (!persisted) {
                    throw new Error('Expected a persisted mission runtime data.');
                }

                persisted.runtime = {
                    ...persisted.runtime,
                    lifecycle: 'completed',
                    activeStageId: 'delivery',
                    stages: persisted.runtime.stages.map((stage) => ({
                        ...stage,
                        lifecycle: 'completed'
                    })),
                    gates: persisted.runtime.gates.map((gate) => ({
                        ...gate,
                        state: 'passed',
                        reasons: []
                    })),
                    updatedAt: '2026-04-20T16:00:00.000Z'
                };
                await Mission.writeStateData(adapter, mission.getMissionDir(), persisted);

                const reloaded = await Mission.load(adapter, { missionId: mission.getRecord().id }, createWorkflowBindings(agentAdapter));
                if (!reloaded) {
                    throw new Error('Expected mission to reload.');
                }

                const commands = await reloaded.readCommands();
                expect(findMissionCommand(commands, 'mission.deliver')).toMatchObject({
                    available: false,
                    unavailableReason: 'Mission already delivered.'
                });
                reloaded.dispose();
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('keeps daemon logger context when Mission forwards debug logging to the request executor', async () => {
        const workspaceRoot = await createTempRepo();
        const agentAdapter = new FakeAgentAdapter('test-adapter', 'Test Adapter');

        try {
            const adapter = new MissionDossierFilesystem(workspaceRoot);
            const logger = new DaemonLogger(path.join(workspaceRoot, 'daemon.log'));
            const bindings = createWorkflowBindings(agentAdapter);
            const mission = await Mission.create(adapter, {
                brief: createBrief(211, 'Mission logger binding'),
                branchRef: adapter.deriveMissionBranchName(211, 'Mission logger binding')
            }, {
                ...bindings,
                logger
            });

            try {
                await mission.startWorkflow();
                await logger.flush();
            } finally {
                mission.dispose();
            }
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

});

type TestOwnedCommand = Awaited<ReturnType<Mission['listCommands']>>[number];

function findMissionCommand(commands: TestOwnedCommand[], commandId: string) {
    return commands.find((command) => command.entity === 'Mission' && command.commandId === commandId);
}

function findAgentExecutionCommand(commands: TestOwnedCommand[], agentExecutionId: string, commandId: string) {
    return commands.find((command) =>
        command.entity === 'AgentExecution'
        && command.id?.endsWith(`/${agentExecutionId}`)
        && command.commandId === commandId
    );
}

function createWorkflowBindings(adapter: FakeAgentAdapter): MissionWorkflowBindings {
    const workflow = createDefaultWorkflowSettings();
    workflow.autostart.mission = false;
    workflow.taskGeneration = workflow.taskGeneration.map((rule) => ({
        ...rule,
        tasks: rule.tasks.map((task) => ({
            ...task,
            agentAdapter: adapter.id
        }))
    }));
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
        agentRegistry: new AgentRegistry({
            agents: [new Agent({
                id: Agent.createEntityId(adapter.id),
                agentId: adapter.id,
                displayName: adapter.displayName,
                icon: 'lucide:bot',
                capabilities: {
                    acceptsPromptSubmission: true,
                    acceptsCommands: true,
                    supportsInterrupt: true,
                    supportsResumeByReference: true,
                    supportsCheckpoint: true
                },
                availability: { available: true }
            }, adapter)]
        })
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