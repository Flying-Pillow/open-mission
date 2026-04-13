import { describe, expect, it } from 'vitest';
import { resolvePanelBindingsFromTreeTarget } from './tower/components/mission-control/panelBindings.js';

describe('resolvePanelBindingsFromTreeTarget', () => {
	it('clears the runway when a mission-level target is selected', () => {
		expect(resolvePanelBindingsFromTreeTarget(undefined, 'mission-13')).toEqual({
			briefingRoom: {
				targetKind: 'mission',
				targetId: 'mission-13',
				mode: 'view'
			}
		});
	});

	it('clears the runway when an artifact target is selected', () => {
		expect(resolvePanelBindingsFromTreeTarget({
			kind: 'task-artifact',
			sourcePath: '/tmp/mission-13/BRIEF.md'
		}, 'mission-13')).toEqual({
			briefingRoom: {
				targetKind: 'artifact',
				targetId: '/tmp/mission-13/BRIEF.md',
				mode: 'view'
			}
		});
	});

	it('does not bind briefing room for session targets without a mission target', () => {
		expect(resolvePanelBindingsFromTreeTarget({
			kind: 'session'
		}, undefined)).toBeUndefined();
	});
});