import { intro } from '@clack/prompts';
import { Repository } from '@flying-pillow/open-mission-core/entities/Repository/Repository';
import type { EntryContext, MissionEntryHandler } from './entryContext.js';
import { ensureOpenMissionInstallation } from './ensureOpenMissionInstallation.js';
import { runOpenMissionNativeCommand } from './runOpenMissionNativeCommand.js';
import { runOpenMissionDaemonStatusCommand } from './runOpenMissionDaemonStatusCommand.js';
import { runOpenMissionWebCommand } from './runOpenMissionWebCommand.js';
import { runDaemonStopCommand } from './runDaemonStopCommand.js';
import { runInstallCommand } from './runInstallCommand.js';
import { runOpenMissionMcpCommand } from './runOpenMissionMcpCommand.js';

export async function routeOpenMissionEntry(argv: string[] = process.argv.slice(2)): Promise<void> {
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

	if (!json && command !== 'mcp') {
		intro('Open Mission');
	}

	const context: EntryContext = {
		repositoryRootPath: process.env['OPEN_MISSION_REPOSITORY_ROOT']?.trim() || Repository.resolveRepositoryRoot(),
		workingDirectory: process.env['OPEN_MISSION_ENTRY_CWD']?.trim() || process.cwd(),
		args,
		json
	};

	if (isOpenMissionNativeCommand(command)) {
		await ensureOpenMissionInstallation({
			interactive: !json && process.stdout.isTTY,
			verbose: false
		});
		await runOpenMissionNativeCommand(command, context);
		return;
	}

	const handlers: Record<string, MissionEntryHandler> = {
		web: runOpenMissionWebCommand,
		mcp: runOpenMissionMcpCommand,
		install: runInstallCommand,
		'daemon:status': runOpenMissionDaemonStatusCommand,
		'daemon:stop': runDaemonStopCommand
	};

	const handler = handlers[command];
	if (!handler) {
		throw new Error(`Unknown command '${command}'. Run 'open-mission help' for the supported surface.`);
	}
	if (command === 'web') {
		await ensureOpenMissionInstallation({
			interactive: !json && process.stdout.isTTY,
			verbose: false
		});
	}

	await handler(context);
}

function isOpenMissionNativeCommand(command: string): command is 'native:dev' | 'native:build' {
	return command === 'native:dev' || command === 'native:build';
}

function resolveDefaultEntryCommand(): 'web' {
	return 'web';
}

export function printHelp(): void {
	process.stdout.write(
		`Open Mission\n\nCommands:\n  open-mission\n  open-mission web\n  open-mission mcp connect --agent-execution <id>\n  open-mission native:dev\n  open-mission native:build\n  open-mission install [--json]\n  open-mission daemon:status [--json]\n  open-mission daemon:stop [--json]\n\nRelated commands:\n  open-missiond [--socket <path>]\n\nNotes:\n  Bare 'open-mission' starts the local Open Mission web host.\n  The web host serves the shared SvelteKit Open Mission application from the installed npm package.\n  Native commands remain available for local Tauri development.\n  Open Mission expects Node 24.\n  Starting Open Mission scaffolds config automatically and prompts only when setup cannot be inferred safely.\n  Starting Open Mission will scaffold repository control state automatically if it is missing.\n  On Linux, 'open-mission install' provisions the Open Mission-managed GitHub CLI dependency when it is missing.\n  Agent terminal sessions now run through the daemon-backed PTY transport instead of a required external multiplexer.\n  Install '@flying-pillow/open-mission' globally if you want persistent 'open-mission' and 'open-missiond' commands.\n`
	);
}
