import { spawn } from 'node:child_process';
import {
	DaemonApi,
	connectAirportControl,
	type MissionSystemSnapshot,
	readMissionUserConfig,
	resolveAirportControlRuntimeMode,
} from '@flying-pillow/mission-core';
import { createPaneConnectParams } from '../airport/createPaneConnectParams.js';
import type { AirportTerminalContext } from '../airportTerminalContext.js';

export async function bootstrapRunwayPane(context: AirportTerminalContext): Promise<void> {
	const client = await connectAirportControl({
		surfacePath: context.controlRoot,
		runtimeMode: resolveAirportControlRuntimeMode(import.meta.url),
		allowStart: false
	});
	const api = new DaemonApi(client);
	const terminalBinary = process.env['AIRPORT_TERMINAL_BINARY']?.trim()
		|| readMissionUserConfig()?.terminalBinary?.trim()
		|| 'zellij';
	const hostSessionName = process.env['AIRPORT_TERMINAL_SESSION']?.trim()
		|| process.env['AIRPORT_TERMINAL_SESSION_NAME']?.trim();
	let snapshot = await api.airport.connectPane(createPaneConnectParams('runway', 'mission-runway'));
	let activeChild: ReturnType<typeof spawn> | undefined;
	let activeTargetSessionName: string | undefined;
	let shuttingDown = false;
	let restartingChild = false;

	const showIdleMessage = (message: string): void => {
		const lines = [
			'',
			'RUNWAY',
			'',
			...message.split('\n')
		];
		process.stdout.write(`\u001Bc${lines.join('\n')}\n`);
	};

	const startAttach = (targetSessionName: string): void => {
		activeTargetSessionName = targetSessionName;
		activeChild = spawn(terminalBinary, buildRunwayAttachArgs(targetSessionName), {
			stdio: 'inherit',
			env: { ...process.env, ZELLIJ: undefined }
		});
		activeChild.once('error', (error) => {
			if (!shuttingDown) {
				process.stderr.write(`Runway failed to attach: ${error.message}\n`);
			}
		});
		activeChild.once('exit', (code, signal) => {
			activeChild = undefined;
			activeTargetSessionName = undefined;
			if (shuttingDown) {
				return;
			}
			if (restartingChild) {
				restartingChild = false;
				void reconcileTarget().catch((error: unknown) => {
					process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
					process.exitCode = 1;
				});
				return;
			}
			if (signal || (code ?? 0) === 0) {
				return;
			}
			showIdleMessage(`Nothing to show here yet.\n\nLast attach exited with code ${String(code)}.`);
		});
	};

	const reconcileTarget = async (): Promise<void> => {
		const targetSessionName = resolveRunwayTargetTerminalSessionName(snapshot);
		if (!targetSessionName) {
			if (activeChild) {
				restartingChild = false;
				activeChild.kill('SIGTERM');
				return;
			}
			showIdleMessage('Nothing to show here yet.\n\nSelect a running agent session in Mission Control to project it on Runway.');
			return;
		}
		if (hostSessionName && hostSessionName === targetSessionName) {
			if (activeChild) {
				restartingChild = false;
				activeChild.kill('SIGTERM');
				return;
			}
			showIdleMessage('Nothing to show here yet.\n\nRunway blocked: selected session resolves to the host AIRPORT session.');
			return;
		}
		if (activeChild && activeTargetSessionName === targetSessionName) {
			return;
		}
		if (activeChild) {
			restartingChild = true;
			activeChild.kill('SIGTERM');
			return;
		}
		startAttach(targetSessionName);
	};

	await reconcileTarget();

	const subscription = client.onDidEvent((event) => {
		if (event.type !== 'airport.state') {
			return;
		}
		snapshot = event.snapshot;
		void reconcileTarget().catch((error: unknown) => {
			process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
			process.exitCode = 1;
		});
	});

	await new Promise<void>((resolve, reject) => {
		const handleSigint = () => {
			shutdown().then(resolve).catch(reject);
		};
		const handleSigterm = () => {
			shutdown().then(resolve).catch(reject);
		};
		const shutdown = async (): Promise<void> => {
			shuttingDown = true;
			subscription.dispose();
			client.dispose();
			if (activeChild) {
				await new Promise<void>((childResolve) => {
					activeChild?.once('exit', () => childResolve());
					activeChild?.kill('SIGTERM');
				});
			}
		};
		process.once('SIGINT', handleSigint);
		process.once('SIGTERM', handleSigterm);
	});
}

function resolveRunwayTargetTerminalSessionName(snapshot: MissionSystemSnapshot): string | undefined {
	const sessionId = snapshot.airportProjections.runway.sessionId?.trim();
	if (!sessionId) {
		return undefined;
	}
	const session = snapshot.state.domain.agentSessions[sessionId];
	if (!session || session.transportId !== 'terminal') {
		return undefined;
	}
	return session.terminalSessionName?.trim() || undefined;
}

export function buildRunwayAttachArgs(targetSessionName: string): string[] {
	return ['attach', targetSessionName, 'options', '--pane-frames', 'false'];
}