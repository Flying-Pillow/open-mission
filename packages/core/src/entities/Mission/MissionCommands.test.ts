import { describe, expect, it, vi } from 'vitest';
import { Mission } from './Mission.js';
import {
    MissionCommands,
    type MissionRuntimeHandle,
    type MissionRuntimeLoader
} from './MissionCommands.js';

describe('MissionCommands', () => {
    it('rejects invalid payloads before loading a runtime', async () => {
        const loadRuntime = vi.fn<MissionRuntimeLoader>();

        await expect(MissionCommands.read(
            { missionId: 'mission-1', unexpected: true } as never,
            { surfacePath: '/repo', loadRuntime }
        )).rejects.toThrow();

        expect(loadRuntime).not.toHaveBeenCalled();
    });

    it('fails loudly when a mission cannot be resolved', async () => {
        await expect(MissionCommands.read(
            { missionId: 'missing-mission' },
            { surfacePath: '/repo', loadRuntime: async () => undefined }
        )).rejects.toThrow(/missing-mission/u);
    });

    it('fails loudly when source context does not include a surface path', async () => {
        const loadRuntime = vi.fn<MissionRuntimeLoader>();

        await expect(MissionCommands.read(
            { missionId: 'mission-1' },
            { surfacePath: '', loadRuntime }
        )).rejects.toThrow(/surfacePath/u);

        expect(loadRuntime).not.toHaveBeenCalled();
    });

    it('reads Mission snapshots through a loaded runtime and disposes it', async () => {
        const runtime = createRuntimeHandle();

        const snapshot = await MissionCommands.read(
            { missionId: 'mission-1' },
            { surfacePath: '/repo', loadRuntime: async () => runtime }
        );

        expect(snapshot.mission.missionId).toBe('mission-1');
        expect(snapshot.stages).toHaveLength(1);
        expect(snapshot.tasks).toHaveLength(1);
        expect(snapshot.status?.missionId).toBe('mission-1');
        expect(runtime.dispose).toHaveBeenCalledTimes(1);
    });

    it('disposes the runtime when result parsing fails', async () => {
        const runtime = createRuntimeHandle({
            toEntity: vi.fn(async () => ({
                toSnapshot: () => ({
                    missionId: '',
                    artifacts: [],
                    stages: [],
                    agentSessions: []
                })
            } as unknown as Mission))
        });

        await expect(MissionCommands.read(
            { missionId: 'mission-1' },
            { surfacePath: '/repo', loadRuntime: async () => runtime }
        )).rejects.toThrow();

        expect(runtime.dispose).toHaveBeenCalledTimes(1);
    });

    it('returns source acknowledgements for Mission commands instead of projection snapshots', async () => {
        const runtime = createRuntimeHandle();

        const acknowledgement = await MissionCommands.command(
            { missionId: 'mission-1', command: { action: 'pause' } },
            { surfacePath: '/repo', loadRuntime: async () => runtime }
        );

        expect(runtime.pauseMission).toHaveBeenCalledTimes(1);
        expect(runtime.dispose).toHaveBeenCalledTimes(1);
        expect(acknowledgement).toEqual({
            ok: true,
            entity: 'Mission',
            method: 'command',
            id: 'mission-1',
            missionId: 'mission-1'
        });
        expect('workflow' in acknowledgement).toBe(false);
        expect('sessions' in acknowledgement).toBe(false);
        expect('status' in acknowledgement).toBe(false);
    });

    it('passes task launch terminal names into runtime loading and returns task acknowledgements', async () => {
        const runtime = createRuntimeHandle();
        const loadRuntime = vi.fn<MissionRuntimeLoader>(async () => runtime);

        const acknowledgement = await MissionCommands.taskCommand(
            {
                missionId: 'mission-1',
                taskId: 'implementation/01-task',
                command: { action: 'start', terminalSessionName: 'mission-task-terminal' }
            },
            { surfacePath: '/repo', loadRuntime }
        );

        expect(loadRuntime).toHaveBeenCalledWith(
            { missionId: 'mission-1', taskId: 'implementation/01-task', command: { action: 'start', terminalSessionName: 'mission-task-terminal' } },
            expect.objectContaining({ surfacePath: '/repo' }),
            'mission-task-terminal'
        );
        expect(runtime.startTask).toHaveBeenCalledWith(
            'implementation/01-task',
            { terminalSessionName: 'mission-task-terminal' }
        );
        expect(acknowledgement).toEqual({
            ok: true,
            entity: 'Mission',
            method: 'taskCommand',
            id: 'mission-1',
            missionId: 'mission-1',
            taskId: 'implementation/01-task'
        });
    });

    it('normalizes session prompts and returns session acknowledgements without projections', async () => {
        const runtime = createRuntimeHandle();

        const acknowledgement = await MissionCommands.sessionCommand(
            {
                missionId: 'mission-1',
                sessionId: 'session-1',
                command: {
                    action: 'prompt',
                    prompt: {
                        source: 'operator',
                        text: 'Continue carefully.',
                        title: 'Nudge',
                        metadata: { urgency: 'normal' }
                    }
                }
            },
            { surfacePath: '/repo', loadRuntime: async () => runtime }
        );

        expect(runtime.sendAgentSessionPrompt).toHaveBeenCalledWith('session-1', {
            source: 'operator',
            text: 'Continue carefully.',
            title: 'Nudge',
            metadata: { urgency: 'normal' }
        });
        expect(runtime.dispose).toHaveBeenCalledTimes(1);
        expect(acknowledgement).toEqual({
            ok: true,
            entity: 'Mission',
            method: 'sessionCommand',
            id: 'mission-1',
            missionId: 'mission-1',
            sessionId: 'session-1'
        });
        expect('workflow' in acknowledgement).toBe(false);
        expect('sessions' in acknowledgement).toBe(false);
        expect('status' in acknowledgement).toBe(false);
    });

    it('executes workflow actions with parsed payloads and returns action acknowledgements', async () => {
        const runtime = createRuntimeHandle();
        const loadRuntime = vi.fn<MissionRuntimeLoader>(async () => runtime);

        const acknowledgement = await MissionCommands.executeAction(
            {
                missionId: 'mission-1',
                actionId: 'select-branch',
                steps: [
                    { kind: 'selection', stepId: 'branch', optionIds: ['main'] },
                    { kind: 'text', stepId: 'summary', value: 'Use main.' }
                ],
                terminalSessionName: 'mission-action-terminal'
            },
            { surfacePath: '/repo', loadRuntime }
        );

        expect(loadRuntime).toHaveBeenCalledWith(
            expect.objectContaining({ missionId: 'mission-1', actionId: 'select-branch' }),
            expect.objectContaining({ surfacePath: '/repo' }),
            'mission-action-terminal'
        );
        expect(runtime.executeAction).toHaveBeenCalledWith(
            'select-branch',
            [
                { kind: 'selection', stepId: 'branch', optionIds: ['main'] },
                { kind: 'text', stepId: 'summary', value: 'Use main.' }
            ],
            { terminalSessionName: 'mission-action-terminal' }
        );
        expect(runtime.dispose).toHaveBeenCalledTimes(1);
        expect(acknowledgement).toEqual({
            ok: true,
            entity: 'Mission',
            method: 'executeAction',
            id: 'mission-1',
            missionId: 'mission-1',
            actionId: 'select-branch'
        });
    });
});

