import {
	DaemonApi,
	type MissionAgentSessionState
} from '@flying-pillow/mission-core';
import { connectAirportControl, resolveAirportControlRuntimeMode } from '../airport/connectAirportControl.js';
import { createPaneConnectParams } from '../airport/createPaneConnectParams.js';
import type { AirportTerminalContext } from '../airportTerminalContext.js';

type AirportLayoutSnapshot = Awaited<ReturnType<DaemonApi['airport']['getStatus']>>;
type AirportLayoutSessionRecord = Awaited<ReturnType<DaemonApi['mission']['listSessions']>>[number];
type AirportLayoutConsoleState = Awaited<ReturnType<DaemonApi['mission']['getSessionConsoleState']>>;

export async function bootstrapRunwayPane(_context: AirportTerminalContext): Promise<void> {
	const client = await connectAirportControl({
		surfacePath: process.cwd(),
		runtimeMode: resolveAirportControlRuntimeMode(import.meta.url)
	});
	const api = new DaemonApi(client);
	let currentSnapshot = await api.airport.connectPane(
		createPaneConnectParams('runway', 'mission-runway')
	);
	let currentSession: AirportLayoutSessionRecord | undefined;
	let currentConsoleState: AirportLayoutConsoleState = null;
	let refreshNonce = 0;

	const render = () => {
		renderRunwayPane({
			snapshot: currentSnapshot,
			session: currentSession,
			consoleState: currentConsoleState
		});
	};

	const refreshSessionSurface = async (snapshot: AirportLayoutSnapshot): Promise<void> => {
		const refreshId = ++refreshNonce;
		const target = resolveRunwayTarget(snapshot);
		if (!target.sessionId || !target.missionId) {
			currentSession = undefined;
			currentConsoleState = null;
			render();
			return;
		}

		const selector = { missionId: target.missionId };
		const sessions = await api.mission.listSessions(selector);
		const nextSession = sessions.find((candidate) => candidate.sessionId === target.sessionId);
		const nextConsoleState = nextSession
			? await api.mission.getSessionConsoleState(selector, target.sessionId)
			: null;

		if (refreshId !== refreshNonce) {
			return;
		}

		currentSession = nextSession;
		currentConsoleState = nextConsoleState;
		render();
	};

	await refreshSessionSurface(currentSnapshot);

	const subscription = client.onDidEvent((event) => {
		if (event.type === 'airport.state') {
			currentSnapshot = event.snapshot;
			void refreshSessionSurface(currentSnapshot).catch((error: unknown) => {
				process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
				process.exitCode = 1;
			});
			return;
		}

		if (event.type === 'mission.status') {
			const target = resolveRunwayTarget(currentSnapshot);
			if (!target.sessionId || event.missionId !== target.missionId) {
				return;
			}
			currentSession = event.status.agentSessions?.find((candidate) => candidate.sessionId === target.sessionId);
			if (!currentSession) {
				currentConsoleState = null;
			}
			render();
			return;
		}

		if (event.type === 'session.console' && event.sessionId === currentSession?.sessionId) {
			currentConsoleState = event.event.state;
			render();
			return;
		}

		if (event.type === 'session.event' && event.sessionId === currentSession?.sessionId) {
			currentSession = {
				...currentSession,
				...pickSessionRecordUpdates(event.event.state)
			};
			render();
			return;
		}

		if (event.type === 'session.lifecycle' && event.sessionId === currentSession?.sessionId) {
			currentSession = {
				...currentSession,
				lifecycleState: event.lifecycleState
			};
			render();
		}
	});

	process.stdin.resume();

	await new Promise<void>((resolve) => {
		const dispose = () => {
			subscription.dispose();
			client.dispose();
			process.stdin.pause();
			resolve();
		};
		process.once('SIGINT', dispose);
		process.once('SIGTERM', dispose);
	});
}

function resolveRunwayTarget(snapshot: AirportLayoutSnapshot): {
	missionId?: string;
	sessionId?: string;
} {
	const projection = snapshot.airportProjections.runway;
	const missionId = projection.missionId;
	const sessionId = projection.sessionId;
	return {
		...(missionId ? { missionId } : {}),
		...(sessionId ? { sessionId } : {})
	};
}

