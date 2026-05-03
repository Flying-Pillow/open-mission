import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeFactoryModulePath = path.join(packageRoot, 'src', 'daemon', 'runtime', 'agent', 'runtimes', 'AgentRuntimeFactory.ts');

const child = spawn(
	'pnpm',
	[
		'exec',
		'nodemon',
		'--watch',
		'src',
		'--ext',
		'ts',
		'--signal',
		'SIGTERM',
		'--exec',
		'tsx src/daemon/missiond.ts run'
	],
	{
		cwd: packageRoot,
		stdio: 'inherit',
		env: {
			...process.env,
			MISSION_DAEMON_RUNTIME_MODE: 'source',
			MISSION_RUNTIME_FACTORY_MODULE: runtimeFactoryModulePath,
			MISSION_DAEMON_SUPERVISED: process.env['MISSION_DAEMON_SUPERVISED']?.trim() || '1'
		}
	}
);

child.on('error', (error) => {
	throw error;
});

child.on('exit', (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}

	process.exit(code ?? 0);
});