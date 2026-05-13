import { getOpenMissionConfigPath } from '@flying-pillow/open-mission-core/settings/OpenMissionInstall';
import type { EntryContext } from './entryContext.js';
import { ensureOpenMissionInstallation, getOpenMissionInstallationOutput } from './ensureOpenMissionInstallation.js';

export async function runInstallCommand(context: EntryContext): Promise<void> {
	const config = await ensureOpenMissionInstallation({
		interactive: !context.json && process.stdout.isTTY,
		verbose: !context.json
	});
	if (context.json) {
		process.stdout.write(`${JSON.stringify(getOpenMissionInstallationOutput(config), null, 2)}\n`);
	}
}

export { ensureOpenMissionInstallation, getOpenMissionConfigPath };