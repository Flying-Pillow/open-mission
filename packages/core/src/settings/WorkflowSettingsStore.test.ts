import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getWorkflowSettingsDocumentPath } from '../lib/daemonConfig.js';
import { getMissionWorkflowDefinitionPath } from '../lib/repoConfig.js';
import { WorkflowSettingsStore } from './WorkflowSettingsStore.js';

describe('WorkflowSettingsStore', () => {
	it('initializes settings when the file is missing', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-settings-store-'));

		try {
			const store = new WorkflowSettingsStore(workspaceRoot);
			const initialized = await store.initialize();
			const settingsPath = getWorkflowSettingsDocumentPath(workspaceRoot);
			const workflowPath = getMissionWorkflowDefinitionPath(workspaceRoot);
			const content = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as {
				workflow?: { stageOrder?: unknown };
				runtime?: { agentRunner?: unknown };
				integration?: { trackingProvider?: unknown };
				paths?: { missionWorkspaceRoot?: unknown };
			};
			const persistedWorkflow = JSON.parse(await fs.readFile(workflowPath, 'utf8')) as {
				workflow?: { stageOrder?: unknown };
			};

			expect(initialized.metadata.initialized).toBe(true);
			expect(initialized.metadata.sourcePath).toBe(workflowPath);
			expect(initialized.workflow.stageOrder).toEqual(['prd', 'spec', 'implementation', 'audit', 'delivery']);
			expect(content.runtime?.agentRunner).toBe('copilot-cli');
			expect(content.integration?.trackingProvider).toBe('github');
			expect(content.paths?.missionWorkspaceRoot).toBe('missions');
			expect(content.workflow?.stageOrder).toEqual(['prd', 'spec', 'implementation', 'audit', 'delivery']);
			expect(persistedWorkflow.workflow?.stageOrder).toEqual(['prd', 'spec', 'implementation', 'audit', 'delivery']);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('applies updates and rejects stale revisions after out-of-band edits', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-settings-store-'));

		try {
			const store = new WorkflowSettingsStore(workspaceRoot);
			const initial = await store.initialize();
			const updated = await store.update({
				expectedRevision: initial.revision,
				patch: [
					{
						op: 'replace',
						path: '/execution/maxParallelTasks',
						value: 2
					}
				],
				context: {
					requestedBySurface: 'test',
					requestedBy: 'vitest'
				}
			});

			expect(updated.workflow.execution.maxParallelTasks).toBe(2);

			const workflowPath = getMissionWorkflowDefinitionPath(workspaceRoot);
			const rawWorkflow = JSON.parse(await fs.readFile(workflowPath, 'utf8')) as Record<string, unknown>;
			rawWorkflow['execution'] = {
				execution: {
					maxParallelTasks: 3,
					maxParallelSessions: 1
				}
			}['execution'];
			await fs.writeFile(workflowPath, `${JSON.stringify(rawWorkflow, null, 2)}\n`, 'utf8');

			await expect(
				store.update({
					expectedRevision: updated.revision,
					patch: [
						{
							op: 'replace',
							path: '/execution/maxParallelSessions',
							value: 4
						}
					],
					context: {
						requestedBySurface: 'test',
						requestedBy: 'vitest'
					}
				})
			).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' });
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});