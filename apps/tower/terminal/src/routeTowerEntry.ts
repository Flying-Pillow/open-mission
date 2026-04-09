import { intro } from '@clack/prompts';
import { getWorkspaceRoot } from '@flying-pillow/mission-core';
import { bootstrapTowerPane } from './tower/bootstrapTowerPane.js';
import { runAirportStatus } from './commands/airportStatus.js';
import { runDaemonStop } from './commands/daemonStop.js';
import {
	runAirportLayoutEditorPane,
	runAirportLayoutLaunch,
	runAirportLayoutPilotPane
} from './commands/airport-layout.js';
import type { CommandContext, CommandHandler } from './commands/types.js';

export async function routeTowerEntry(argv: string[] = process.argv.slice(2)): Promise<void> {
	const [firstArg, ...restArgs] = argv;
	const command =
		!firstArg || firstArg.startsWith('--') ? '__tower__' : firstArg;
	const args =
		!firstArg ? [] : firstArg.startsWith('--') ? argv : restArgs;
	const json = argv.includes('--json');
	if (firstArg === 'help' || firstArg === '--help' || firstArg === '-h') {
		printHelp();
		return;
	}

	if (!json && command !== '__tower__' && !command.startsWith('__')) {
		intro('Mission');
	}

	const context: CommandContext = {
		controlRoot: process.env['MISSION_CONTROL_ROOT']?.trim() || getWorkspaceRoot(),
		launchCwd: process.env['MISSION_LAUNCH_CWD']?.trim() || process.cwd(),
		args,
		json
	};

	const commands: Record<string, CommandHandler> = {
		__tower__: bootstrapTowerPane,
		'__airport-layout-launch__': runAirportLayoutLaunch,
		'__airport-layout-editor-pane': runAirportLayoutEditorPane,
		'__airport-layout-pilot-pane': runAirportLayoutPilotPane,
		'airport:status': runAirportStatus,
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
		`Mission\n\nCommands:\n  mission [--hmr] [--banner] [--no-banner]\n  mission airport:status [--json]\n  mission daemon:stop [--json]\n\nRelated commands:\n  missiond [--socket <path>]\n\nNotes:\n  Bare 'mission' launches the terminal Tower surface.\n  On POSIX shells, Mission bootstraps the airport layout through the terminal manager when available.\n  The airport layout places Mission Tower on the left, a pilot pane on the upper right, and the editor gate on the lower right.\n  Mission resets the repository-scoped terminal-manager session at startup so each airport-layout launch begins from the initial layout state for that repository.\n  Launching from a mission worktree auto-selects that mission.\n  Launching from the repository checkout opens repository mode.\n  The OpenTUI Tower currently requires Bun at runtime.\n  Use '--hmr' to run the terminal Tower with automatic restart on Mission surface changes; package source changes use built exports in HMR mode.\n  The Tower will auto-start the daemon with 'missiond' if it is not already running.\n  Starting Mission will scaffold control-repo state automatically if it is missing.\n  mission.cmd does not create terminal-manager sessions; use WSL on native Windows.\n`
	);
}