import { spawn } from 'node:child_process';
import { readMissionUserConfig } from '@flying-pillow/mission-core';
import type { AirportTerminalContext } from '../airportTerminalContext.js';

export async function bootstrapRunwayPane(context: AirportTerminalContext): Promise<void> {
	void context;
	const targetSessionName = process.env['MISSION_RUNWAY_TERMINAL_SESSION_NAME']?.trim();
	if (!targetSessionName) {
		throw new Error('Runway pane requires MISSION_RUNWAY_TERMINAL_SESSION_NAME.');
	}
	const hostSessionName = process.env['AIRPORT_TERMINAL_SESSION']?.trim()
		|| process.env['AIRPORT_TERMINAL_SESSION_NAME']?.trim();
	if (hostSessionName && targetSessionName === hostSessionName) {
		throw new Error('Runway pane cannot attach the host airport session into itself.');
	}
	const terminalBinary = process.env['AIRPORT_TERMINAL_BINARY']?.trim()
		|| readMissionUserConfig()?.terminalBinary?.trim()
		|| 'zellij';

	await new Promise<void>((resolve, reject) => {
		const child = spawn(terminalBinary, ['attach', targetSessionName], {
			stdio: 'inherit',
			env: { ...process.env, ZELLIJ: undefined }
		});
		const forwardSignal = (signal: NodeJS.Signals) => {
			child.kill(signal);
		};
		const handleSigint = () => forwardSignal('SIGINT');
		const handleSigterm = () => forwardSignal('SIGTERM');
		process.once('SIGINT', handleSigint);
		process.once('SIGTERM', handleSigterm);
		child.once('error', (error) => {
			process.off('SIGINT', handleSigint);
			process.off('SIGTERM', handleSigterm);
			reject(error);
		});
		child.once('exit', (code, signal) => {
			process.off('SIGINT', handleSigint);
			process.off('SIGTERM', handleSigterm);
			if (signal) {
				resolve();
				return;
			}
			if ((code ?? 0) === 0) {
				resolve();
				return;
			}
			reject(new Error(`Runway session attach exited with code ${String(code)}.`));
		});
	});
}