function createRuntimeHandle(overrides: Partial<MissionRuntimeHandle> = {}): MissionRuntimeHandle {
    return {
        clearMissionPanic: vi.fn(async () => undefined),
        completeAgentSession: vi.fn(async () => createSessionRecord()),
        completeTask: vi.fn(async () => undefined),
        dispose: vi.fn(() => undefined),
        executeAction: vi.fn(async () => ({ found: true, missionId: 'mission-1' })),
        cancelAgentSession: vi.fn(async () => createSessionRecord()),
        deliver: vi.fn(async () => ({
            id: 'mission-1',
            brief: { title: 'Mission One', body: 'Mission body.', type: 'task' as const },
            missionDir: '/repo/.mission/missions/mission-1',
            missionRootDir: '/repo/.mission/missions/mission-1',
            branchRef: 'main',
            createdAt: '2026-04-26T13:00:00.000Z',
            stage: 'implementation' as const,
            agentSessions: []
        })),
        panicStopMission: vi.fn(async () => undefined),
        pauseMission: vi.fn(async () => undefined),
        listAvailableActionsSnapshot: vi.fn(async () => ({
            actions: [],
            revision: 'mission-1:actions'
        })),
        reopenTask: vi.fn(async () => undefined),
        restartLaunchQueue: vi.fn(async () => undefined),
        resumeMission: vi.fn(async () => undefined),
        sendAgentSessionCommand: vi.fn(async () => createSessionRecord()),
        sendAgentSessionPrompt: vi.fn(async () => createSessionRecord()),
        startTask: vi.fn(async () => undefined),
        terminateAgentSession: vi.fn(async () => createSessionRecord()),
        toEntity: vi.fn(async () => createMissionEntity()),
        ...overrides
    };
}

function createMissionEntity(): Mission {
    return new Mission({
        missionId: 'mission-1',
        title: 'Mission One',
        type: 'task',
        lifecycle: 'running',
        currentStageId: 'implementation',
        updatedAt: '2026-04-26T13:00:00.000Z',
        artifacts: [],
        stages: [
            {
                stageId: 'implementation',
                lifecycle: 'active',
                isCurrentStage: true,
                artifacts: [],
                tasks: [
                    {
                        taskId: 'implementation/01-task',
                        stageId: 'implementation',
                        sequence: 1,
                        title: 'Implement Task',
                        instruction: 'Do the work.',
                        lifecycle: 'ready',
                        dependsOn: [],
                        waitingOnTaskIds: [],
                        agentRunner: 'copilot-cli',
                        retries: 0
                    }
                ]
            }
        ],
        agentSessions: [],
        recommendedAction: 'Start the task.'
    });
}

function createSessionRecord() {
    return {
        sessionId: 'session-1',
        runnerId: 'copilot-cli',
        runnerLabel: 'Copilot CLI',
        lifecycleState: 'running' as const,
        createdAt: '2026-04-26T13:00:00.000Z',
        lastUpdatedAt: '2026-04-26T13:00:00.000Z'
    };
}
