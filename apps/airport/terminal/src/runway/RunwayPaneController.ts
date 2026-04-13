import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readMissionUserConfig } from '@flying-pillow/mission-core';

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
};

type RunwayPaneControllerOptions = {
	controlRoot: () => string;
	onError: (message: string) => void;
};

export function createRunwayPaneController(options: RunwayPaneControllerOptions) {
	const terminalSessionName = process.env['AIRPORT_TERMINAL_SESSION']?.trim()
		|| process.env['AIRPORT_TERMINAL_SESSION_NAME']?.trim();
	const terminalBinary = process.env['AIRPORT_TERMINAL_BINARY']?.trim()
		|| readMissionUserConfig()?.terminalBinary?.trim()
		|| 'zellij';
	let disposed = false;
	let currentTargetKey: string | undefined;
	let lastRequestedKey = '__initial__';
	let serial = Promise.resolve();

	function sync(target: RunwayTarget | undefined): void {
		const nextKey = serializeTarget(target);
		if (nextKey === lastRequestedKey) {
			return;
		}
		lastRequestedKey = nextKey;
		serial = serial
			.then(() => reconcile(target, nextKey))
			.catch((error: unknown) => {
				options.onError(error instanceof Error ? error.message : String(error));
			});
	}

	function dispose(): void {
		disposed = true;
	}

	async function reconcile(target: RunwayTarget | undefined, requestKey: string): Promise<void> {
		if (disposed || !terminalSessionName || requestKey !== lastRequestedKey) {
			return;
		}

		const existingPane = await findRunwayPane();
		if (!target) {
			if (existingPane) {
				await removePane(existingPane.id);
			}
			currentTargetKey = undefined;
			return;
		}

		if (existingPane && currentTargetKey === requestKey) {
			return;
		}

		if (existingPane) {
			await removePane(existingPane.id);
		}

		if (disposed || requestKey !== lastRequestedKey) {
			return;
		}

		await createPane(target);
		currentTargetKey = requestKey;
	}

	async function createPane(target: RunwayTarget): Promise<void> {
		const panes = await listPanes();
		const previouslyFocusedPane = panes.find((pane) => pane.is_focused);
		const briefingRoomPane = panes.find((pane) => pane.title === 'BRIEFING ROOM' && !pane.is_suppressed)
			?? panes.find((pane) => !pane.is_suppressed)
			?? panes[0];
		if (!briefingRoomPane) {
			return;
		}

		if (!briefingRoomPane.is_focused) {
			try {
				await execTerminalAction(['focus-pane-id', toTerminalPaneReference(briefingRoomPane.id)]);
			} catch (error) {
				if (!isAlreadyFocusedPaneError(error) && !isMissingPaneError(error)) {
					throw error;
				}
			}
		}

		const launchCommand = buildLaunchCommand(target);
		const hostSessionName = terminalSessionName;
		if (!hostSessionName) {
			return;
		}
		try {
			const result = await execTerminal([
				'--session',
				hostSessionName,
				'action',
				'new-pane',
				'--direction',
				'down',
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
				await execTerminalAction(['set-pane-borderless', '--pane-id', createdPaneReference, '--borderless']).catch(() => undefined);
				await execTerminalAction(['move-pane', '--pane-id', createdPaneReference, 'up']).catch(() => undefined);
				for (let attempt = 0; attempt < 4; attempt += 1) {
					await execTerminalAction(['resize', '--pane-id', createdPaneReference, 'increase', 'down']).catch(() => undefined);
				}
			}
		} finally {
			if (previouslyFocusedPane && previouslyFocusedPane.id !== briefingRoomPane.id) {
				await execTerminalAction(['focus-pane-id', toTerminalPaneReference(previouslyFocusedPane.id)]).catch(() => undefined);
			}
		}
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

	async function findRunwayPane(): Promise<TerminalPaneMetadata | undefined> {
		return (await listPanes()).find((pane) => pane.title === RUNWAY_PANE_TITLE && !pane.is_suppressed);
	}

	async function listPanes(): Promise<TerminalPaneMetadata[]> {
		if (!terminalSessionName) {
			return [];
		}
		const result = await execTerminal([
			'--session',
			terminalSessionName,
			'action',
			'list-panes',
			'--json',
			'--all'
		]);
		const normalized = result.stdout.trim();
		if (!normalized || !normalized.startsWith('[')) {
			return [];
		}
		try {
			return (JSON.parse(normalized) as TerminalPaneMetadata[]).filter((pane) => !pane.is_plugin);
		} catch {
			return [];
		}
	}

	function buildLaunchCommand(target: RunwayTarget): string {
		const entryPath = resolveEntryPath();
		const runtimeCommand = process.versions['bun'] ? [process.execPath, entryPath] : ['bun', entryPath];
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

	async function execTerminalAction(actionArgs: string[]): Promise<void> {
		if (!terminalSessionName) {
			return;
		}
		await execTerminal(['--session', terminalSessionName, 'action', ...actionArgs]);
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