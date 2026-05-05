import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import {
	startMissionDaemon,
	type MissionDaemonHandle,
	type MissionDaemonStartOptions
} from './DaemonIpcServer.js';
import { getDaemonLogPath } from './daemonPaths.js';
import { readDaemonLogLines } from './runtime/DaemonLogger.js';
import {
	getMissionDaemonProcessStatus,
	resolveDefaultRuntimeFactoryModulePath,
	startMissionDaemonProcess,
	stopMissionDaemonProcess,
	type DaemonRuntimeMode
} from './runtime/DaemonProcessControl.js';

export {
	startMissionDaemon,
	type MissionDaemonHandle,
	type MissionDaemonStartOptions
};

export async function runMissionDaemon(argv: string[] = process.argv.slice(2)): Promise<void> {
	const handle = await startMissionDaemon({
		argv,
		installSignalHandlers: true
	});

	try {
		await handle.closed;
	} finally {
		await handle.dispose();
	}
}

export async function runMissiondCommand(argv: string[] = process.argv.slice(2)): Promise<void> {
	const parsed = parseDaemonArgs(argv);
	const runtimeMode: DaemonRuntimeMode = parsed.dev || process.env['MISSION_DAEMON_RUNTIME_MODE']?.trim() === 'source' ? 'source' : 'build';
	const runtimeFactoryModulePath = resolveDefaultRuntimeFactoryModulePath(runtimeMode);

	switch (parsed.command) {
		case 'run':
			await runMissionDaemon(argv);
			break;
		case 'start': {
			const result = await startMissionDaemonProcess({
				...(parsed.socketPath ? { socketPath: parsed.socketPath } : {}),
				runtimeMode,
				...(runtimeFactoryModulePath ? { runtimeFactoryModulePath } : {})
			});
			renderResult('missiond', result, parsed.json, result.message, result.alreadyRunning ? 'already running' : 'started');
			break;
		}
		case 'stop': {
			const result = await stopMissionDaemonProcess();
			renderResult('missiond', result, parsed.json, result.message, result.killed || result.endpointPath ? 'stopped' : 'already stopped');
			break;
		}
		case 'restart': {
			await stopMissionDaemonProcess();
			const result = await startMissionDaemonProcess({
				...(parsed.socketPath ? { socketPath: parsed.socketPath } : {}),
				runtimeMode,
				...(runtimeFactoryModulePath ? { runtimeFactoryModulePath } : {})
			});
			renderResult('missiond', result, parsed.json, 'Mission daemon restarted.', 'restarted');
			break;
		}
		case 'status': {
			const result = await getMissionDaemonProcessStatus();
			renderResult('missiond', result, parsed.json, result.message, result.running ? 'running' : 'stopped');
			break;
		}
		case 'logs': {
			if (parsed.follow) {
				await tailDaemonLog(parsed.maxLogLines);
				break;
			}
			const lines = await readDaemonLogLines({ maxLines: parsed.maxLogLines });
			if (parsed.json) {
				process.stdout.write(`${JSON.stringify({ logPath: getDaemonLogPath(), lines }, null, 2)}\n`);
				break;
			}
			if (lines.length > 0) {
				process.stdout.write(`${lines.join('\n')}\n`);
			}
			break;
		}
		case 'tail': {
			await tailDaemonLog(parsed.maxLogLines);
			break;
		}
	}
}

function parseDaemonArgs(argv: string[]): {
	command: 'start' | 'stop' | 'restart' | 'status' | 'run' | 'logs' | 'tail';
	socketPath?: string;
	dev: boolean;
	json: boolean;
	follow: boolean;
	maxLogLines: number;
} {
	const remaining = [...argv];
	const dev = remaining.includes('--dev');
	const json = remaining.includes('--json');
	const follow = remaining.includes('--follow') || remaining.includes('-f');
	const filtered = remaining.filter((arg) => arg !== '--' && arg !== '--dev' && arg !== '--json');
	const commandToken = filtered[0];
	const command =
		commandToken === undefined
			? 'start'
			: commandToken === 'start'
				|| commandToken === 'stop'
				|| commandToken === 'restart'
				|| commandToken === 'status'
				|| commandToken === 'run'
				|| commandToken === 'logs'
				|| commandToken === 'tail'
				? commandToken
				: undefined;
	if (!command) {
		throw new Error(`Unknown missiond command '${commandToken}'. Use one of: start, stop, restart, status, run, logs, tail.`);
	}
	const socketFlagIndex = filtered.indexOf('--socket');
	const socketPath = socketFlagIndex >= 0 ? filtered[socketFlagIndex + 1] : undefined;
	return {
		command,
		...(socketPath ? { socketPath } : {}),
		dev,
		json,
		follow,
		maxLogLines: readMaxLogLines(filtered)
	};
}

function readMaxLogLines(args: string[]): number {
	const flagIndex = args.findIndex((arg) => arg === '--tail' || arg === '-n');
	const rawValue = flagIndex >= 0 ? args[flagIndex + 1] : undefined;
	const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;
	return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : 200;
}

async function tailDaemonLog(maxLines: number): Promise<void> {
	const logPath = getDaemonLogPath();
	const initialLines = await readDaemonLogLines({ maxLines });
	if (initialLines.length > 0) {
		process.stdout.write(`${initialLines.join('\n')}\n`);
	}
	let offset = await readFileSize(logPath);

	await new Promise<void>((resolve) => {
		const stop = () => {
			fsSync.unwatchFile(logPath);
			resolve();
		};
		process.once('SIGINT', stop);
		process.once('SIGTERM', stop);
		fsSync.watchFile(logPath, { interval: 500 }, async (current) => {
			if (current.size <= offset) {
				offset = current.size;
				return;
			}
			const chunk = await readLogChunk(logPath, offset, current.size);
			offset = current.size;
			if (chunk.length > 0) {
				process.stdout.write(chunk);
			}
		});
	});
}

async function readFileSize(filePath: string): Promise<number> {
	try {
		return (await fs.stat(filePath)).size;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return 0;
		}
		throw error;
	}
}

async function readLogChunk(filePath: string, start: number, end: number): Promise<string> {
	const handle = await fs.open(filePath, 'r');
	try {
		const buffer = Buffer.alloc(end - start);
		const result = await handle.read(buffer, 0, buffer.length, start);
		return buffer.subarray(0, result.bytesRead).toString('utf8');
	} finally {
		await handle.close();
	}
}

function renderResult(
	title: string,
	result: {
		manifestPath: string;
		endpointPath?: string;
		pid?: number;
		startedAt?: string;
		protocolVersion?: number;
		killed?: boolean;
	},
	asJson: boolean,
	outroMessage: string,
	statusLabel: string
): void {
	if (asJson) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}

	const lines = [
		`manifest: ${result.manifestPath}`,
		...(result.endpointPath ? [`socket: ${result.endpointPath}`] : []),
		...(result.pid !== undefined ? [`pid: ${String(result.pid)}`] : []),
		...(result.startedAt ? [`startedAt: ${result.startedAt}`] : []),
		...(result.protocolVersion !== undefined ? [`protocol: ${String(result.protocolVersion)}`] : []),
		...(result.killed !== undefined ? [`killed: ${result.killed ? 'yes' : 'no'}`] : []),
		`status: ${statusLabel}`
	];
	process.stdout.write(`${title}\n${lines.join('\n')}\n${outroMessage}\n`);
}