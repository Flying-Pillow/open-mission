import { describe, expect, it } from 'vitest';
import type { ContextGraph } from '../types.js';
import { resolveMissionSelection, resolveMissionSelectionFromContext } from './resolveMissionSelection.js';

describe('resolveMissionSelection', () => {
	it('resolves task selection to the canonical instruction artifact and most recent session', () => {
		const domain = createDomain();

		const resolved = resolveMissionSelection({
			target: {
				kind: 'task',
				taskId: 'task-1',
				stageId: 'prd'
			},
			domain,
			missionId: 'mission-1'
		});

		expect(resolved).toEqual({
			missionId: 'mission-1',
			stageId: 'prd',
			taskId: 'task-1',
			activeInstructionArtifactId: 'mission-1:task:task-1',
			activeInstructionPath: '/repo/.mission/missions/mission-1/01-PRD/tasks/01-prd-from-brief.md',
			activeAgentSessionId: 'session-new'
		});
	});

	it('keeps explicit session selection while retaining the owning task instruction', () => {
		const domain = createDomain();

		const resolved = resolveMissionSelection({
			target: {
				kind: 'session',
				sessionId: 'session-old'
			},
			domain,
			missionId: 'mission-1'
		});

		expect(resolved).toEqual({
			missionId: 'mission-1',
			stageId: 'prd',
			taskId: 'task-1',
			activeInstructionArtifactId: 'mission-1:task:task-1',
			activeInstructionPath: '/repo/.mission/missions/mission-1/01-PRD/tasks/01-prd-from-brief.md',
			activeAgentSessionId: 'session-old'
		});
	});

	it('resolves stage selection to the canonical stage result artifact', () => {
		const domain = createDomain();

		const resolved = resolveMissionSelection({
			target: {
				kind: 'stage',
				stageId: 'spec'
			},
			domain,
			missionId: 'mission-1'
		});

		expect(resolved).toEqual({
			missionId: 'mission-1',
			stageId: 'spec',
			activeStageResultArtifactId: 'mission-1:spec',
			activeStageResultPath: '/repo/.mission/missions/mission-1/02-SPEC/SPEC.md'
		});
	});

	it('resolves mission artifact selection to the mission brief', () => {
		const domain = createDomain();

		const resolved = resolveMissionSelection({
			target: {
				kind: 'mission-artifact',
				sourcePath: '/repo/.mission/missions/mission-1/BRIEF.md'
			},
			domain,
			missionId: 'mission-1'
		});

		expect(resolved).toEqual({
			missionId: 'mission-1',
			activeMissionArtifactId: 'mission-1:brief',
			activeMissionArtifactPath: '/repo/.mission/missions/mission-1/BRIEF.md'
		});
	});

	it('resolves daemon context selection through the same companion rules', () => {
		const domain = createDomain();

		const resolved = resolveMissionSelectionFromContext({
			selection: {
				missionId: 'mission-1',
				taskId: 'task-1',
				stageId: 'prd'
			},
			domain
		});

		expect(resolved?.activeInstructionArtifactId).toBe('mission-1:task:task-1');
		expect(resolved?.activeAgentSessionId).toBe('session-new');
	});

	it('prioritizes an explicitly selected artifact over a concurrently selected session', () => {
		const domain = createDomain();

		const resolved = resolveMissionSelectionFromContext({
			selection: {
				missionId: 'mission-1',
				stageId: 'prd',
				taskId: 'task-1',
				agentSessionId: 'session-old',
				artifactId: 'mission-1:task:task-1:alternate'
			},
			domain
		});

		expect(resolved?.activeInstructionArtifactId).toBe('mission-1:task:task-1:alternate');
		expect(resolved?.activeInstructionPath).toBe('/repo/.mission/missions/mission-1/01-PRD/tasks/02-prd-appendix.md');
	});
});

function createDomain(): ContextGraph {
	return {
		selection: {},
		repositories: {
			repo: {
				repositoryId: 'repo',
				rootPath: '/repo',
				displayLabel: 'repo',
				missionIds: ['mission-1']
			}
		},
		missions: {
			'mission-1': {
				missionId: 'mission-1',
				repositoryId: 'repo',
				briefSummary: 'Mission 1',
				workspacePath: '/repo/.mission/missions/mission-1',
				taskIds: ['task-1'],
				artifactIds: ['mission-1:brief', 'mission-1:prd', 'mission-1:spec', 'mission-1:task:task-1'],
				sessionIds: ['session-old', 'session-new']
			}
		},
		tasks: {
			'task-1': {
				taskId: 'task-1',
				missionId: 'mission-1',
				stageId: 'prd',
				subject: 'Draft PRD',
				instructionSummary: 'Create the PRD from the brief.',
				lifecycleState: 'running',
				dependencyIds: [],
				primaryArtifactId: 'mission-1:task:task-1',
				agentSessionIds: ['session-old', 'session-new']
			}
		},
		artifacts: {
			'mission-1:brief': {
				artifactId: 'mission-1:brief',
				missionId: 'mission-1',
				filePath: '/repo/.mission/missions/mission-1/BRIEF.md',
				logicalKind: 'brief',
				displayLabel: 'BRIEF.md'
			},
			'mission-1:prd': {
				artifactId: 'mission-1:prd',
				missionId: 'mission-1',
				filePath: '/repo/.mission/missions/mission-1/01-PRD/PRD.md',
				logicalKind: 'prd',
				displayLabel: 'PRD.md'
			},
			'mission-1:spec': {
				artifactId: 'mission-1:spec',
				missionId: 'mission-1',
				filePath: '/repo/.mission/missions/mission-1/02-SPEC/SPEC.md',
				logicalKind: 'spec',
				displayLabel: 'SPEC.md'
			},
			'mission-1:task:task-1': {
				artifactId: 'mission-1:task:task-1',
				missionId: 'mission-1',
				ownerTaskId: 'task-1',
				filePath: '/repo/.mission/missions/mission-1/01-PRD/tasks/01-prd-from-brief.md',
				logicalKind: 'task-instruction',
				displayLabel: '01-prd-from-brief.md'
			},
			'mission-1:task:task-1:alternate': {
				artifactId: 'mission-1:task:task-1:alternate',
				missionId: 'mission-1',
				ownerTaskId: 'task-1',
				filePath: '/repo/.mission/missions/mission-1/01-PRD/tasks/02-prd-appendix.md',
				logicalKind: 'task-instruction',
				displayLabel: '02-prd-appendix.md'
			}
		},
		agentSessions: {
			'session-old': {
				sessionId: 'session-old',
				missionId: 'mission-1',
				taskId: 'task-1',
				runnerId: 'copilot-cli',
				lifecycleState: 'running',
				createdAt: '2026-04-13T09:00:00.000Z',
				lastUpdatedAt: '2026-04-13T09:30:00.000Z'
			},
			'session-new': {
				sessionId: 'session-new',
				missionId: 'mission-1',
				taskId: 'task-1',
				runnerId: 'copilot-cli',
				lifecycleState: 'awaiting-input',
				createdAt: '2026-04-13T10:00:00.000Z',
				lastUpdatedAt: '2026-04-13T10:30:00.000Z'
			}
		}
	};
}