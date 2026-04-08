import { describe, expect, it } from 'vitest';
import type { MissionActionDescriptor } from '@flying-pillow/mission-core';
import {
	matchesCommandTargetContext,
	resolveAvailableCommandsForContext,
	type CommandTargetContext
} from './commandTargeting.js';

describe('command targeting', () => {
	it('does not leak other task actions from the same stage into a selected task context', () => {
		const context: CommandTargetContext = {
			stageId: 'implementation',
			taskId: 'implementation/02-workflow-engine',
			sessionId: undefined
		};
		const commands = [
			createCommand({
				id: 'task.done.implementation/02-workflow-engine',
				scope: 'task',
				targetId: 'implementation/02-workflow-engine',
				presentationTargets: [
					{ scope: 'task', targetId: 'implementation/02-workflow-engine' },
					{ scope: 'stage', targetId: 'implementation' }
				]
			}),
			createCommand({
				id: 'task.done.implementation/03-cli-shell',
				scope: 'task',
				targetId: 'implementation/03-cli-shell',
				presentationTargets: [
					{ scope: 'task', targetId: 'implementation/03-cli-shell' },
					{ scope: 'stage', targetId: 'implementation' }
				]
			})
		];

		expect(resolveAvailableCommandsForContext(commands, context).map((command) => command.id)).toEqual([
			'task.done.implementation/02-workflow-engine'
		]);
	});

	it('keeps task actions available when a session node for that task is selected', () => {
		const context: CommandTargetContext = {
			stageId: 'implementation',
			taskId: 'implementation/02-workflow-engine',
			sessionId: 'mission-agent-1234'
		};
		const taskCommand = createCommand({
			id: 'task.done.implementation/02-workflow-engine',
			scope: 'task',
			targetId: 'implementation/02-workflow-engine',
			presentationTargets: [
				{ scope: 'task', targetId: 'implementation/02-workflow-engine' },
				{ scope: 'stage', targetId: 'implementation' }
			]
		});

		expect(matchesCommandTargetContext(taskCommand, context)).toBe(true);
	});

	it('returns both session and task actions when session selection carries a task id', () => {
		const context: CommandTargetContext = {
			stageId: 'implementation',
			taskId: 'implementation/02-workflow-engine',
			sessionId: 'mission-agent-1234'
		};
		const commands = [
			createCommand({
				id: 'session.cancel.mission-agent-1234',
				scope: 'session',
				targetId: 'mission-agent-1234',
				presentationTargets: [{ scope: 'session', targetId: 'mission-agent-1234' }]
			}),
			createCommand({
				id: 'task.done.implementation/02-workflow-engine',
				scope: 'task',
				targetId: 'implementation/02-workflow-engine',
				presentationTargets: [{ scope: 'task', targetId: 'implementation/02-workflow-engine' }]
			})
		];

		expect(resolveAvailableCommandsForContext(commands, context).map((command) => command.id)).toEqual([
			'session.cancel.mission-agent-1234',
			'task.done.implementation/02-workflow-engine'
		]);
	});

	it('keeps stage and mission actions available alongside the selected task actions', () => {
		const context: CommandTargetContext = {
			stageId: 'implementation',
			taskId: 'implementation/02-workflow-engine',
			sessionId: undefined
		};
		const commands = [
			createCommand({
				id: 'generation.tasks.implementation',
				scope: 'generation',
				targetId: 'implementation',
				presentationTargets: [{ scope: 'stage', targetId: 'implementation' }]
			}),
			createCommand({
				id: 'task.launch.implementation/02-workflow-engine',
				scope: 'task',
				targetId: 'implementation/02-workflow-engine',
				presentationTargets: [
					{ scope: 'task', targetId: 'implementation/02-workflow-engine' },
					{ scope: 'stage', targetId: 'implementation' }
				]
			}),
			createCommand({
				id: 'mission.pause',
				scope: 'mission',
				presentationTargets: [
					{ scope: 'mission' },
					{ scope: 'stage', targetId: 'implementation' }
				]
			})
		];

		expect(resolveAvailableCommandsForContext(commands, context).map((command) => command.id)).toEqual([
			'generation.tasks.implementation',
			'task.launch.implementation/02-workflow-engine',
			'mission.pause'
		]);
	});
});

function createCommand(
	overrides: Partial<MissionActionDescriptor> & Pick<MissionActionDescriptor, 'id' | 'scope'>
): MissionActionDescriptor {
	return {
		id: overrides.id,
		label: overrides.label ?? overrides.id,
		action: overrides.action ?? overrides.id,
		scope: overrides.scope,
		...(overrides.targetId ? { targetId: overrides.targetId } : {}),
		disabled: false,
		disabledReason: '',
		enabled: true,
		...(overrides.presentationTargets ? { presentationTargets: overrides.presentationTargets } : {})
	};
}