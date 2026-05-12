import { describe, expect, it } from 'vitest';
import {
	createWorkflowConfigurationSnapshot,
	createWorkflowStateData,
	resolvePendingTaskGenerationStageId
} from './index.js';
import { DEFAULT_WORKFLOW_VERSION, createDefaultWorkflowSettings } from '../mission/workflow.js';

describe('resolvePendingTaskGenerationStageId', () => {
	it('allows template-backed generation for an empty eligible stage', () => {
		const workflow = createDefaultWorkflowSettings();
		const configuration = createWorkflowConfigurationSnapshot({
			createdAt: '2026-04-21T18:00:00.000Z',
			workflowVersion: DEFAULT_WORKFLOW_VERSION,
			workflow
		});
		const document = createWorkflowStateData({
			missionId: 'mission-doom',
			configuration,
			createdAt: configuration.createdAt
		});
		document.runtime.lifecycle = 'running';
		document.runtime.activeStageId = 'prd';
		document.runtime.stages = configuration.workflow.stageOrder.map((stageId) => ({
			stageId,
			lifecycle: stageId === 'prd' ? 'ready' : 'pending',
			taskIds: [],
			readyTaskIds: [],
			queuedTaskIds: [],
			runningTaskIds: [],
			completedTaskIds: []
		}));

		expect(resolvePendingTaskGenerationStageId(document.runtime, configuration)).toBe('prd');
	});

	it('allows artifact-backed generation for an empty eligible stage', () => {
		const workflow = createDefaultWorkflowSettings();
		const configuration = createWorkflowConfigurationSnapshot({
			createdAt: '2026-04-21T18:00:00.000Z',
			workflowVersion: DEFAULT_WORKFLOW_VERSION,
			workflow
		});
		const document = createWorkflowStateData({
			missionId: 'mission-implementation',
			configuration,
			createdAt: configuration.createdAt
		});
		document.runtime.lifecycle = 'running';
		document.runtime.activeStageId = 'implementation';
		document.runtime.stages = configuration.workflow.stageOrder.map((stageId) => ({
			stageId,
			lifecycle: stageId === 'implementation' ? 'ready' : stageId === 'prd' || stageId === 'spec' ? 'completed' : 'pending',
			taskIds: [],
			readyTaskIds: [],
			queuedTaskIds: [],
			runningTaskIds: [],
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
				waitingOnTaskIds: [],
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
				waitingOnTaskIds: [],
				runtime: { autostart: true },
				retries: 0,
				createdAt: configuration.createdAt,
				updatedAt: configuration.createdAt,
				completedAt: configuration.createdAt
			}
		];

		expect(resolvePendingTaskGenerationStageId(document.runtime, configuration)).toBe('implementation');
	});
});