import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	getDaemonLogPath,
	getDaemonLockPath,
	getDaemonManifestPath,
	getDaemonRuntimePath,
	getDaemonTerminalLeaseStatePath,
	getDaemonSessionStatePath,
	getDaemonStdoutLogPath,
	isNamedPipePath,
	resolveDaemonSocketPath
} from './daemonPaths.js';

describe('daemonPaths', () => {
	it('resolves runtime state outside the repository', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-paths-'));
		const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-paths-runtime-'));
		const previousRuntimeDirectory = process.env['XDG_RUNTIME_DIR'];
		process.env['XDG_RUNTIME_DIR'] = runtimeRoot;

		try {
			const runtimePath = getDaemonRuntimePath();
			const logPath = getDaemonLogPath();
			const stdoutLogPath = getDaemonStdoutLogPath();
			const manifestPath = getDaemonManifestPath();
			const lockPath = getDaemonLockPath();
			const terminalLeaseStatePath = getDaemonTerminalLeaseStatePath();
			const sessionPath = getDaemonSessionStatePath(workspaceRoot, 'mission-123');
			const socketPath = resolveDaemonSocketPath();

			expect(runtimePath.startsWith(workspaceRoot)).toBe(false);
			expect(logPath).toBe(path.join(runtimePath, 'daemon.log'));
			expect(stdoutLogPath).toBe(path.join(runtimePath, 'daemon.stdout.log'));
			expect(manifestPath).toBe(path.join(runtimePath, 'daemon.json'));
			expect(lockPath).toBe(path.join(runtimePath, 'daemon.lock'));
			expect(terminalLeaseStatePath).toBe(path.join(runtimePath, 'daemon-terminal-leases.json'));
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
			if (previousRuntimeDirectory === undefined) {
				delete process.env['XDG_RUNTIME_DIR'];
			} else {
				process.env['XDG_RUNTIME_DIR'] = previousRuntimeDirectory;
			}
			await fs.rm(runtimeRoot, { recursive: true, force: true });
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});