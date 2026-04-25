import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { MissionCommandTransport } from './MissionCommandTransport';

describe('MissionCommandTransport', () => {
    it('throws a zod error when mission control returns a malformed operator status', async () => {
        const transport = new MissionCommandTransport({
            fetch: async () => new Response(JSON.stringify({
                missionRuntime: {
                    missionId: 'mission-29',
                    status: {
                        missionId: 'mission-29',
                        workflow: {
                            stages: []
                        }
                    },
                    sessions: []
                },
                operatorStatus: {
                    found: true,
                    missionId: 'mission-29',
                    title: 'Mission 29',
                    stages: [
                        {
                            stage: 'implementation',
                            folderName: '03-IMPLEMENTATION',
                            status: 'ready',
                            taskCount: 1,
                            completedTaskCount: 0,
                            activeTaskIds: [],
                            readyTaskIds: []
                        }
                    ],
                    workflow: {
                        lifecycle: 'running',
                        pause: {
                            paused: false
                        },
                        panic: {
                            active: false,
                            terminateSessions: true,
                            clearLaunchQueue: true,
                            haltMission: true
                        },
                        configuration: {
                            createdAt: '2026-04-24T00:00:00.000Z',
                            source: 'global-settings',
                            workflowVersion: 'mission-workflow-v1',
                            workflow: {
                                autostart: {
                                    mission: true
                                },
                                humanInLoop: {
                                    enabled: true,
                                    pauseOnMissionStart: false
                                },
                                panic: {
                                    terminateSessions: true,
                                    clearLaunchQueue: true,
                                    haltMission: true
                                },
                                execution: {
                                    maxParallelTasks: 1,
                                    maxParallelSessions: 1
                                },
                                stageOrder: ['implementation'],
                                stages: {
                                    implementation: {
                                        stageId: 'implementation',
                                        displayName: 'Implementation',
                                        taskLaunchPolicy: {
                                            defaultAutostart: false
                                        }
                                    }
                                },
                                taskGeneration: [],
                                gates: []
                            }
                        },
                        stages: [],
                        tasks: [],
                        gates: [],
                        updatedAt: '2026-04-24T00:00:00.000Z'
                    }
                }
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json'
                }
            }) as typeof fetch
        });

        let thrown: unknown;
        try {
            await transport.getMissionControl({ missionId: 'mission-29' });
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(ZodError);
        expect((thrown as ZodError).issues.some((issue) => issue.path.join('.') === 'operatorStatus.stages.0.tasks')).toBe(true);
    });
});