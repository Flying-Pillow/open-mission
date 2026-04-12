import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { EntryContext } from './entryContext.js';

const require = createRequire(import.meta.url);

export async function runAirportTerminalCommand(command: string, context: EntryContext): Promise<void> {
	const airportTerminalCliEntryPath = resolveAirportTerminalCliEntryPath();
	const child = spawn('bun', [airportTerminalCliEntryPath, command, ...context.args], {
		stdio: 'inherit',
		env: {
			...process.env,
			MISSION_CONTROL_ROOT: context.controlRoot,
			MISSION_ENTRY_CWD: context.workingDirectory,
			AIRPORT_TERMINAL_ENTRY_PATH: airportTerminalCliEntryPath
		}
	});

	await new Promise<void>((resolve, reject) => {
		child.once('error', (error) => {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				reject(new Error('Bun is required to run the Airport terminal surface. Install Bun or run Mission through a pnpm script that exposes the workspace Bun binary.'));
				return;
			}
			reject(error);
		});
		child.once('exit', (code, signal) => {
			if (signal) {
				reject(new Error(`Airport terminal exited from signal ${signal}.`));
				return;
			}
			if ((code ?? 0) !== 0) {
				reject(new Error(`Airport terminal exited with code ${String(code ?? 1)}.`));
				return;
			}
			resolve();
		});
	});
}

function resolveAirportTerminalCliEntryPath(): string {
	const airportTerminalModuleEntryPath = require.resolve('@flying-pillow/mission-airport-terminal');
	return path.join(path.dirname(airportTerminalModuleEntryPath), 'index.js');
}