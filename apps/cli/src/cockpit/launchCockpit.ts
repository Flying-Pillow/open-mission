import {
	DaemonApi,
	DaemonMissionApi,
	readMissionDaemonSettings,
	type MissionSelector
} from '@flying-pillow/mission-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCockpitWorkspaceContext } from '../commands/daemonClient.js';
import type { CommandContext } from '../commands/types.js';
import {
	connectSurfaceDaemon,
	resolveSurfaceDaemonLaunchMode
} from '../daemon/connectSurfaceDaemon.js';
import { applyCockpitTheme, type CockpitThemeName } from './components/cockpitTheme.js';
import { playMissionStartupBanner } from './components/MissionStartupBanner.js';

export async function launchCockpit(context: CommandContext): Promise<void> {
	if (
		context.args.includes('--help') ||
		context.args.includes('-h') ||
		context.args.includes('help')
	) {
		process.stdout.write('mission [--hmr] [--banner] [--no-banner]\n');
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
			throw new Error(`Unsupported cockpit flag '${token}'. Mission only accepts bare flags here.`);
		}
		if (!supportedFlags.has(flag)) {
			throw new Error(`Unsupported cockpit flag '${token}'. Supported flags: --hmr, --banner, --no-banner.`);
		}
		flags.add(flag);
	}

	if (flags.has('hmr')) {
		await runCockpitWithHmr(context, context.args);
		return;
	}

	const workspaceContext = resolveCockpitWorkspaceContext(context);
	const selector = workspaceContext.selector;
	const configuredTheme = readMissionDaemonSettings(context.controlRoot)?.cockpitTheme;
	const initialTheme: CockpitThemeName = configuredTheme === 'sand' || configuredTheme === 'mono' || configuredTheme === 'paper' || configuredTheme === 'ocean'
		? configuredTheme
		: 'ocean';
	applyCockpitTheme(initialTheme);
	const connect = async (nextSelector: MissionSelector = selector) => {
		const client = await connectSurfaceDaemon({
			surfacePath: context.launchCwd,
			launchMode: resolveSurfaceDaemonLaunchMode(import.meta.url)
		});
		const api = new DaemonApi(client);
		const discoveryStatus = await api.control.getStatus();
		const status = nextSelector.missionId
			? await api.mission.getStatus(nextSelector)
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
			'Mission cockpit currently requires Bun because @opentui/core imports bun:ffi at runtime. Install Bun and relaunch the cockpit, or use non-cockpit Mission commands from Node.'
		);
	}

	if (flags.has('banner') && !flags.has('no-banner')) {
		await playMissionStartupBanner();
	}

	const { runCockpitApp } = await import('./runCockpitApp.js');

	try {
		await runCockpitApp({
			initialSelector,
			initialTheme,
			workspaceContext,
			...(initialConnection ? { initialConnection } : {}),
			...(initialConnectionError ? { initialConnectionError } : {}),
			connect
		});
	} finally {
		initialConnection?.dispose();
	}
}

async function runCockpitWithHmr(
	context: CommandContext,
	args: string[]
): Promise<void> {
	const cliRoot = resolveCliPackageRoot();
	const forwardedArgs = args.filter((arg) => arg !== '--hmr');
	const child = spawn(
		'pnpm',
		[
			'--dir',
			cliRoot,
			'exec',
			'tsx',
			'watch',
			'src/index.ts',
			'--',
			...forwardedArgs
		],
		{
			stdio: 'inherit',
			env: {
				...process.env,
				MISSION_CONTROL_ROOT: context.controlRoot,
				MISSION_LAUNCH_CWD: context.launchCwd
			}
		}
	);

	await new Promise<void>((resolve, reject) => {
		child.once('error', reject);
		child.once('close', (code) => {
			if ((code ?? 0) === 0) {
				resolve();
				return;
			}
			reject(new Error(`Mission cockpit HMR exited with code ${String(code ?? 'unknown')}.`));
		});
	});
}

function resolveCliPackageRoot(): string {
	const launchCockpitPath = fileURLToPath(import.meta.url);
	return path.resolve(path.dirname(launchCockpitPath), '..', '..');
}