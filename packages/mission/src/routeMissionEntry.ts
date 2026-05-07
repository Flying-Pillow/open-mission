import { intro } from '@clack/prompts';
import { Repository } from '@flying-pillow/mission-core/entities/Repository/Repository';
import type { EntryContext, MissionEntryHandler } from './entryContext.js';
import { ensureMissionInstallation } from './ensureMissionInstallation.js';
import { runAirportNativeCommand } from './runAirportNativeCommand.js';
import { runAirportStatusCommand } from './runAirportStatusCommand.js';
import { runAirportWebCommand } from './runAirportWebCommand.js';
import { runDaemonStopCommand } from './runDaemonStopCommand.js';
import { runInstallCommand } from './runInstallCommand.js';

export async function routeMissionEntry(argv: string[] = process.argv.slice(2)): Promise<void> {
	const [firstArg, ...restArgs] = argv;
	const command = !firstArg || firstArg.startsWith('--')
		? resolveDefaultEntryCommand()
		: firstArg;
	const args = !firstArg ? [] : firstArg.startsWith('--') ? argv : restArgs;
	const json = argv.includes('--json');
	if (firstArg === 'help' || firstArg === '--help' || firstArg === '-h') {
		printHelp();
		return;
	}

	if (!json) {
		intro('Mission');
	}

	const context: EntryContext = {
		repositoryRootPath: process.env['MISSION_REPOSITORY_ROOT']?.trim() || Repository.resolveRepositoryRoot(),
		workingDirectory: process.env['MISSION_ENTRY_CWD']?.trim() || process.cwd(),
		args,
		json
	};

	if (isAirportNativeCommand(command)) {
		await ensureMissionInstallation({
			interactive: !json && process.stdout.isTTY,
			verbose: false
		});
		await runAirportNativeCommand(command, context);
		return;
	}

	const handlers: Record<string, MissionEntryHandler> = {
		web: runAirportWebCommand,
		install: runInstallCommand,
		'airport:status': runAirportStatusCommand,
		'daemon:stop': runDaemonStopCommand
	};

	const handler = handlers[command];
	if (!handler) {
		throw new Error(`Unknown command '${command}'. Run 'mission help' for the supported surface.`);
	}
	if (command === 'web') {
		await ensureMissionInstallation({
			interactive: !json && process.stdout.isTTY,
			verbose: false
		});
	}

	await handler(context);
}

function isAirportNativeCommand(command: string): command is 'native:dev' | 'native:build' {
	return command === 'native:dev' || command === 'native:build';
}

function resolveDefaultEntryCommand(): 'web' {
	return 'web';
}

export function printHelp(): void {
	process.stdout.write(
		`Mission\n\nCommands:\n  mission\n  mission web\n  mission native:dev\n  mission native:build\n  mission install [--json]\n  mission airport:status [--json]\n  mission daemon:stop [--json]\n\nRelated commands:\n  missiond [--socket <path>]\n\nNotes:\n  Bare 'mission' starts the local Mission Airport web host.\n  The web host serves the shared SvelteKit Airport application from the installed npm package.\n  Native commands remain available for local Tauri development.\n  Mission expects Node 24.\n  Starting Mission scaffolds config automatically and prompts only when setup cannot be inferred safely.\n  Starting Mission will scaffold control-repo state automatically if it is missing.\n  On Linux, 'mission install' provisions the Mission-managed GitHub CLI dependency when it is missing.\n  Agent terminal sessions now run through the daemon-backed PTY transport instead of a required external multiplexer.\n  Install '@flying-pillow/mission' globally if you want persistent 'mission' and 'missiond' commands.\n`
	);
}
