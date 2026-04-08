/** @jsxImportSource @opentui/solid */

import { createCliRenderer } from '@opentui/core';
import { render } from '@opentui/solid';
import {
	MissionCockpitApp,
	type RunCockpitAppOptions
} from './MissionCockpitController.js';

export async function runCockpitApp(options: RunCockpitAppOptions): Promise<void> {
	const renderer = await createCliRenderer({
		exitOnCtrlC: false,
		targetFps: 30
	});
	let exitAfterDestroy = false;
	const teardownOnSignal = () => {
		exitAfterDestroy = true;
		renderer.destroy();
	};
	const signalNames: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];
	for (const signalName of signalNames) {
		process.once(signalName, teardownOnSignal);
	}
	await render(() => <MissionCockpitApp {...options} />, renderer);
	await new Promise<void>((resolve) => {
		renderer.once('destroy', () => {
			for (const signalName of signalNames) {
				process.removeListener(signalName, teardownOnSignal);
			}
			if (exitAfterDestroy) {
				process.exit(0);
			}
			resolve();
		});
	});
}