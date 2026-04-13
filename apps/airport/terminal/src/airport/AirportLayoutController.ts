import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readMissionUserConfig } from '@flying-pillow/mission-core';
import { resolveAirportCompanionPaneDirection } from './airportLayoutDefinition.js';

const execFileAsync = promisify(execFile);
const RUNWAY_PANE_TITLE = 'RUNWAY';

type RunwayTarget = {
	terminalSessionName: string;
	terminalPaneId?: string;
};

type TerminalPaneMetadata = {
	id: number;
	title: string;
	is_plugin: boolean;
	is_focused?: boolean;
	is_suppressed?: boolean;
	tab_id?: number;
	pane_columns?: number;
};

type TabInfoSnapshot = {
	tab_id?: number;
	viewport_columns?: number;
	display_area_columns?: number;
};

type AirportLayoutControllerOptions = {
	controlRoot: () => string;
	onError: (message: string) => void;
};

export function createAirportLayoutController(options: AirportLayoutControllerOptions) {
	const terminalSessionName = process.env['AIRPORT_TERMINAL_SESSION']?.trim()
		|| process.env['AIRPORT_TERMINAL_SESSION_NAME']?.trim();
	const terminalBinary = process.env['AIRPORT_TERMINAL_BINARY']?.trim()
		|| readMissionUserConfig()?.terminalBinary?.trim()
		|| 'zellij';
	let disposed = false;
	let currentTargetKey: string | undefined;
	let currentRunwayDirection: 'down' | 'right' | undefined;
	let lastRequestedKey = '__initial__';
	let serial = Promise.resolve();

	function sync(target: RunwayTarget | undefined): void {
		const nextKey = serializeTarget(target);
		if (nextKey === lastRequestedKey && target === undefined) {
			return;
		}
		lastRequestedKey = nextKey;
		queueReconcile(target, nextKey);
	}

	function dispose(): void {
		disposed = true;
	}

	function queueReconcile(target: RunwayTarget | undefined, requestKey: string): void {
		serial = serial
			.then(() => reconcile(target, requestKey))
			.catch((error: unknown) => {
				options.onError(error instanceof Error ? error.message : String(error));
			});
	}

	async function reconcile(target: RunwayTarget | undefined, requestKey: string): Promise<void> {
		if (disposed || requestKey !== lastRequestedKey) {
			return;
		}

		const tabInfo = await getCurrentTabInfo();
		const currentTabId = typeof tabInfo?.tab_id === 'number' ? tabInfo.tab_id : undefined;
		let panes = await listPanes(currentTabId);
		let existingPane = panes.find((pane) => pane.title === RUNWAY_PANE_TITLE && !pane.is_suppressed);
		if (!target) {
			if (existingPane) {
				await removePane(existingPane.id);
			}
			currentTargetKey = undefined;
			currentRunwayDirection = undefined;
			return;
		}

		let briefingRoomPane = panes.find((pane) => pane.title === 'BRIEFING ROOM' && !pane.is_suppressed);
		if (!briefingRoomPane) {
			return;
		}
		let runwayPaneDirection = resolveAirportCompanionPaneDirection(
			briefingRoomPane.pane_columns ?? tabInfo?.viewport_columns ?? tabInfo?.display_area_columns
		);
		const needsRunwayRestart = currentTargetKey !== requestKey;
		if (needsRunwayRestart && existingPane) {
			await removePane(existingPane.id);
			existingPane = undefined;
			panes = await listPanes(currentTabId);
			briefingRoomPane = panes.find((pane) => pane.title === 'BRIEFING ROOM' && !pane.is_suppressed);
			if (!briefingRoomPane) {
				return;
			}
			runwayPaneDirection = resolveAirportCompanionPaneDirection(
				briefingRoomPane.pane_columns ?? tabInfo?.viewport_columns ?? tabInfo?.display_area_columns
			);
		}

		if (!existingPane) {
			await createRunwayPane(target, briefingRoomPane, runwayPaneDirection);
			currentTargetKey = requestKey;
			currentRunwayDirection = runwayPaneDirection;
			return;
		}

		await setPaneBorderless(existingPane.id);

		if (currentTargetKey === requestKey && currentRunwayDirection === runwayPaneDirection) {
			return;
		}

		await removePane(existingPane.id);
		const refreshedPanes = await listPanes(currentTabId);
		const refreshedBriefingRoomPane = refreshedPanes.find((pane) => pane.title === 'BRIEFING ROOM' && !pane.is_suppressed);
		if (!refreshedBriefingRoomPane) {
			return;
		}
		runwayPaneDirection = resolveAirportCompanionPaneDirection(
			refreshedBriefingRoomPane.pane_columns ?? tabInfo?.viewport_columns ?? tabInfo?.display_area_columns
		);
		await createRunwayPane(target, refreshedBriefingRoomPane, runwayPaneDirection);
		currentTargetKey = requestKey;
		currentRunwayDirection = runwayPaneDirection;
	}

	async function createRunwayPane(
		target: RunwayTarget,
		briefingRoomPane: TerminalPaneMetadata,
		direction: 'down' | 'right'
	): Promise<void> {
		const panes = await listPanes();
		const previouslyFocusedPane = panes.find((pane) => pane.is_focused);

		if (!briefingRoomPane.is_focused) {
			try {
				await execTerminalAction(['focus-pane-id', toTerminalPaneReference(briefingRoomPane.id)]);
			} catch (error) {
				if (!isAlreadyFocusedPaneError(error) && !isMissingPaneError(error)) {
					throw error;
				}
			}
		}

		const launchCommand = buildRunwayLaunchCommand(target);
		const hostSessionName = terminalSessionName;
		if (!hostSessionName) {
			return;
		}
		try {
			const result = await execTerminalAction([
				'new-pane',
				'--direction',
				direction,
				'--borderless',
				'true',
				'--name',
				RUNWAY_PANE_TITLE,
				'--cwd',
				options.controlRoot(),
				'--',
				'sh',
				'-lc',
				`exec ${launchCommand}`
			]);
			const createdPaneReference = parseCreatedPaneReference(result.stdout);
			if (createdPaneReference) {
				await execTerminalAction(['set-pane-borderless', '--pane-id', createdPaneReference, '--borderless', 'true']).catch(() => undefined);
			}
		} finally {
			if (previouslyFocusedPane && previouslyFocusedPane.id !== briefingRoomPane.id) {
				await execTerminalAction(['focus-pane-id', toTerminalPaneReference(previouslyFocusedPane.id)]).catch(() => undefined);
			}
		}
	}

	async function setPaneBorderless(terminalPaneId: number): Promise<void> {
		await execTerminalAction([
			'set-pane-borderless',
			'--pane-id',
			toTerminalPaneReference(terminalPaneId),
			'--borderless',
			'true'
		]).catch(() => undefined);
	}

	async function removePane(terminalPaneId: number): Promise<void> {
		const paneReference = toTerminalPaneReference(terminalPaneId);
		const focusedPaneReference = await getFocusedPaneReference();
		if (focusedPaneReference !== paneReference) {
			await execTerminalAction(['focus-pane-id', paneReference]).catch((error) => {
				if (!isAlreadyFocusedPaneError(error) && !isMissingPaneError(error)) {
					throw error;
				}
			});
		}

		try {
			await execTerminalAction(['close-pane']).catch((error) => {
				if (!isMissingPaneError(error)) {
					throw error;
				}
			});
		} finally {
			if (focusedPaneReference && focusedPaneReference !== paneReference) {
				await execTerminalAction(['focus-pane-id', focusedPaneReference]).catch(() => undefined);
			}
		}
	}

	async function getFocusedPaneReference(): Promise<string | undefined> {
		const focusedPane = (await listPanes()).find((pane) => pane.is_focused);
		return focusedPane ? toTerminalPaneReference(focusedPane.id) : undefined;
	}

	async function getCurrentTabInfo(): Promise<TabInfoSnapshot | undefined> {
		const result = await execTerminalAction([
			'current-tab-info',
			'--json'
		]);
		const normalized = result.stdout.trim();
		if (!normalized || !normalized.startsWith('{')) {
			return undefined;
		}
		try {
			return JSON.parse(normalized) as TabInfoSnapshot;
		} catch {
			return undefined;
		}
	}

	async function listPanes(tabId?: number): Promise<TerminalPaneMetadata[]> {
		const result = await execTerminalAction([
			'list-panes',
			'--json',
			'--all'
		]);
		const normalized = result.stdout.trim();
		if (!normalized || !normalized.startsWith('[')) {
			return [];
		}
		try {
			return (JSON.parse(normalized) as TerminalPaneMetadata[])
				.filter((pane) => !pane.is_plugin)
				.filter((pane) => tabId === undefined || pane.tab_id === tabId);
		} catch {
			return [];
		}
	}

	function buildRunwayLaunchCommand(target: RunwayTarget): string {
		const entryPath = resolveEntryPath();
		const runtimeCommand = process.versions['bun']
			? [process.execPath, entryPath]
			: [readMissionUserConfig()?.bunBinary?.trim() || 'bun', entryPath];
		const shellParts = [
			'env',
			'\'AIRPORT_PANE_ID=runway\'',
			shellEscape(`MISSION_RUNWAY_TERMINAL_SESSION_NAME=${target.terminalSessionName}`),
			...(target.terminalPaneId ? [shellEscape(`MISSION_RUNWAY_TERMINAL_PANE_ID=${target.terminalPaneId}`)] : []),
			...(terminalSessionName ? [shellEscape(`AIRPORT_TERMINAL_SESSION=${terminalSessionName}`)] : []),
			shellEscape(`AIRPORT_TERMINAL_ENTRY_PATH=${entryPath}`),
			...runtimeCommand.map(shellEscape),
			'\'__airport-layout-runway-pane\''
		];
		return shellParts.join(' ');
	}

	function resolveEntryPath(): string {
		const explicitPath = process.env['AIRPORT_TERMINAL_ENTRY_PATH']?.trim();
		if (explicitPath) {
			return explicitPath;
		}
		const argvPath = process.argv[1]?.trim();
		if (!argvPath) {
			throw new Error('Airport terminal entry path is unavailable for local runway pane management.');
		}
		return argvPath;
	}

	async function execTerminalAction(actionArgs: string[]): Promise<{ stdout: string; stderr: string }> {
		return execTerminal([
			...(!terminalSessionName ? [] : ['--session', terminalSessionName]),
			'action',
			...actionArgs
		]);
	}

	async function execTerminal(args: string[]): Promise<{ stdout: string; stderr: string }> {
		return execFileAsync(terminalBinary, args, {
			encoding: 'utf8',
			env: { ...process.env, ZELLIJ: undefined }
		});
	}

	return {
		sync,
		dispose
	};
}

function serializeTarget(target: RunwayTarget | undefined): string {
	return target ? `${target.terminalSessionName}:${target.terminalPaneId ?? '__session__'}` : '__none__';
}

function toTerminalPaneReference(paneId: number): string {
	return `terminal_${String(paneId)}`;
}

function isAlreadyFocusedPaneError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes('already focused');
}

function isMissingPaneError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes('Pane with id') && message.includes('not found');
}

function shellEscape(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function parseCreatedPaneReference(output: string): string | undefined {
	const normalized = output.trim();
	if (!normalized) {
		return undefined;
	}
	return /^((terminal|plugin)_\d+)$/u.test(normalized) ? normalized : undefined;
}