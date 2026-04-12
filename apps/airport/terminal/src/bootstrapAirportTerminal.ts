import { getWorkspaceRoot } from '@flying-pillow/mission-core';
import { bootstrapAirportLayout } from './airport/bootstrapAirportLayout.js';
import { bootstrapBriefingRoomPane } from './briefing-room/bootstrapBriefingRoomPane.js';
import type { AirportTerminalContext, AirportTerminalHandler } from './airportTerminalContext.js';
import { bootstrapRunwayPane } from './runway/bootstrapRunwayPane.js';
import { bootstrapTowerPane } from './tower/bootstrapTowerPane.js';

export async function bootstrapAirportTerminal(argv: string[] = process.argv.slice(2)): Promise<void> {
	const [firstArg, ...restArgs] = argv;
	const command = !firstArg || firstArg.startsWith('--')
		? resolveDefaultSurfaceCommand()
		: firstArg;
	const args = !firstArg ? [] : firstArg.startsWith('--') ? argv : restArgs;
	const context: AirportTerminalContext = {
		controlRoot: process.env['MISSION_CONTROL_ROOT']?.trim() || getWorkspaceRoot(),
		workingDirectory: process.env['MISSION_ENTRY_CWD']?.trim() || process.cwd(),
		args,
		json: argv.includes('--json')
	};

	const handlers: Record<string, AirportTerminalHandler> = {
		__tower__: bootstrapTowerPane,
		'__airport-layout-open__': bootstrapAirportLayout,
		'__airport-layout-briefing-room-pane': bootstrapBriefingRoomPane,
		'__airport-layout-runway-pane': bootstrapRunwayPane,
		help: printAirportTerminalHelp,
		'--help': printAirportTerminalHelp,
		'-h': printAirportTerminalHelp
	};

	const handler = handlers[command];
	if (!handler) {
		throw new Error(`Unknown Airport terminal command '${command}'.`);
	}

	await handler(context);
}

function resolveDefaultSurfaceCommand(): '__tower__' | '__airport-layout-open__' {
	return process.env['AIRPORT_PANE_ID']?.trim()
		? '__tower__'
		: '__airport-layout-open__';
}

async function printAirportTerminalHelp(): Promise<void> {
	process.stdout.write(
		'Airport terminal entry\n\nInternal commands:\n  __tower__\n  __airport-layout-open__\n  __airport-layout-briefing-room-pane\n  __airport-layout-runway-pane\n'
	);
}