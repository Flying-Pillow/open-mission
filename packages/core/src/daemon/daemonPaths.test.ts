import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	getDaemonManifestPath,
	getDaemonRuntimePath,
	getDaemonSessionStatePath,
	isNamedPipePath,
	resolveDaemonSocketPath
} from './daemonPaths.js';

describe('daemonPaths', () => {
	it('resolves runtime state outside the repository', async () => {
		const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-paths-'));

		try {
			const runtimePath = getDaemonRuntimePath(repoRoot);
			const manifestPath = getDaemonManifestPath(repoRoot);
			const sessionPath = getDaemonSessionStatePath(repoRoot, 'mission-123');
			const socketPath = resolveDaemonSocketPath(repoRoot);

			expect(runtimePath.startsWith(repoRoot)).toBe(false);
			expect(manifestPath).toBe(path.join(runtimePath, 'daemon.json'));
			expect(sessionPath).toBe(path.join(runtimePath, 'sessions', 'mission-123.json'));
			expect(manifestPath.startsWith(repoRoot)).toBe(false);
			expect(sessionPath.startsWith(repoRoot)).toBe(false);
			if (!isNamedPipePath(socketPath)) {
				expect(socketPath).toBe(path.join(runtimePath, 'daemon.sock'));
				expect(socketPath.startsWith(repoRoot)).toBe(false);
			}
		} finally {
			await fs.rm(getDaemonRuntimePath(repoRoot), { recursive: true, force: true }).catch(
				() => undefined
			);
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});
});