import { intro } from '@clack/prompts';
import { getWorkspaceRoot } from '@flying-pillow/mission-core';
import { launchCockpit } from './cockpit/launchCockpit.js';
import { runDaemonStop } from './commands/daemonStop.js';
import type { CommandContext, CommandHandler } from './commands/types.js';

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
	const [firstArg, ...restArgs] = argv;
	const command =
		!firstArg || firstArg.startsWith('--') ? '__cockpit__' : firstArg;
	const args =
		!firstArg ? [] : firstArg.startsWith('--') ? argv : restArgs;
	const json = argv.includes('--json');
	if (firstArg === 'help' || firstArg === '--help' || firstArg === '-h') {
		printHelp();
		return;
	}

	if (!json && command !== '__cockpit__') {
		intro('Mission');
	}

	const context: CommandContext = {
		controlRoot: process.env['MISSION_CONTROL_ROOT']?.trim() || getWorkspaceRoot(),
		launchCwd: process.env['MISSION_LAUNCH_CWD']?.trim() || process.cwd(),
		args,
		json
	};

	const commands: Record<string, CommandHandler> = {
		__cockpit__: launchCockpit,
		'daemon:stop': runDaemonStop
	};

	const handler = commands[command];
	if (!handler) {
		throw new Error(`Unknown command '${command}'. Run 'mission help' for the supported surface.`);
	}

	await handler(context);
}

export function printHelp(): void {
	process.stdout.write(
		`Mission CLI\n\nCommands:\n  mission [--hmr] [--banner] [--no-banner]\n  mission daemon:stop [--json]\n\nRelated commands:\n  missiond [--socket <path>]\n\nNotes:\n  Bare 'mission' opens the interactive cockpit.\n  Launching from a mission worktree auto-selects that mission.\n  Launching from the control checkout opens Mission control mode.\n  The OpenTUI cockpit currently requires Bun at runtime.\n  Use '--hmr' to run the cockpit with automatic restart on CLI source changes.\n  The cockpit will auto-start the daemon with 'missiond' if it is not already running.\n  Starting Mission will scaffold control-repo state automatically if it is missing.\n`
	);
}
