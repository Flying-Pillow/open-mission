import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	getDaemonLogPath,
	getDaemonManifestPath,
	getDaemonRuntimePath,
	getDaemonSessionStatePath,
	isNamedPipePath,
	resolveDaemonSocketPath
} from './daemonPaths.js';

describe('daemonPaths', () => {
	it('resolves runtime state outside the repository', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-paths-'));

		try {
			const runtimePath = getDaemonRuntimePath();
			const logPath = getDaemonLogPath();
			const manifestPath = getDaemonManifestPath();
			const sessionPath = getDaemonSessionStatePath(workspaceRoot, 'mission-123');
			const socketPath = resolveDaemonSocketPath();

			expect(runtimePath.startsWith(workspaceRoot)).toBe(false);
			expect(logPath).toBe(path.join(runtimePath, 'daemon.stdout.log'));
			expect(manifestPath).toBe(path.join(runtimePath, 'daemon.json'));
			expect(sessionPath.startsWith(path.join(runtimePath, 'workspaces'))).toBe(true);
			expect(sessionPath.endsWith(path.join('sessions', 'mission-123.json'))).toBe(true);
			expect(logPath.startsWith(workspaceRoot)).toBe(false);
			expect(manifestPath.startsWith(workspaceRoot)).toBe(false);
			expect(sessionPath.startsWith(workspaceRoot)).toBe(false);
			if (!isNamedPipePath(socketPath)) {
				expect(socketPath).toBe(path.join(runtimePath, 'daemon.sock'));
				expect(socketPath.startsWith(workspaceRoot)).toBe(false);
			}
		} finally {
			await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(
				() => undefined
			);
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});