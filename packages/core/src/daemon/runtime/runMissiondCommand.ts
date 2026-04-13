import { runMissionDaemon } from '../../index.js';
import {
	getMissionDaemonProcessStatus,
	resolveDefaultRuntimeFactoryModulePath,
	startMissionDaemonProcess,
	stopMissionDaemonProcess,
	type DaemonRuntimeMode
} from './DaemonProcessControl.js';

export async function runMissiondCommand(argv: string[] = process.argv.slice(2)): Promise<void> {
	const parsed = parseDaemonArgs(argv);
	const runtimeMode: DaemonRuntimeMode = process.env['MISSION_DAEMON_RUNTIME_MODE']?.trim() === 'source' ? 'source' : 'build';
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
	}
}

function parseDaemonArgs(argv: string[]): {
	command: 'start' | 'stop' | 'restart' | 'status' | 'run';
	socketPath?: string;
	json: boolean;
} {
	const remaining = [...argv];
	const json = remaining.includes('--json');
	const filtered = remaining.filter((arg) => arg !== '--json');
	const commandToken = filtered[0];
	const command =
		commandToken === undefined
			? 'start'
			: commandToken === 'start' || commandToken === 'stop' || commandToken === 'restart' || commandToken === 'status' || commandToken === 'run'
				? commandToken
				: undefined;
	if (!command) {
		throw new Error(`Unknown missiond command '${commandToken}'. Use one of: start, stop, restart, status, run.`);
	}
	const socketFlagIndex = filtered.indexOf('--socket');
	const socketPath = socketFlagIndex >= 0 ? filtered[socketFlagIndex + 1] : undefined;
	return { command, ...(socketPath ? { socketPath } : {}), json };
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