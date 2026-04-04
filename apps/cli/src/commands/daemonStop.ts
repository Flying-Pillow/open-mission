import { note, outro } from '@clack/prompts';
import {
	getDaemonManifestPath,
} from '@flying-pillow/mission-core';
import { stopMissionDaemon } from './daemonControl.js';
import type { CommandContext } from './types.js';

export async function runDaemonStop(context: CommandContext): Promise<void> {
	const manifestPath = getDaemonManifestPath(context.repoRoot);
	const result = await stopMissionDaemon(context.repoRoot);

	if (context.json) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}

	note(
		[
			`manifest: ${manifestPath}`,
			...(result.endpointPath ? [`socket: ${result.endpointPath}`] : []),
			...(result.pid !== undefined ? [`pid: ${String(result.pid)}`] : []),
			`killed: ${result.killed ? 'yes' : 'no'}`,
			`status: ${result.killed || result.endpointPath ? 'stopped' : 'already stopped'}`
		].join('\n'),
			'Daemon surface'
	);
	outro(result.message);
}
