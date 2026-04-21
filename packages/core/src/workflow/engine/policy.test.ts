import { describe, expect, it } from 'vitest';
import {
	createMissionWorkflowConfigurationSnapshot,
	createMissionRuntimeRecord,
	resolvePendingTaskGenerationStageId
} from './index.js';
import { DEFAULT_WORKFLOW_VERSION, createDefaultWorkflowSettings } from '../mission/workflow.js';

describe('resolvePendingTaskGenerationStageId', () => {
	it('allows template-backed generation for an empty blocked eligible stage', () => {
		const workflow = createDefaultWorkflowSettings();
		const configuration = createMissionWorkflowConfigurationSnapshot({
			createdAt: '2026-04-21T18:00:00.000Z',
			workflowVersion: DEFAULT_WORKFLOW_VERSION,
			workflow
		});
		const document = createMissionRuntimeRecord({
			missionId: 'mission-doom',
			configuration,
			createdAt: configuration.createdAt
		});
		document.runtime.lifecycle = 'running';
		document.runtime.activeStageId = 'prd';
		document.runtime.stages = configuration.workflow.stageOrder.map((stageId) => ({
			stageId,
			lifecycle: stageId === 'prd' ? 'blocked' : 'pending',
			taskIds: [],
			readyTaskIds: [],
			queuedTaskIds: [],
			runningTaskIds: [],
			blockedTaskIds: [],
			completedTaskIds: []
		}));

		expect(resolvePendingTaskGenerationStageId(document.runtime, configuration)).toBe('prd');
	});

	it('suppresses artifact-backed generation for an empty blocked eligible stage', () => {
		const workflow = createDefaultWorkflowSettings();
		const configuration = createMissionWorkflowConfigurationSnapshot({
			createdAt: '2026-04-21T18:00:00.000Z',
			workflowVersion: DEFAULT_WORKFLOW_VERSION,
			workflow
		});
		const document = createMissionRuntimeRecord({
			missionId: 'mission-implementation',
			configuration,
			createdAt: configuration.createdAt
		});
		document.runtime.lifecycle = 'running';
		document.runtime.activeStageId = 'implementation';
		document.runtime.stages = configuration.workflow.stageOrder.map((stageId) => ({
			stageId,
			lifecycle: stageId === 'implementation' ? 'blocked' : stageId === 'prd' || stageId === 'spec' ? 'completed' : 'pending',
			taskIds: [],
			readyTaskIds: [],
			queuedTaskIds: [],
			runningTaskIds: [],
			blockedTaskIds: [],
			completedTaskIds: []
		}));
		document.runtime.tasks = [
			{
				taskId: 'prd/01-prd-from-brief',
				stageId: 'prd',
				title: 'Draft PRD',
				instruction: 'Draft the PRD.',
				dependsOn: [],
				lifecycle: 'completed',
				blockedByTaskIds: [],
				runtime: { autostart: true },
				retries: 0,
				createdAt: configuration.createdAt,
				updatedAt: configuration.createdAt,
				completedAt: configuration.createdAt
			},
			{
				taskId: 'spec/01-spec-from-prd',
				stageId: 'spec',
				title: 'Draft Spec',
				instruction: 'Draft the spec.',
				dependsOn: [],
				lifecycle: 'completed',
				blockedByTaskIds: [],
				runtime: { autostart: true },
				retries: 0,
				createdAt: configuration.createdAt,
				updatedAt: configuration.createdAt,
				completedAt: configuration.createdAt
			}
		];

		expect(resolvePendingTaskGenerationStageId(document.runtime, configuration)).toBeUndefined();
	});
});