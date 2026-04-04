import { note, outro } from '@clack/prompts';
import { getRepoRoot, getDaemonManifestPath, runMissionDaemon } from '@flying-pillow/mission-core';
import { getMissionDaemonStatus, startMissionDaemon, stopMissionDaemon } from './commands/daemonControl.js';

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
		commandToken === 'start' || commandToken === 'stop' || commandToken === 'restart' || commandToken === 'status' || commandToken === 'run'
			? commandToken
			: 'start';
	const socketFlagIndex = filtered.indexOf('--socket');
	const socketPath = socketFlagIndex >= 0 ? filtered[socketFlagIndex + 1] : undefined;
	return { command, ...(socketPath ? { socketPath } : {}), json };
}

const repoRoot = process.env['MISSION_REPO_ROOT']?.trim() || getRepoRoot();
const parsed = parseDaemonArgs(process.argv.slice(2));

switch (parsed.command) {
	case 'run':
		await runMissionDaemon(process.argv.slice(2));
		break;
	case 'start': {
		const result = await startMissionDaemon({
			repoRoot,
			...(parsed.socketPath ? { socketPath: parsed.socketPath } : {})
		});
		if (parsed.json) {
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
			break;
		}
		note(
			[
				`manifest: ${getDaemonManifestPath(repoRoot)}`,
				...(result.endpointPath ? [`socket: ${result.endpointPath}`] : []),
				...(result.pid !== undefined ? [`pid: ${String(result.pid)}`] : []),
				`status: ${result.alreadyRunning ? 'already running' : 'started'}`
			].join('\n'),
			'missiond'
		);
		outro(result.message);
		break;
	}
	case 'stop': {
		const result = await stopMissionDaemon(repoRoot);
		if (parsed.json) {
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
			break;
		}
		note(
			[
				`manifest: ${result.manifestPath}`,
				...(result.endpointPath ? [`socket: ${result.endpointPath}`] : []),
				...(result.pid !== undefined ? [`pid: ${String(result.pid)}`] : []),
				`status: ${result.killed || result.endpointPath ? 'stopped' : 'already stopped'}`
			].join('\n'),
			'missiond'
		);
		outro(result.message);
		break;
	}
	case 'restart': {
		await stopMissionDaemon(repoRoot);
		const result = await startMissionDaemon({
			repoRoot,
			...(parsed.socketPath ? { socketPath: parsed.socketPath } : {})
		});
		if (parsed.json) {
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
			break;
		}
		note(
			[
				`manifest: ${result.manifestPath}`,
				...(result.endpointPath ? [`socket: ${result.endpointPath}`] : []),
				...(result.pid !== undefined ? [`pid: ${String(result.pid)}`] : []),
				'status: restarted'
			].join('\n'),
			'missiond'
		);
		outro('Mission daemon restarted.');
		break;
	}
	case 'status': {
		const result = await getMissionDaemonStatus(repoRoot);
		if (parsed.json) {
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
			break;
		}
		note(
			[
				`manifest: ${result.manifestPath}`,
				...(result.endpointPath ? [`socket: ${result.endpointPath}`] : []),
				...(result.pid !== undefined ? [`pid: ${String(result.pid)}`] : []),
				...(result.startedAt ? [`startedAt: ${result.startedAt}`] : []),
				...(result.protocolVersion !== undefined ? [`protocol: ${String(result.protocolVersion)}`] : []),
				`status: ${result.running ? 'running' : 'stopped'}`
			].join('\n'),
			'missiond'
		);
		outro(result.message);
		break;
	}
}
