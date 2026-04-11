import * as path from 'node:path';
import { note, outro, spinner } from '@clack/prompts';
import { initializeMissionRepository } from '@flying-pillow/mission-core';
import type { CommandContext } from './types.js';

export async function runInit(context: CommandContext): Promise<void> {
	const progress = spinner();
	progress.start('Scaffolding Mission root');
	const initialization = await initializeMissionRepository(context.controlRoot);

	progress.stop('Mission root ready');
	note(
		`control: ${path.relative(context.controlRoot, initialization.controlDirectoryPath)}\ndaemon settings: ${initialization.daemonSettingsPath}\nactive: ${path.relative(context.controlRoot, initialization.worktreesRoot)}\nrunner: no default agent runner configured`,
		'Workspace state'
	);
	outro('Mission repo scaffolding is ready.');
}