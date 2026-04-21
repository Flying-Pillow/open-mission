import { note, outro } from '@clack/prompts';
import {
	getDaemonManifestPath,
	stopMissionDaemonProcess,
} from '@flying-pillow/mission-core/node';
import type { EntryContext } from './entryContext.js';

export async function runDaemonStopCommand(context: EntryContext): Promise<void> {
	const manifestPath = getDaemonManifestPath();
	const result = await stopMissionDaemonProcess();

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