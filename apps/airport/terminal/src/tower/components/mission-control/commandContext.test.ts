import { describe, expect, it } from 'vitest';
import { resolveMissionSelection, type ContextGraph } from '@flying-pillow/mission-core';
import { resolveOperatorActionContextFromSelection } from './commandContext.js';

describe('resolveOperatorActionContextFromSelection', () => {
	it('returns empty context when no selection is resolved', () => {
		expect(resolveOperatorActionContextFromSelection(undefined)).toEqual({});
	});

	it('projects stage and task ids from resolved selection', () => {
		expect(resolveOperatorActionContextFromSelection({
			missionId: 'mission-13',
			stageId: 'spec',
			taskId: 'task-1'
		})).toEqual({
			stageId: 'spec',
			taskId: 'task-1'
		});
	});

	it('includes active agent session implied by a task selection', () => {
		expect(resolveOperatorActionContextFromSelection({
			missionId: 'mission-13',
			stageId: 'spec',
			taskId: 'task-1',
			activeAgentSessionId: 'session-7'
		})).toEqual({
			stageId: 'spec',
			taskId: 'task-1',
			sessionId: 'session-7'
		});
	});

	it('keeps command context in lockstep across stage, task, artifact, and session targets', () => {
		const domain = createContextGraph();

		const stageSelection = resolveMissionSelection({
			target: {
				kind: 'stage',
				stageId: 'spec'
			},
			domain,
			missionId: 'mission-13'
		});
		expect(resolveOperatorActionContextFromSelection(stageSelection)).toEqual({
			stageId: 'spec'
		});

		const taskSelection = resolveMissionSelection({
			target: {
				kind: 'task',
				taskId: 'task-1',
				stageId: 'spec'
			},
			domain,
			missionId: 'mission-13'
		});
		expect(resolveOperatorActionContextFromSelection(taskSelection)).toEqual({
			stageId: 'spec',
			taskId: 'task-1',
			sessionId: 'session-7'
		});

		const taskArtifactSelection = resolveMissionSelection({
			target: {
				kind: 'task-artifact',
				taskId: 'task-1',
				stageId: 'spec',
				sourcePath: '/tmp/mission-13/02-SPEC/tasks/task-1.md'
			},
			domain,
			missionId: 'mission-13'
		});
		expect(resolveOperatorActionContextFromSelection(taskArtifactSelection)).toEqual({
			stageId: 'spec',
			taskId: 'task-1',
			sessionId: 'session-7'
		});

		const sessionSelection = resolveMissionSelection({
			target: {
				kind: 'session',
				sessionId: 'session-7'
			},
			domain,
			missionId: 'mission-13'
		});
		expect(resolveOperatorActionContextFromSelection(sessionSelection)).toEqual({
			stageId: 'spec',
			taskId: 'task-1',
			sessionId: 'session-7'
		});
	});

	it('drops session-scoped command context immediately when daemon state no longer has the session', () => {
		const withLiveSession = createContextGraph();
		const withoutLiveSession = createContextGraph({ includeSession: false });

		const beforeSelection = resolveMissionSelection({
			target: {
				kind: 'task',
				taskId: 'task-1',
				stageId: 'spec'
			},
			domain: withLiveSession,
			missionId: 'mission-13'
		});
		expect(resolveOperatorActionContextFromSelection(beforeSelection)).toEqual({
			stageId: 'spec',
			taskId: 'task-1',
			sessionId: 'session-7'
		});

		const afterSelection = resolveMissionSelection({
			target: {
				kind: 'task',
				taskId: 'task-1',
				stageId: 'spec'
			},
			domain: withoutLiveSession,
			missionId: 'mission-13'
		});
		expect(resolveOperatorActionContextFromSelection(afterSelection)).toEqual({
			stageId: 'spec',
			taskId: 'task-1'
		});
	});
});

function createContextGraph(options?: { includeSession?: boolean }): ContextGraph {
	const includeSession = options?.includeSession ?? true;
	return {
		selection: {},
		repositories: {},
		missions: {
			'mission-13': {
				missionId: 'mission-13',
				repositoryId: 'repo-1',
				briefSummary: 'Mission 13',
				workspacePath: '/tmp/mission-13',
				taskIds: ['task-1'],
				artifactIds: ['artifact:task-1'],
				sessionIds: includeSession ? ['session-7'] : []
			}
		},
		tasks: {
			'task-1': {
				taskId: 'task-1',
				missionId: 'mission-13',
				stageId: 'spec',
				subject: 'Task 1',
				instructionSummary: 'Draft spec',
				lifecycleState: 'running',
				dependencyIds: [],
				primaryArtifactId: 'artifact:task-1',
				agentSessionIds: includeSession ? ['session-7'] : []
			}
		},
		artifacts: {
			'artifact:task-1': {
				artifactId: 'artifact:task-1',
				missionId: 'mission-13',
				ownerTaskId: 'task-1',
				filePath: '/tmp/mission-13/02-SPEC/tasks/task-1.md',
				logicalKind: 'task-instruction',
				displayLabel: 'task-1.md'
			}
		},
		agentSessions: includeSession
			? {
				'session-7': {
					sessionId: 'session-7',
					missionId: 'mission-13',
					taskId: 'task-1',
					runnerId: 'copilot-cli',
					lifecycleState: 'running',
					lastUpdatedAt: '2026-04-14T10:00:00.000Z'
				}
			}
			: {}
	};
}
