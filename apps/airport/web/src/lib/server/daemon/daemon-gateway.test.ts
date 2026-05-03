import { describe, expect, it } from 'vitest';
import { DaemonGateway } from './daemon-gateway';

type ProjectionGateway = {
    toRuntimeEventEnvelope(event: unknown): unknown;
};

describe('DaemonGateway runtime projection forwarding', () => {
    it('validates and forwards typed child entity projection notifications', () => {
        const gateway = new DaemonGateway() as unknown as ProjectionGateway;

        const envelope = gateway.toRuntimeEventEnvelope({
            type: 'task.data.changed',
            entityId: 'task:mission-29/task-1',
            channel: 'task:mission-29/task-1.data.changed',
            eventName: 'data.changed',
            occurredAt: '2026-04-26T18:00:00.000Z',
            missionEntityId: 'mission:mission-29',
            workspaceRoot: '/repo/root',
            missionId: 'mission-29',
            reference: {
                entity: 'Task',
                missionId: 'mission-29',
                repositoryRootPath: '/repo/root',
                taskId: 'task-1'
            },
            data: {
                id: 'task:mission-29/task-1',
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
            type: 'task.data.changed',
            entityId: 'task:mission-29/task-1',
            channel: 'task:mission-29/task-1.data.changed',
            eventName: 'data.changed',
            missionId: 'mission-29',
            payload: {
                reference: {
                    entity: 'Task',
                    missionId: 'mission-29',
                    taskId: 'task-1'
                },
                data: {
                    taskId: 'task-1',
                    lifecycle: 'completed'
                }
            }
        });
    });

    it('carries daemon-owned entity channel metadata into runtime envelopes', () => {
        const gateway = new DaemonGateway() as unknown as ProjectionGateway;

        const envelope = gateway.toRuntimeEventEnvelope({
            type: 'mission.status',
            entityId: 'mission:mission-29',
            channel: 'mission:mission-29.status',
            eventName: 'status',
            occurredAt: '2026-04-26T18:00:00.000Z',
            missionEntityId: 'mission:mission-29',
            workspaceRoot: '/repo/root',
            missionId: 'mission-29',
            status: {
                missionId: 'mission-29',
                artifacts: []
            }
        });

        expect(envelope).toMatchObject({
            entityId: 'mission:mission-29',
            channel: 'mission:mission-29.status',
            eventName: 'status'
        });
    });
});
