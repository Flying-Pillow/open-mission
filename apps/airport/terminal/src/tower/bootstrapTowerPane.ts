import {
	DaemonApi,
	DaemonMissionApi,
	type MissionSystemSnapshot,
	readMissionDaemonSettings,
	type MissionSelector
} from '@flying-pillow/mission-core';
import { connectAirportControl, resolveAirportControlRuntimeMode } from '../airport/connectAirportControl.js';
import { createPaneConnectParams } from '../airport/createPaneConnectParams.js';
import type { AirportTerminalContext } from '../airportTerminalContext.js';
import {
} from '../airport/connectAirportControl.js';
import { applyTowerTheme, type TowerThemeName } from './components/towerTheme.js';
import { resolveTowerWorkspaceContext } from './resolveTowerWorkspaceContext.js';

function resolveInjectedPaneId(): 'tower' {
	const paneId = process.env['AIRPORT_PANE_ID']?.trim();
	if (paneId === 'tower') {
		return paneId;
	}
	throw new Error('AIRPORT_PANE_ID must be set to tower before starting the Tower pane.');
}

export type TowerConnectRequest = {
	selector?: MissionSelector;
	surfacePath?: string;
};

export async function bootstrapTowerPane(context: AirportTerminalContext): Promise<void> {
	const hmrMode = context.args.includes('--hmr') || process.env['MISSION_TOWER_HMR'] === '1';
	if (
		context.args.includes('--help') ||
		context.args.includes('-h') ||
		context.args.includes('help')
	) {
		process.stdout.write('mission [--hmr] [--banner] [--no-banner]\n');
		process.stdout.write('airport layout: Mission tower | execution details (editor + dynamic agent pane)\n');
		return;
	}

	const flags = new Set<string>();
	const supportedFlags = new Set(['hmr', 'banner', 'no-banner']);
	for (let index = 0; index < context.args.length; index += 1) {
		const token = context.args[index];
		if (!token?.startsWith('--')) {
			continue;
		}

		const flag = token.slice(2);
		if (!flag) {
			continue;
		}
		if (flag.includes('=')) {
			throw new Error(`Unsupported tower flag '${token}'. Mission only accepts bare flags here.`);
		}
		if (!supportedFlags.has(flag)) {
			throw new Error(`Unsupported tower flag '${token}'. Supported flags: --hmr, --banner, --no-banner.`);
		}
		flags.add(flag);
	}

	const runtimeMode = resolveAirportControlRuntimeMode(import.meta.url);

	const workspaceContext = resolveTowerWorkspaceContext(context);
	const selector = workspaceContext.selector;
	const paneId = resolveInjectedPaneId();
	const configuredTheme = readMissionDaemonSettings(context.controlRoot)?.towerTheme;
	const initialTheme: TowerThemeName = configuredTheme === 'sand' || configuredTheme === 'mono' || configuredTheme === 'paper' || configuredTheme === 'ocean'
		? configuredTheme
		: 'ocean';
	applyTowerTheme(initialTheme);
	const connect = async ({ selector: nextSelector = selector, surfacePath = context.workingDirectory }: TowerConnectRequest = {}) => {
		const client = await connectAirportControl({
			surfacePath,
			runtimeMode
		});
		const api = new DaemonApi(client);
		const snapshot = await api.airport.connectPane(
			createPaneConnectParams(paneId, `mission-${paneId}`)
		);
		const discoveryStatus = await api.control.getStatus();
		const resolvedSelector = selectorFromConnection(discoveryStatus, snapshot, nextSelector);
		const status = resolvedSelector.missionId
			? await api.mission.getStatus(resolvedSelector)
			: discoveryStatus;
		return {
			client,
			snapshot,
			status,
			dispose: () => {
				client.dispose();
			}
		};
	};

	let initialConnection: Awaited<ReturnType<typeof connect>> | undefined;
	let initialConnectionError: string | undefined;
	let initialSelector = selector;
	try {
		initialConnection = await connect({ selector });
		initialSelector = selectorFromConnection(initialConnection.status, initialConnection.snapshot, selector);
	} catch (error) {
		initialConnectionError = error instanceof Error ? error.message : String(error);
	}

	if (!process.versions['bun']) {
		throw new Error(
			'Airport terminal surfaces currently require Bun because @opentui/core imports bun:ffi at runtime. Install Bun and relaunch the Airport layout, or continue using missiond and other non-terminal Mission commands from Node.'
		);
	}

	if (flags.has('banner') && !flags.has('no-banner')) {
		const { playMissionStartupBanner } = await import('./components/MissionStartupBanner.js');
		await playMissionStartupBanner();
	}

	const { mountTowerUi } = await import('./mountTowerUi.js');

	try {
		await mountTowerUi({
			initialSelector,
			initialTheme,
			initialShowIntroSplash: !hmrMode,
			workspaceContext,
			...(initialConnection ? { initialConnection } : {}),
			...(initialConnectionError ? { initialConnectionError } : {}),
			connect
		});
	} finally {
		initialConnection?.dispose();
	}
}

function selectorFromConnection(
	status: Awaited<ReturnType<DaemonApi['control']['getStatus']>>,
	snapshot: MissionSystemSnapshot,
	fallback: MissionSelector
): MissionSelector {
	const projectedMissionId = snapshot.airportProjections.tower.missionId;
	if (projectedMissionId) {
		return { missionId: projectedMissionId };
	}
	return DaemonMissionApi.selectorFromStatus(status, fallback);
}