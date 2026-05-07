import { getMissionConfigPath } from '@flying-pillow/mission-core/settings/MissionInstall';
import type { EntryContext } from './entryContext.js';
import { ensureMissionInstallation, getMissionInstallationOutput } from './ensureMissionInstallation.js';

export async function runInstallCommand(context: EntryContext): Promise<void> {
	const config = await ensureMissionInstallation({
		interactive: !context.json && process.stdout.isTTY,
		verbose: !context.json
	});
	if (context.json) {
		process.stdout.write(`${JSON.stringify(getMissionInstallationOutput(config), null, 2)}\n`);
	}
}

export { ensureMissionInstallation, getMissionConfigPath };