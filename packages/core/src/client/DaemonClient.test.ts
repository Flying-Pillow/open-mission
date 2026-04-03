import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	getDaemonRuntimePath,
	isNamedPipePath,
	resolveDaemonSocketPath
} from '../daemon/daemonPaths.js';
import { DaemonClient } from './DaemonClient.js';

describe('DaemonClient', () => {
	it('connects through the deterministic socket path when the manifest is missing', async () => {
		const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-client-'));
		const socketPath = resolveDaemonSocketPath(repoRoot);
		const server = net.createServer();

		try {
			if (!isNamedPipePath(socketPath)) {
				await fs.mkdir(path.dirname(socketPath), { recursive: true });
			}

			await new Promise<void>((resolve, reject) => {
				server.once('error', reject);
				server.listen(socketPath, () => {
					server.off('error', reject);
					resolve();
				});
			});

			const client = new DaemonClient();
			await expect(client.connect({ repoRoot })).resolves.toBe(client);
			client.dispose();
		} finally {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
			if (!isNamedPipePath(socketPath)) {
				await fs.rm(getDaemonRuntimePath(repoRoot), { recursive: true, force: true }).catch(
					() => undefined
				);
			}
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});
});