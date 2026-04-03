import * as fs from 'node:fs/promises';
import { note, outro } from '@clack/prompts';
import {
	getDaemonRuntimePath,
	getDaemonManifestPath,
	readDaemonManifest
} from '@flying-pillow/mission-core';
import type { CommandContext } from './types.js';

type DaemonStopResult = {
	stopped: boolean;
	manifestPath: string;
	endpointPath?: string;
	pid?: number;
	killed: boolean;
	message: string;
};

export async function runDaemonStop(context: CommandContext): Promise<void> {
	const manifestPath = getDaemonManifestPath(context.repoRoot);
	const manifest = await readDaemonManifest(context.repoRoot);

	if (!manifest) {
		const result: DaemonStopResult = {
			stopped: true,
			manifestPath,
			killed: false,
			message: 'Mission daemon is already stopped.'
		};

		if (context.json) {
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
			return;
		}

		note(
			[
				`manifest: ${manifestPath}`,
				'status: already stopped'
			].join('\n'),
			'Daemon surface'
		);
		outro(result.message);
		return;
	}

	let killed = false;
	try {
		process.kill(manifest.pid, 'SIGTERM');
		killed = true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== 'ESRCH') {
			throw error;
		}
	}

	await fs.rm(manifestPath, { force: true }).catch(() => undefined);
	if (manifest.endpoint.transport === 'ipc') {
		await fs.rm(manifest.endpoint.path, { force: true }).catch(() => undefined);
	}
	await fs.rm(getDaemonRuntimePath(context.repoRoot), { recursive: true, force: true }).catch(
		() => undefined
	);

	const result: DaemonStopResult = {
		stopped: true,
		manifestPath,
		endpointPath: manifest.endpoint.path,
		pid: manifest.pid,
		killed,
		message: killed
			? 'Mission daemon stop signal sent and runtime files cleaned.'
			: 'Mission daemon runtime files cleaned; process was not running.'
	};

	if (context.json) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}

	note(
		[
			`manifest: ${manifestPath}`,
			`socket: ${manifest.endpoint.path}`,
			`pid: ${String(manifest.pid)}`,
			`killed: ${killed ? 'yes' : 'no'}`,
			'status: stopped'
		].join('\n'),
			'Daemon surface'
	);
	outro(result.message);
}