function renderRunwayPane(input: {
	snapshot: AirportLayoutSnapshot;
	session: AirportLayoutSessionRecord | undefined;
	consoleState: AirportLayoutConsoleState;
}): void {
	printRunwayHeader('MISSION RUNWAY');
	const binding = input.snapshot.state.airport.panes.runway;
	const projection = input.snapshot.airportProjections.runway;
	process.stdout.write(`airport: ${input.snapshot.state.airport.airportId}\n`);
	process.stdout.write(`session: ${input.snapshot.state.airport.substrate.sessionName}\n`);
	process.stdout.write(`binding: ${binding.targetKind}${binding.targetId ? `:${binding.targetId}` : ''}${binding.mode ? ` (${binding.mode})` : ''}\n`);
	process.stdout.write(`focus intent: ${input.snapshot.state.airport.focus.intentPaneId ?? 'none'}\n`);
	process.stdout.write(`focus observed: ${input.snapshot.state.airport.focus.observedPaneId ?? 'none'}\n`);
	process.stdout.write('\n');

	if (!projection.sessionId) {
		process.stdout.write('Runway is idle.\n');
		process.stdout.write('Select or launch a task session from Tower to bind the runway.\n');
		return;
	}

	process.stdout.write(`runway target: ${projection.sessionId}\n`);
	process.stdout.write(`mission: ${projection.missionId ?? 'unknown'}\n`);
	process.stdout.write(`status: ${input.session?.lifecycleState ?? projection.statusLabel}\n`);
	if (input.session?.runnerLabel) {
		process.stdout.write(`runner: ${input.session.runnerLabel}\n`);
	}
	if (input.session?.taskId) {
		process.stdout.write(`task: ${input.session.taskId}\n`);
	}
	if (input.session?.workingDirectory) {
		process.stdout.write(`cwd: ${input.session.workingDirectory}\n`);
	}
	process.stdout.write('\n');

	const consoleLines = input.consoleState?.lines ?? [];
	const visibleLineCount = Math.max((process.stdout.rows ?? 24) - 14, 8);
	const visibleLines = consoleLines.slice(-visibleLineCount);
	if (visibleLines.length === 0) {
		const lifecycleState = input.session?.lifecycleState ?? projection.statusLabel;
		if (lifecycleState === 'terminated' || lifecycleState === 'cancelled' || lifecycleState === 'completed' || lifecycleState === 'failed') {
			process.stdout.write(`Selected session is ${lifecycleState}. No live stream is available.\n`);
			if (input.session?.failureMessage) {
				process.stdout.write(`reason: ${input.session.failureMessage}\n`);
			}
		} else if (input.session?.transportId === 'terminal') {
			process.stdout.write('Terminal-backed session is bound. The live Copilot pane should replace this slot.\n');
		} else {
			process.stdout.write('Waiting for session output.\n');
		}
	} else {
		for (const line of visibleLines) {
			process.stdout.write(`${line}\n`);
		}
	}

	if (input.consoleState?.awaitingInput) {
		process.stdout.write('\nAwaiting input in the active runway session. Use Tower session controls to continue.\n');
	}
	if (input.consoleState?.promptOptions && input.consoleState.promptOptions.length > 0) {
		process.stdout.write(`Prompt options: ${input.consoleState.promptOptions.join(', ')}\n`);
	}
	if (!input.session && !input.consoleState) {
		process.stdout.write('\nWaiting for mission runtime to surface the bound runway session.\n');
	}
}

function pickSessionRecordUpdates(state: MissionAgentSessionState): Partial<AirportLayoutSessionRecord> {
	return {
		runnerId: state.runnerId,
		...(state.transportId ? { transportId: state.transportId } : {}),
		runnerLabel: state.runnerLabel,
		lifecycleState: state.lifecycleState as AirportLayoutSessionRecord['lifecycleState'],
		...(state.workingDirectory ? { workingDirectory: state.workingDirectory } : {}),
		...(state.currentTurnTitle ? { currentTurnTitle: state.currentTurnTitle } : {}),
		...(state.failureMessage ? { failureMessage: state.failureMessage } : {}),
		lastUpdatedAt: state.lastUpdatedAt
	};
}

function printRunwayHeader(title: string): void {
	process.stdout.write('\u001b[H\u001b[2J\u001b[3J');
	process.stdout.write(`${title}\n\n`);
}