import { describe, expect, it } from 'vitest';
import { resolvePanelBindingsFromSelection } from './tower/components/mission-control/panelBindings.js';

describe('resolvePanelBindingsFromSelection', () => {
	it('binds mission-level briefing room target and keeps runway empty', () => {
		expect(resolvePanelBindingsFromSelection(undefined, 'mission-13')).toEqual({
			briefingRoom: {
				targetKind: 'mission',
				targetId: 'mission-13',
				mode: 'view'
			},
			runway: {
				targetKind: 'empty'
			}
		});
	});

	it('binds the resolved task instruction artifact into Briefing Room', () => {
		expect(resolvePanelBindingsFromSelection({
			missionId: 'mission-13',
			taskId: 'task-1',
			activeInstructionArtifactId: 'mission-13:task:task-1',
			activeInstructionPath: '/tmp/mission-13/01-PRD/tasks/01-prd-from-brief.md'
		}, 'mission-13')).toEqual({
			briefingRoom: {
				targetKind: 'artifact',
				targetId: 'mission-13:task:task-1',
				mode: 'view'
			},
			runway: {
				targetKind: 'empty'
			}
		});
	});

	it('binds the resolved stage result artifact into Briefing Room', () => {
		expect(resolvePanelBindingsFromSelection({
			missionId: 'mission-13',
			stageId: 'spec',
			activeStageResultArtifactId: 'mission-13:spec',
			activeStageResultPath: '/tmp/mission-13/02-SPEC/SPEC.md'
		}, 'mission-13')).toEqual({
			briefingRoom: {
				targetKind: 'artifact',
				targetId: 'mission-13:spec',
				mode: 'view'
			},
			runway: {
				targetKind: 'empty'
			}
		});
	});

	it('binds runway to the selected active agent session', () => {
		expect(resolvePanelBindingsFromSelection({
			missionId: 'mission-13',
			activeAgentSessionId: 'session-7'
		}, 'mission-13')).toEqual({
			briefingRoom: {
				targetKind: 'mission',
				targetId: 'mission-13',
				mode: 'view'
			},
			runway: {
				targetKind: 'agentSession',
				targetId: 'session-7',
				mode: 'view'
			}
		});
	});

	it('does not bind briefing room for a selection without a resolved artifact or mission target', () => {
		expect(resolvePanelBindingsFromSelection({
			activeAgentSessionId: 'session-7'
		}, undefined)).toBeUndefined();
	});
});