import { describe, expect, it } from 'vitest';
import { buildProjectedSessionRecords } from './missionControlDomain.js';
import type { ContextGraph } from '@flying-pillow/mission-core';

describe('buildProjectedSessionRecords', () => {
	it('preserves terminal attachment metadata for the selected runway session', () => {
		const domain: ContextGraph = {
			selection: {},
			repositories: {},
			missions: {},
			tasks: {
				'task-1': {
					taskId: 'task-1',
					stageId: 'spec',
					subject: 'Plan task',
					instructionSummary: 'Plan task',
					lifecycleState: 'running',
					dependencyIds: []
				}
			},
			artifacts: {},
			agentSessions: {
				'session-1': {
					sessionId: 'session-1',
					taskId: 'task-1',
					runnerId: 'copilot',
					lifecycleState: 'running',
					transportId: 'terminal',
					terminalSessionName: 'mission-agent-session-1',
					terminalPaneId: 'terminal_7'
				}
			}
		};

		expect(buildProjectedSessionRecords(domain)).toEqual([
			{
				sessionId: 'session-1',
				runnerId: 'copilot',
				runnerLabel: 'copilot',
				lifecycleState: 'running',
				taskId: 'task-1',
				assignmentLabel: 'Plan task',
				transportId: 'terminal',
				terminalSessionName: 'mission-agent-session-1',
				terminalPaneId: 'terminal_7',
				createdAt: '',
				lastUpdatedAt: ''
			}
		]);
	});
});