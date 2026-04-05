import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { initializeMissionRepository } from './initializeMissionRepository.js';

describe('initializeMissionRepository', () => {
	it('scaffolds neutral settings without a default control agent configuration', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-init-'));

		try {
			const initialization = await initializeMissionRepository(workspaceRoot);
			const content = await fs.readFile(initialization.daemonSettingsPath, 'utf8');
			const settings = JSON.parse(content) as Record<string, unknown>;

			expect(initialization.daemonSettingsPath).toBe(path.join(workspaceRoot, '.missions', 'settings.json'));
			expect(settings['trackingProvider']).toBe('github');
			expect(settings['instructionsPath']).toBe('.agents');
			expect(settings['skillsPath']).toBe('.agents/skills');
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});