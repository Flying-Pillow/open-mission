import {
	DaemonApi,
	DaemonMissionApi,
	readMissionDaemonSettings,
	type MissionSelector
} from '@flying-pillow/mission-core';
import { resolveTowerWorkspaceContext } from '../commands/daemonClient.js';
import type { CommandContext } from '../commands/types.js';
import {
	connectSurfaceDaemon,
	resolveSurfaceDaemonLaunchMode
} from '../daemon/connectSurfaceDaemon.js';
import { applyTowerTheme, type TowerThemeName } from './components/towerTheme.js';
import { playMissionStartupBanner } from './components/MissionStartupBanner.js';

function resolveInjectedGateId(): 'dashboard' | 'editor' | 'pilot' {
	const gateId = process.env['MISSION_GATE_ID']?.trim();
	if (gateId === 'dashboard' || gateId === 'editor' || gateId === 'pilot') {
		return gateId;
	}
	throw new Error('MISSION_GATE_ID must be set to dashboard, editor, or pilot before launching a tower panel.');
}

export async function launchTower(context: CommandContext): Promise<void> {
	const hmrMode = context.args.includes('--hmr') || process.env['MISSION_TOWER_HMR'] === '1';
	if (
		context.args.includes('--help') ||
		context.args.includes('-h') ||
		context.args.includes('help')
	) {
		process.stdout.write('mission [--hmr] [--banner] [--no-banner]\n');
		process.stdout.write('zellij layout: Mission tower | pilot pane | micro\n');
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

	const launchMode = resolveSurfaceDaemonLaunchMode(import.meta.url);

	const workspaceContext = resolveTowerWorkspaceContext(context);
	const selector = workspaceContext.selector;
	const configuredTheme = readMissionDaemonSettings(context.controlRoot)?.towerTheme;
	const initialTheme: TowerThemeName = configuredTheme === 'sand' || configuredTheme === 'mono' || configuredTheme === 'paper' || configuredTheme === 'ocean'
		? configuredTheme
		: 'ocean';
	applyTowerTheme(initialTheme);
	const connect = async (nextSelector: MissionSelector = selector) => {
		const client = await connectSurfaceDaemon({
			surfacePath: context.launchCwd,
			launchMode
		});
		const api = new DaemonApi(client);
		await api.airport.connectPanel({
			gateId: resolveInjectedGateId(),
			label: 'mission-tower',
			panelProcessId: String(process.pid),
			...(process.env['MISSION_TERMINAL_SESSION']?.trim()
				? { terminalSessionName: process.env['MISSION_TERMINAL_SESSION']?.trim() }
				: {})
		});
		const discoveryStatus = await api.control.getStatus();
		const resolvedSelector = DaemonMissionApi.selectorFromStatus(discoveryStatus, nextSelector);
		const status = resolvedSelector.missionId
			? await api.mission.getStatus(resolvedSelector)
			: discoveryStatus;
		return {
			client,
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
		initialConnection = await connect(selector);
		initialSelector = DaemonMissionApi.selectorFromStatus(initialConnection.status, selector);
	} catch (error) {
		initialConnectionError = error instanceof Error ? error.message : String(error);
	}

	if (!process.versions['bun']) {
		throw new Error(
			'Mission tower currently requires Bun because @opentui/core imports bun:ffi at runtime. Install Bun and relaunch the tower, or use non-tower Mission commands from Node.'
		);
	}

	if (flags.has('banner') && !flags.has('no-banner')) {
		await playMissionStartupBanner();
	}

	const { runTowerApp } = await import('./runTowerApp.js');

	try {
		await runTowerApp({
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