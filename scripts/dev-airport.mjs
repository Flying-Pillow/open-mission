import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logsDir = path.join(workspaceRoot, '.logs');
const userArgs = process.argv.slice(2);

function runChecked(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: workspaceRoot,
		stdio: 'inherit',
		env: process.env,
		...options
	});

	if (result.error) {
		throw result.error;
	}

	if ((result.status ?? 0) !== 0) {
		process.exit(result.status ?? 1);
	}
}

function prepareLogFile(fileName) {
	fs.mkdirSync(logsDir, { recursive: true });
	const filePath = path.join(logsDir, fileName);
	fs.writeFileSync(filePath, '');
	return {
		filePath,
		stream: fs.createWriteStream(filePath, { flags: 'a' })
	};
}

function pipeChildOutput(child, output, target) {
	if (!output) {
		return;
	}

	output.on('data', (chunk) => {
		target.stream.write(chunk);
		process[target.output].write(chunk);
	});
}

function spawnManaged(command, args, extraEnv = {}, logFileName) {
	const logTarget = logFileName ? prepareLogFile(logFileName) : undefined;
	const child = spawn(command, args, {
		cwd: workspaceRoot,
		stdio: ['inherit', 'pipe', 'pipe'],
		env: {
			...process.env,
			...extraEnv
		}
	});

	child.on('error', (error) => {
		logTarget?.stream.end();
		throw error;
	});

	if (logTarget) {
		pipeChildOutput(child.stdout, child.stdout, { stream: logTarget.stream, output: 'stdout' });
		pipeChildOutput(child.stderr, child.stderr, { stream: logTarget.stream, output: 'stderr' });
		child.on('exit', () => {
			logTarget.stream.end();
		});
	}

	return child;
}

let shuttingDown = false;
const children = new Set();

function shutdown(exitCode = 0, signal) {
	if (shuttingDown) {
		return;
	}

	shuttingDown = true;
	for (const child of children) {
		if (!child.killed) {
			child.kill(signal ?? 'SIGTERM');
		}
	}

	if (signal) {
		process.kill(process.pid, signal);
		return;
	}

	process.exit(exitCode);
}

runChecked('pnpm', ['run', 'mission:install:local:dev']);
runChecked('pnpm', [
	'--dir',
	'./packages/mission',
	'exec',
	'node',
	'--conditions=development',
	'--import',
	'tsx',
	'./src/mission.ts',
	'daemon:stop',
	'--json'
]);

const supervisedEnv = {
	MISSION_DAEMON_SUPERVISED: '1'
};

const daemon = spawnManaged(
	'pnpm',
	['--dir', './packages/core', 'run', 'daemon:dev'],
	supervisedEnv,
	'daemon.log'
);
const web = spawnManaged(
	'pnpm',
	['--dir', './apps/airport/web', 'run', 'dev', '--', ...userArgs],
	supervisedEnv,
	'web.log'
);

process.stdout.write(
	`Development logs: ${path.join(logsDir, 'daemon.log')} and ${path.join(logsDir, 'web.log')}\n`
);

children.add(daemon);
children.add(web);

for (const child of children) {
	child.on('exit', (code, signal) => {
		children.delete(child);
		if (shuttingDown) {
			return;
		}

		shutdown(code ?? 0, signal ?? undefined);
	});
}

process.once('SIGINT', () => shutdown(0, 'SIGINT'));
process.once('SIGTERM', () => shutdown(0, 'SIGTERM'));