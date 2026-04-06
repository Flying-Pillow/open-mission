import { describe, expect, it } from 'vitest';
import { createDefaultWorkflowSettings } from '../workflow/engine/defaultWorkflow.js';
import { validateWorkflowSettings } from './validation.js';

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
});