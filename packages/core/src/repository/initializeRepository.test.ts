import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { initializeRepository } from './initializeRepository.js';

describe('initializeRepository', () => {
	it('scaffolds neutral settings without a default control agent configuration', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-init-'));

		try {
			const initialization = await initializeRepository(workspaceRoot);
			const content = await fs.readFile(initialization.daemonSettingsPath, 'utf8');
			const workflowContent = await fs.readFile(initialization.workflowDefinitionPath, 'utf8');
			const settings = JSON.parse(content) as Record<string, unknown>;
			const workflow = JSON.parse(workflowContent) as Record<string, unknown>;

			expect(initialization.daemonSettingsPath).toBe(path.join(workspaceRoot, '.mission', 'settings.json'));
			expect(initialization.workflowDefinitionPath).toBe(path.join(workspaceRoot, '.mission', 'workflow', 'workflow.json'));
			expect(settings['missionWorkspaceRoot']).toBe('missions');
			expect(settings['trackingProvider']).toBe('github');
			expect(settings['instructionsPath']).toBe('.agents');
			expect(settings['skillsPath']).toBe('.agents/skills');
			expect(settings['workflow']).toBeUndefined();
			expect(workflow['stageOrder']).toEqual(['prd', 'spec', 'implementation', 'audit', 'delivery']);
			await expect(fs.access(initialization.workflowTemplatesPath)).resolves.toBeUndefined();
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('can skip ignored runtime directories for repository bootstrap worktrees', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-init-'));

		try {
			const initialization = await initializeRepository(workspaceRoot, {
				includeRuntimeDirectories: false
			});

			await expect(fs.access(initialization.daemonSettingsPath)).resolves.toBeUndefined();
			await expect(fs.access(path.join(workspaceRoot, '.mission', 'worktrees'))).rejects.toThrow();
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});