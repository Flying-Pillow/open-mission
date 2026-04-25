import { describe, expect, it } from 'vitest';
import { createDefaultWorkflowSettings, validateWorkflowSettings } from '../workflow/mission/workflow.js';

describe('workflow settings validation', () => {
	it('reports invalid concurrency values', () => {
		const settings = createDefaultWorkflowSettings();
		settings.execution.maxParallelTasks = 0;
		settings.execution.maxParallelSessions = -1;

		expect(validateWorkflowSettings(settings)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: '/execution/maxParallelTasks' }),
				expect.objectContaining({ path: '/execution/maxParallelSessions' })
			])
		);
	});

	it('reports stage order and stage dictionary mismatches', () => {
		const settings = createDefaultWorkflowSettings();
		settings.stageOrder = ['prd', 'spec', 'audit'];

		const errors = validateWorkflowSettings(settings);
		expect(errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ message: expect.stringContaining("implementation") }),
				expect.objectContaining({ message: expect.stringContaining("delivery") })
			])
		);
	});

	it('reports empty generated task fields and template source fields', () => {
		const settings = createDefaultWorkflowSettings();
		settings.taskGeneration = [
			{
				stageId: 'delivery',
				artifactTasks: false,
				templateSources: [{ templateId: '', path: '' }],
				tasks: [
					{
						taskId: '',
						title: '',
						instruction: '',
						dependsOn: ['']
					}
				]
			}
		];

		expect(validateWorkflowSettings(settings)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: '/taskGeneration/0/templateSources/0/templateId' }),
				expect.objectContaining({ path: '/taskGeneration/0/templateSources/0/path' }),
				expect.objectContaining({ path: '/taskGeneration/0/tasks/0/taskId' }),
				expect.objectContaining({ path: '/taskGeneration/0/tasks/0/title' }),
				expect.objectContaining({ path: '/taskGeneration/0/tasks/0/instruction' }),
				expect.objectContaining({ path: '/taskGeneration/0/tasks/0/dependsOn/0' })
			])
		);
	});
});