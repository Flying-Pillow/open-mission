import { describe, expect, it, vi } from 'vitest';
import type {
    EntityCommandInvocation,
    EntityFormInvocation,
    EntityQueryInvocation,
    EntityRemoteResult
} from '@flying-pillow/mission-core/airport';
import {
    entityCommandInvocationSchema,
    entityFormInvocationSchema,
    entityQueryInvocationSchema,
    executeEntityCommand,
    executeEntityForm,
    executeEntityQuery,
    type EntityRemoteGateway
} from './dispatch';

function createGateway(): EntityRemoteGateway & {
    executeEntityQuery: ReturnType<typeof vi.fn>;
    executeEntityCommand: ReturnType<typeof vi.fn>;
} {
    return {
        executeEntityQuery: vi.fn(async (input: EntityQueryInvocation): Promise<EntityRemoteResult> => ({
            entity: input.entity,
            method: input.method,
            payload: input.payload ?? null
        })),
        executeEntityCommand: vi.fn(async (input: EntityCommandInvocation | EntityFormInvocation): Promise<EntityRemoteResult> => ({
            entity: input.entity,
            method: input.method,
            payload: input.payload ?? null
        }))
    };
}

describe('entity remote invocation schemas', () => {
    it('accepts generic entity triplets without transport-side entity knowledge', () => {
        expect(() =>
            entityQueryInvocationSchema.parse({
                entity: 'Repository',
                method: 'find',
                payload: {}
            })
        ).not.toThrow();

        expect(() =>
            entityCommandInvocationSchema.parse({
                entity: 'Repository',
                method: 'startMissionFromIssue',
                payload: { repositoryId: 'repo-1', issueNumber: 42 }
            })
        ).not.toThrow();

        expect(() =>
            entityFormInvocationSchema.parse({
                entity: 'Repository',
                method: 'startMissionFromBrief',
                payload: { repositoryId: 'repo-1', title: 'Title', body: 'Body', type: 'feature' }
            })
        ).not.toThrow();
    });
});

describe('entity remote dispatch', () => {
    it('forwards queries unchanged', async () => {
        const gateway = createGateway();
        const invocation: EntityQueryInvocation = {
            entity: 'Repository',
            method: 'find',
            payload: {}
        };

        await expect(executeEntityQuery(gateway, invocation)).resolves.toEqual({
            entity: 'Repository',
            method: 'find',
            payload: {}
        });
        expect(gateway.executeEntityQuery).toHaveBeenCalledWith(invocation);
    });

    it('forwards commands unchanged', async () => {
        const gateway = createGateway();
        const invocation: EntityCommandInvocation = {
            entity: 'Repository',
            method: 'startMissionFromIssue',
            payload: { repositoryId: 'repo-1', issueNumber: 42 }
        };

        await expect(executeEntityCommand(gateway, invocation)).resolves.toEqual({
            entity: 'Repository',
            method: 'startMissionFromIssue',
            payload: { repositoryId: 'repo-1', issueNumber: 42 }
        });
        expect(gateway.executeEntityCommand).toHaveBeenCalledWith(invocation);
    });

    it('forwards forms unchanged', async () => {
        const gateway = createGateway();
        const invocation: EntityFormInvocation = {
            entity: 'Repository',
            method: 'startMissionFromBrief',
            payload: { repositoryId: 'repo-1', title: 'Title', body: 'Body', type: 'feature' }
        };

        await expect(executeEntityForm(gateway, invocation)).resolves.toEqual({
            entity: 'Repository',
            method: 'startMissionFromBrief',
            payload: { repositoryId: 'repo-1', title: 'Title', body: 'Body', type: 'feature' }
        });
        expect(gateway.executeEntityCommand).toHaveBeenCalledWith(invocation);
    });
});
