import { describe, expect, it } from 'vitest';
import { orderAvailableActions } from './operatorActionTargeting.js';
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
				id: 'task.launch.t1',
				action: '/launch',
				scope: 'task',
				targetId: 't1',
				presentationTargets: [{ scope: 'task', targetId: 't1' }]
			})
		];

		const ordered = orderAvailableActions(actions, { sessionId: 's1', taskId: 't1', stageId: 'prd' });

		expect(ordered.map((action) => action.id)).toEqual([
			'mission.resume',
			'session.cancel.s1',
			'task.launch.t1'
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
				id: 'task.launch.t1',
				action: '/launch',
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
			'task.launch.t1',
			'stage.generate',
			'mission.pause'
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