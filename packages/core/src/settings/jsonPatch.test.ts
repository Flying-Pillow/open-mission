import { describe, expect, it } from 'vitest';
import { createDefaultWorkflowSettings } from '../workflow/engine/defaultWorkflow.js';
import { applyWorkflowSettingsPatch, validateWorkflowSettingsPatch } from './jsonPatch.js';

describe('workflow settings json patch', () => {
	it('applies replace and remove operations on allowed paths', () => {
		const current = createDefaultWorkflowSettings();
		const next = applyWorkflowSettingsPatch(current, [
			{
				op: 'replace',
				path: '/stageOrder',
				value: ['prd', 'implementation', 'spec', 'audit', 'delivery']
			},
			{
				op: 'remove',
				path: '/gates/1'
			}
		]);

		expect(next.stageOrder).toEqual(['prd', 'implementation', 'spec', 'audit', 'delivery']);
		expect(next.gates).toHaveLength(current.gates.length - 1);
		expect(current.stageOrder).toEqual(['prd', 'spec', 'implementation', 'audit', 'delivery']);
	});

	it('rejects unsupported operations and forbidden paths', () => {
		expect(() =>
			validateWorkflowSettingsPatch([
				{ op: 'replace', path: '/__proto__/polluted', value: true }
			])
		).toThrow(/not allowed for workflow settings/u);

		expect(() =>
			validateWorkflowSettingsPatch([
				{ op: 'move' as 'replace', path: '/stageOrder/0' }
			])
		).toThrow(/Unsupported patch operation/u);
	});
});