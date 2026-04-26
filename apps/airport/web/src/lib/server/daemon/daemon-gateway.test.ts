import { describe, expect, it } from 'vitest';
import { DaemonGateway } from './daemon-gateway';

type ProjectionGateway = {
    toRuntimeEventEnvelope(event: unknown): unknown;
    shouldForwardRuntimeEvent(event: unknown): boolean;
};

describe('DaemonGateway runtime projection forwarding', () => {
    it('validates and forwards typed child entity projection notifications', () => {
        const gateway = new DaemonGateway() as unknown as ProjectionGateway;

        const envelope = gateway.toRuntimeEventEnvelope({
            type: 'task.snapshot.changed',
            workspaceRoot: '/repo/root',
            missionId: 'mission-29',
            reference: {
                entity: 'Task',
                missionId: 'mission-29',
                repositoryRootPath: '/repo/root',
                taskId: 'task-1'
            },
            snapshot: {
                taskId: 'task-1',
                stageId: 'implementation',
                sequence: 1,
                title: 'Task One',
                instruction: 'Do the work.',
                lifecycle: 'completed',
                dependsOn: [],
                waitingOnTaskIds: [],
                agentRunner: 'copilot-cli',
                retries: 0
            }
        });

        expect(envelope).toMatchObject({
            type: 'task.snapshot.changed',
            missionId: 'mission-29',
            payload: {
                reference: {
                    entity: 'Task',
                    missionId: 'mission-29',
                    taskId: 'task-1'
                },
                snapshot: {
                    taskId: 'task-1',
                    lifecycle: 'completed'
                }
            }
        });
    });

    it('keeps terminal stream notifications out of projection forwarding', () => {
        const gateway = new DaemonGateway() as unknown as ProjectionGateway;

        expect(gateway.shouldForwardRuntimeEvent({
            type: 'session.terminal',
            missionId: 'mission-29',
            sessionId: 'session-1',
            state: {
                sessionId: 'session-1',
                connected: true,
                dead: false,
                exitCode: null,
                screen: 'stream data'
            }
        })).toBe(false);
    });
});
