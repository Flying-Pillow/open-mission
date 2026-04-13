import type {
	DaemonClient,
	MissionSelector,
	MissionSystemSnapshot,
	OperatorActionExecutionStep,
	OperatorActionFlowDescriptor,
	OperatorStatus,
} from '@flying-pillow/mission-core';
import { DaemonApi } from '@flying-pillow/mission-core';
import { createMemo, createSignal } from 'solid-js';
import type { TowerConnectRequest } from './tower/bootstrapTowerPane.js';
import type { AirportConnection } from './AirportShell.js';
import {
	describeControlConnection,
	isRecoverableDaemonDisconnect,
	selectorFromTowerState,
	toErrorMessage,
} from './airportDomain.js';

type DaemonState = 'connected' | 'degraded' | 'booting';

type AirportControllerOptions = {
	initialSelector: MissionSelector;
	initialConnection?: AirportConnection;
	initialConnectionError?: string;
	connect: (request?: TowerConnectRequest) => Promise<AirportConnection>;
	onLog: (message: string) => void;
};

export function createAirportController(options: AirportControllerOptions) {
	const [selector, setSelector] = createSignal<MissionSelector>(options.initialSelector);
	const [connection, setConnection] = createSignal<AirportConnection | undefined>(options.initialConnection);
	const [status, setStatus] = createSignal<OperatorStatus>(options.initialConnection?.status ?? { found: false });
	const [systemSnapshot, setSystemSnapshot] = createSignal<MissionSystemSnapshot | undefined>(options.initialConnection?.snapshot);
	const [daemonState, setDaemonState] = createSignal<DaemonState>(
		options.initialConnection ? 'connected' : options.initialConnectionError ? 'degraded' : 'booting'
	);

	const client = createMemo(() => connection()?.client);
	const systemDomain = createMemo(() => systemSnapshot()?.state.domain);

	async function replaceConnection(next: AirportConnection | undefined): Promise<void> {
		const previous = connection();
		if (previous && previous !== next) {
			previous.dispose();
		}
		setConnection(next);
	}

	function applySystemSnapshot(nextSystem: MissionSystemSnapshot): void {
		setSystemSnapshot((current) => {
			const currentVersion = current?.state.version ?? -1;
			if (nextSystem.state.version < currentVersion) {
				return current;
			}
			return nextSystem;
		});
	}

	function applyMissionStatus(nextStatus: OperatorStatus, fallbackSelector: MissionSelector = selector()): MissionSelector {
		const nextSelector = selectorFromTowerState(nextStatus, systemSnapshot(), fallbackSelector);
		if (nextStatus.system) {
			applySystemSnapshot(nextStatus.system);
		}
		setStatus(nextStatus);
		setSelector(nextSelector);
		return nextSelector;
	}

	function handleAirportState(nextSystem: MissionSystemSnapshot): void {
		applySystemSnapshot(nextSystem);
	}

	function handleMissionStatus(nextStatus: OperatorStatus, fallbackSelector?: MissionSelector): MissionSelector {
		setDaemonState('connected');
		return applyMissionStatus(nextStatus, fallbackSelector);
	}

	async function connectClient(nextSelector: MissionSelector = selector(), surfacePath?: string): Promise<DaemonClient | undefined> {
		setDaemonState('booting');
		try {
			const nextConnection = await options.connect({ selector: nextSelector, ...(surfacePath ? { surfacePath } : {}) });
			await replaceConnection(nextConnection);
			applySystemSnapshot(nextConnection.snapshot);
			applyMissionStatus(nextConnection.status, nextSelector);
			setDaemonState('connected');
			options.onLog(
				nextConnection.status.found
					? `Connected to ${nextConnection.status.missionId ?? nextSelector.missionId ?? 'the selected mission'}.`
					: describeControlConnection(nextConnection.status)
			);
			return nextConnection.client;
		} catch (error) {
			await replaceConnection(undefined);
			setDaemonState('degraded');
			options.onLog(toErrorMessage(error));
			return undefined;
		}
	}

	async function withDaemonClientRetry<TResult>(
		nextSelector: MissionSelector,
		run: (currentClient: DaemonClient) => Promise<TResult>
	): Promise<TResult> {
		const initialClient = client() ?? (await connectClient(nextSelector));
		if (!initialClient) {
			throw new Error('Unable to connect to the Mission daemon.');
		}

		try {
			return await run(initialClient);
		} catch (error) {
			if (!isRecoverableDaemonDisconnect(error)) {
				throw error;
			}
			await replaceConnection(undefined);
			const reconnectedClient = await connectClient(nextSelector);
			if (!reconnectedClient) {
				throw error;
			}
			return run(reconnectedClient);
		}
	}

	async function executeActionById(
		actionId: string,
		steps: OperatorActionExecutionStep[],
		nextSelector: MissionSelector = {}
	) {
		const nextStatus = await withDaemonClientRetry(nextSelector, async (currentClient) => {
			const api = new DaemonApi(currentClient);
			const terminalSessionName = process.env['AIRPORT_TERMINAL_SESSION']?.trim()
				|| process.env['AIRPORT_TERMINAL_SESSION_NAME']?.trim();
			return Object.keys(nextSelector).length > 0
				? await api.mission.executeAction(nextSelector, actionId, steps, {
					...(terminalSessionName ? { terminalSessionName } : {})
				})
				: await api.control.executeAction(actionId, steps);
		});
		applyMissionStatus(nextStatus, nextSelector);
		setDaemonState('connected');
		return { status: nextStatus };
	}

	async function loadControlFlowDescriptor(
		actionId: string,
		steps: OperatorActionExecutionStep[],
		nextSelector: MissionSelector
	): Promise<OperatorActionFlowDescriptor> {
		const currentClient = client() ?? (await connectClient(nextSelector));
		if (!currentClient) {
			throw new Error('Unable to connect to resolve the Mission command flow.');
		}
		return new DaemonApi(currentClient).control.describeActionFlow(actionId, steps);
	}

	function dispose(): void {
		connection()?.dispose();
	}

	return {
		selector,
		status,
		systemSnapshot,
		systemDomain,
		daemonState,
		client,
		handleAirportState,
		handleMissionStatus,
		connectClient,
		executeActionById,
		loadControlFlowDescriptor,
		dispose,
	};
}