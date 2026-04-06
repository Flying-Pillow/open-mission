import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readWorkflowSettingsRevision } from './revision.js';

describe('workflow settings revision', () => {
	it('returns the same token for unchanged file content', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-settings-revision-'));
		const settingsPath = path.join(tempDir, 'settings.json');

		try {
			await fs.writeFile(settingsPath, '{"workflow":{}}\n', 'utf8');
			const first = await readWorkflowSettingsRevision(settingsPath);
			const second = await readWorkflowSettingsRevision(settingsPath);

			expect(first.token).toBe(second.token);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it('changes the token when file content changes', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-settings-revision-'));
		const settingsPath = path.join(tempDir, 'settings.json');

		try {
			await fs.writeFile(settingsPath, '{"workflow":{"stageOrder":["prd"]}}\n', 'utf8');
			const first = await readWorkflowSettingsRevision(settingsPath);
			await fs.writeFile(settingsPath, '{"workflow":{"stageOrder":["prd","spec"]}}\n', 'utf8');
			const second = await readWorkflowSettingsRevision(settingsPath);

			expect(first.token).not.toBe(second.token);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});