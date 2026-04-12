import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
	DaemonApi,
	readMissionUserConfig,
} from '@flying-pillow/mission-core';
import { connectAirportControl, resolveAirportControlRuntimeMode } from '../airport/connectAirportControl.js';
import { createPaneConnectParams } from '../airport/createPaneConnectParams.js';
import type { AirportTerminalContext } from '../airportTerminalContext.js';

type AirportLayoutSnapshot = Awaited<ReturnType<DaemonApi['airport']['getStatus']>>;

export async function bootstrapBriefingRoomPane(_context: AirportTerminalContext): Promise<void> {
	const client = await connectAirportControl({
		surfacePath: process.cwd(),
		runtimeMode: resolveAirportControlRuntimeMode(import.meta.url)
	});
	const api = new DaemonApi(client);
	let activeChild: ReturnType<typeof spawn> | undefined;
	let activeLaunchPath: string | undefined;
	let shuttingDown = false;
	let restartingChild = false;

	const launchBriefingRoom = async (snapshot: Awaited<ReturnType<typeof api.airport.getStatus>>): Promise<void> => {
		const nextLaunchPath = resolveBriefingRoomLaunchPath(snapshot, process.cwd());
		if (activeChild && activeLaunchPath === nextLaunchPath) {
			return;
		}
		if (activeChild) {
			restartingChild = true;
			activeChild.kill('SIGTERM');
			return;
		}
		activeLaunchPath = nextLaunchPath;
		const briefingRoomCommand = buildBriefingRoomCommand(process.cwd(), nextLaunchPath);
		activeChild = spawn('sh', ['-lc', `exec ${briefingRoomCommand}`], {
			cwd: process.cwd(),
			stdio: 'inherit',
			env: process.env
		});
		activeChild.once('error', (error) => {
			if (!shuttingDown) {
				throw error;
			}
		});
		activeChild.once('exit', (code, signal) => {
			activeChild = undefined;
			if (restartingChild) {
				restartingChild = false;
				void launchBriefingRoom(snapshotFromCurrentState).catch((error: unknown) => {
					process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
					process.exitCode = 1;
				});
				return;
			}
			if (shuttingDown || signal === 'SIGTERM') {
				return;
			}
			if (signal) {
				process.stderr.write(`briefing-room exited from signal ${signal}.\n`);
				process.exitCode = 1;
				return;
			}
			if ((code ?? 0) !== 0) {
				process.stderr.write(`briefing-room exited with code ${String(code ?? 1)}.\n`);
				process.exitCode = code ?? 1;
			}
		});
	};

	let snapshotFromCurrentState = await api.airport.connectPane(
		createPaneConnectParams('briefingRoom', 'mission-briefing-room')
	);
	await launchBriefingRoom(snapshotFromCurrentState);

	const subscription = client.onDidEvent((event) => {
		if (event.type !== 'airport.state') {
			return;
		}
		snapshotFromCurrentState = event.snapshot;
		void launchBriefingRoom(snapshotFromCurrentState).catch((error: unknown) => {
			process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
			process.exitCode = 1;
		});
	});

	await new Promise<void>((resolve) => {
		const dispose = () => {
			shuttingDown = true;
			subscription.dispose();
			client.dispose();
			if (activeChild) {
				activeChild.once('exit', () => resolve());
				activeChild.kill('SIGTERM');
				return;
			}
			resolve();
		};
		process.once('SIGINT', dispose);
		process.once('SIGTERM', dispose);
	});
}

function buildBriefingRoomCommand(repoRoot: string, launchPath?: string): string {
	const explicitEditorCommand = process.env['MISSION_TERMINAL_EDITOR_COMMAND']?.trim()
		|| process.env['MISSION_EDITOR_COMMAND']?.trim();
	if (explicitEditorCommand) {
		return explicitEditorCommand;
	}
	const configuredEditorBinary = readMissionUserConfig()?.editorBinary?.trim();

	const editorTarget = launchPath?.trim()
		|| [
			path.join(repoRoot, 'mission.json'),
			path.join(repoRoot, 'README.md'),
			path.join(repoRoot, 'BRANCH_HANDOFF.md'),
			path.join(repoRoot, 'CHANGELOG.md')
		].find((candidate) => existsSync(candidate));

	const editorBinary = configuredEditorBinary || 'micro';
	return editorTarget ? buildShellCommand([editorBinary, editorTarget]) : buildShellCommand([editorBinary]);
}

function resolveBriefingRoomLaunchPath(
	snapshot: AirportLayoutSnapshot,
	fallbackPath: string
): string {
	return snapshot.airportProjections.briefingRoom.launchPath?.trim() || fallbackPath;
}

function buildShellCommand(args: string[]): string {
	return args.map(shellEscape).join(' ');
}

function shellEscape(value: string): string {
	return `'${value.replace(/'/gu, `'\\''`)}'`;
}