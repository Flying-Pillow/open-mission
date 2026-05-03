import { describe, expect, it } from 'vitest';
import { orderAvailableActions, resolveAvailableActionsForTargetContext } from './operatorActionTargeting.js';
import type { OperatorActionDescriptor } from '../types.js';

describe('orderAvailableActions', () => {
	it('prioritizes enabled recovery actions before closer contextual actions', () => {
		const actions: OperatorActionDescriptor[] = [
			createAction({
				id: 'session.cancel.s1',
				action: '/session cancel',
				scope: 'session',
				targetId: 's1',
				presentationTargets: [{ scope: 'session', targetId: 's1' }]
			}),
			createAction({
				id: 'mission.resume',
				action: '/mission resume',
				scope: 'mission',
				ordering: { group: 'recovery' },
				presentationTargets: [{ scope: 'mission' }]
			}),
			createAction({
				id: 'task.start.t1',
				action: '/task start',
				scope: 'task',
				targetId: 't1',
				presentationTargets: [{ scope: 'task', targetId: 't1' }]
			})
		];

		const ordered = orderAvailableActions(actions, { sessionId: 's1', taskId: 't1', stageId: 'prd' });

		expect(ordered.map((action) => action.id)).toEqual([
			'mission.resume',
			'session.cancel.s1',
			'task.start.t1'
		]);
	});

	it('orders non-recovery actions from closest target outward', () => {
		const actions: OperatorActionDescriptor[] = [
			createAction({
				id: 'mission.pause',
				action: '/mission pause',
				scope: 'mission',
				presentationTargets: [{ scope: 'mission' }]
			}),
			createAction({
				id: 'stage.generate',
				action: '/generate',
				scope: 'generation',
				targetId: 'prd',
				presentationTargets: [{ scope: 'stage', targetId: 'prd' }]
			}),
			createAction({
				id: 'task.start.t1',
				action: '/task start',
				scope: 'task',
				targetId: 't1',
				presentationTargets: [{ scope: 'task', targetId: 't1' }]
			}),
			createAction({
				id: 'session.cancel.s1',
				action: '/session cancel',
				scope: 'session',
				targetId: 's1',
				presentationTargets: [{ scope: 'session', targetId: 's1' }]
			})
		];

		const ordered = orderAvailableActions(actions, { sessionId: 's1', taskId: 't1', stageId: 'prd' });

		expect(ordered.map((action) => action.id)).toEqual([
			'session.cancel.s1',
			'task.start.t1',
			'stage.generate',
			'mission.pause'
		]);
	});

	it('prioritizes artifact actions between session and task when artifact context is present', () => {
		const actions: OperatorActionDescriptor[] = [
			createAction({
				id: 'task.start.t1',
				action: '/task start',
				scope: 'task',
				targetId: 't1',
				presentationTargets: [{ scope: 'task', targetId: 't1' }]
			}),
			createAction({
				id: 'artifact.publish.instructions',
				action: '/artifact publish',
				scope: 'artifact',
				targetId: '/mission/tasks/t1.md',
				presentationTargets: [{ scope: 'artifact', targetId: '/mission/tasks/t1.md' }]
			}),
			createAction({
				id: 'session.cancel.s1',
				action: '/session cancel',
				scope: 'session',
				targetId: 's1',
				presentationTargets: [{ scope: 'session', targetId: 's1' }]
			})
		];

		const ordered = orderAvailableActions(actions, {
			sessionId: 's1',
			artifactPath: '/mission/tasks/t1.md',
			taskId: 't1'
		});

		expect(ordered.map((action) => action.id)).toEqual([
			'session.cancel.s1',
			'artifact.publish.instructions',
			'task.start.t1'
		]);
	});

	it('excludes repository-targeted actions when no repository is selected', () => {
		const actions: OperatorActionDescriptor[] = [
			createAction({
				id: 'control.setup.edit',
				action: '/setup',
				scope: 'mission',
				presentationTargets: [{ scope: 'repository', targetId: '/repo/a' }]
			}),
			createAction({
				id: 'mission.pause',
				action: '/mission pause',
				scope: 'mission',
				presentationTargets: [{ scope: 'mission' }]
			})
		];

		expect(resolveAvailableActionsForTargetContext(actions, {})).toEqual([
			expect.objectContaining({ id: 'mission.pause' })
		]);
		expect(resolveAvailableActionsForTargetContext(actions, { repositoryId: '/repo/a' })).toEqual([
			expect.objectContaining({ id: 'control.setup.edit' }),
			expect.objectContaining({ id: 'mission.pause' })
		]);
	});

	it('filters artifact-scoped actions by artifact path', () => {
		const actions: OperatorActionDescriptor[] = [
			createAction({
				id: 'artifact.publish.instructions',
				action: '/artifact publish',
				scope: 'artifact',
				targetId: '/mission/tasks/t1.md',
				presentationTargets: [{ scope: 'artifact', targetId: '/mission/tasks/t1.md' }]
			}),
			createAction({
				id: 'mission.pause',
				action: '/mission pause',
				scope: 'mission',
				presentationTargets: [{ scope: 'mission' }]
			})
		];

		expect(resolveAvailableActionsForTargetContext(actions, { artifactPath: '/mission/tasks/t1.md' })).toEqual([
			expect.objectContaining({ id: 'artifact.publish.instructions' }),
			expect.objectContaining({ id: 'mission.pause' })
		]);
		expect(resolveAvailableActionsForTargetContext(actions, { artifactPath: '/mission/tasks/other.md' })).toEqual([
			expect.objectContaining({ id: 'mission.pause' })
		]);
	});
});

function createAction(overrides: Partial<OperatorActionDescriptor> & Pick<OperatorActionDescriptor, 'id' | 'action' | 'scope'>): OperatorActionDescriptor {
	return {
		label: overrides.id,
		disabled: false,
		disabledReason: '',
		enabled: true,
		...overrides
	};
}