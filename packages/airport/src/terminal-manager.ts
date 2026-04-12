import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AirportSubstrateEffect } from './effects.js';
import type { AirportPaneId, AirportPaneState, AirportState, AirportSubstrateState } from './types.js';

const execFileAsync = promisify(execFile);

const PANE_DISPLAY_TITLES: Record<AirportPaneId, string> = {
	tower: 'TOWER',
	briefingRoom: 'BRIEFING ROOM',
	runway: 'RUNWAY'
};

type TerminalManagerPaneMetadata = {
	id: number;
	title: string;
	tabId?: number;
	tab_id?: number;
	is_plugin: boolean;
	is_focused?: boolean;
	is_suppressed?: boolean;
};

type TerminalManagerExecutorResult = {
	stdout: string;
	stderr: string;
};

type TerminalManagerExecutor = (args: string[]) => Promise<TerminalManagerExecutorResult>;

export interface AirportSubstrateController {
	getState(): AirportSubstrateState;
	observe(state: AirportState): Promise<AirportSubstrateState>;
	applyEffects(effects: AirportSubstrateEffect[]): Promise<AirportSubstrateState>;
}

export type TerminalManagerSubstrateOptions = {
	sessionName: string;
	executor?: TerminalManagerExecutor;
	terminalBinary?: string;
};

export class TerminalManagerSubstrateController implements AirportSubstrateController {
	private state: AirportSubstrateState;
	private readonly executor: TerminalManagerExecutor;

	public constructor(options: TerminalManagerSubstrateOptions) {
		this.state = createDefaultTerminalManagerSubstrateState(options);
		const terminalBinary = options.terminalBinary?.trim() || process.env['AIRPORT_TERMINAL_BINARY']?.trim() || 'zellij';
		this.executor = options.executor ?? (async (args) => {
			const result = await execFileAsync(terminalBinary, args, {
				encoding: 'utf8',
				env: { ...process.env, ZELLIJ: undefined }
			});
			return {
				stdout: result.stdout,
				stderr: result.stderr
			};
		});
	}

	public getState(): AirportSubstrateState {
		return structuredClone(this.state);
	}

	public async observe(state: AirportState): Promise<AirportSubstrateState> {
		const now = new Date().toISOString();
		const panes = await this.listPanes().catch(() => undefined);
		this.state = panes
			? buildObservedState(state, panes, now)
			: buildDetachedState(state, now);
		return this.getState();
	}

	public async applyEffects(effects: AirportSubstrateEffect[]): Promise<AirportSubstrateState> {
		for (const effect of effects) {
			switch (effect.kind) {
				case 'focus-pane': {
					try {
						await this.executor([
							'--session',
							this.state.sessionName,
							'action',
							'focus-pane-id',
							toTerminalPaneReference(effect.terminalPaneId)
						]);
					} catch (error) {
						if (isAlreadyFocusedPaneError(error)) {
							continue;
						}
						throw error;
					}
					break;
				}
				case 'ensure-pane': {
					await this.ensureRunwayPane();
					break;
				}
				case 'remove-pane': {
					await this.removePane(toTerminalPaneReference(effect.terminalPaneId));
					break;
				}
			}
		}
		this.state = {
			...this.state,
			lastAppliedAt: new Date().toISOString()
		};
		return this.getState();
	}

	private async ensureRunwayPane(): Promise<void> {
		const panes = await this.listPanes();
		const existingRunwayPane = panes.find((pane) => pane.title === PANE_DISPLAY_TITLES.runway && !pane.is_suppressed);
		if (existingRunwayPane) {
			return;
		}

		const briefingRoomPane = panes.find((pane) => pane.title === PANE_DISPLAY_TITLES.briefingRoom && !pane.is_suppressed)
			?? panes.find((pane) => !pane.is_suppressed)
			?? panes[0];
		if (!briefingRoomPane) {
			throw new Error(`Unable to locate a target pane to create '${PANE_DISPLAY_TITLES.runway}'.`);
		}

		const controlRoot = process.env['MISSION_CONTROL_ROOT']?.trim()
			|| process.env['MISSION_SURFACE_PATH']?.trim()
			|| process.cwd();
		const airportTerminalEntryPath = resolveAirportTerminalEntryPath();
		const launchCommand = [
			'env',
			'\'AIRPORT_PANE_ID=runway\'',
			shellEscape(`AIRPORT_TERMINAL_SESSION=${this.state.sessionName}`),
			shellEscape(`AIRPORT_TERMINAL_ENTRY_PATH=${airportTerminalEntryPath}`),
			...resolveAirportPaneRuntimeCommand(airportTerminalEntryPath).map(shellEscape),
			'\'__airport-layout-runway-pane\''
		].join(' ');

		await this.executor([
			'--session',
			this.state.sessionName,
			'action',
			'new-pane',
			'--in-place',
			toTerminalPaneReference(briefingRoomPane.id),
			'--name',
			PANE_DISPLAY_TITLES.runway,
			'--cwd',
			controlRoot,
			'--',
			'sh',
			'-lc',
			`exec ${launchCommand}`
		]);
	}

	private async removePane(paneId: string): Promise<void> {
		const previouslyFocusedPane = await this.getFocusedPaneId();
		if (previouslyFocusedPane !== paneId) {
			await this.executor([
				'--session',
				this.state.sessionName,
				'action',
				'focus-pane-id',
				paneId
			]);
		}

		try {
			await this.executor([
				'--session',
				this.state.sessionName,
				'action',
				'close-pane'
			]);
		} finally {
			if (previouslyFocusedPane && previouslyFocusedPane !== paneId) {
				await this.executor([
					'--session',
					this.state.sessionName,
					'action',
					'focus-pane-id',
					previouslyFocusedPane
				]).catch(() => {
					// Best effort focus restoration.
				});
			}
		}
	}

	private async getFocusedPaneId(): Promise<string | undefined> {
		const panes = await this.listPanes();
		const focusedPane = panes.find((pane) => pane.is_focused);
		return focusedPane ? toTerminalPaneReference(focusedPane.id) : undefined;
	}

	private async listPanes(): Promise<TerminalManagerPaneMetadata[]> {
		const result = await this.executor([
			'--session',
			this.state.sessionName,
			'action',
			'list-panes',
			'--json',
			'--all'
		]);
		return (JSON.parse(result.stdout) as TerminalManagerPaneMetadata[]).filter((pane) => !pane.is_plugin);
	}
}

export class InMemoryTerminalManagerSubstrateController implements AirportSubstrateController {
	private state: AirportSubstrateState;

	public constructor(options: { sessionName: string }) {
		this.state = createDefaultTerminalManagerSubstrateState(options);
	}

	public getState(): AirportSubstrateState {
		return structuredClone(this.state);
	}

	public observe(_state: AirportState): Promise<AirportSubstrateState> {
		const now = new Date().toISOString();
		this.state = {
			...this.state,
			attached: true,
			lastObservedAt: now
		};
		return Promise.resolve(this.getState());
	}

	public applyEffects(effects: AirportSubstrateEffect[]): Promise<AirportSubstrateState> {
		const focusEffect = effects.find((effect) => effect.kind === 'focus-pane');
		this.state = {
			...this.state,
			...(focusEffect ? { observedFocusedTerminalPaneId: focusEffect.terminalPaneId } : {}),
			lastAppliedAt: new Date().toISOString()
		};
		return Promise.resolve(this.getState());
	}
}


export function createDefaultTerminalManagerSubstrateState(options: { sessionName: string }): AirportSubstrateState {
	const sessionName = options.sessionName.trim();
	if (!sessionName) {
		throw new Error('Airport substrate requires a repository-scoped terminal session name.');
	}

	return {
		kind: 'terminal-manager',
		sessionName,
		layoutIntent: 'mission-control-v1',
		attached: false,
		panes: {}
	};
}

function buildObservedState(
	state: AirportState,
	panes: TerminalManagerPaneMetadata[],
	now: string
): AirportSubstrateState {
	const currentState = state.substrate;
	const focusedPaneId = panes.find((pane) => pane.is_focused)?.id;
	const panesById = Object.fromEntries(
		(Object.keys(PANE_DISPLAY_TITLES) as AirportPaneId[]).map((paneId) => {
			const expected = isAirportPaneExpected(state, paneId);
			const currentPane = currentState.panes[paneId];
			const pane = currentPane?.terminalPaneId !== undefined && currentPane.terminalPaneId >= 0
				? panes.find((candidate) => candidate.id === currentPane.terminalPaneId)
				: panes.find((candidate) => candidate.title === PANE_DISPLAY_TITLES[paneId]);
			return [
				paneId,
				pane
					? {
						terminalPaneId: pane.id,
						expected,
						exists: true,
						title: pane.title
					}
					: {
						terminalPaneId: currentPane?.terminalPaneId ?? -1,
						expected,
						exists: false,
						title: currentPane?.title ?? PANE_DISPLAY_TITLES[paneId]
					}
			] as const;
		})
	) as Partial<Record<AirportPaneId, AirportPaneState>>;

	return {
		...currentState,
		attached: true,
		panes: panesById,
		...(currentState.lastAppliedAt ? { lastAppliedAt: currentState.lastAppliedAt } : {}),
		lastObservedAt: now,
		...(focusedPaneId !== undefined
			? { observedFocusedTerminalPaneId: focusedPaneId }
			: {})
	};
}

function buildDetachedState(state: AirportState, now: string): AirportSubstrateState {
	const currentState = state.substrate;
	return {
		kind: currentState.kind,
		sessionName: currentState.sessionName,
		layoutIntent: currentState.layoutIntent,
		attached: false,
		panes: Object.fromEntries(
			(Object.keys(PANE_DISPLAY_TITLES) as AirportPaneId[]).map((paneId) => [
				paneId,
				{
					terminalPaneId: currentState.panes[paneId]?.terminalPaneId ?? -1,
					expected: isAirportPaneExpected(state, paneId),
					exists: false,
					title: currentState.panes[paneId]?.title ?? PANE_DISPLAY_TITLES[paneId]
				}
			])
		) as Partial<Record<AirportPaneId, AirportPaneState>>,
		...(currentState.lastAppliedAt ? { lastAppliedAt: currentState.lastAppliedAt } : {}),
		lastObservedAt: now
	};
}

function toTerminalPaneReference(paneId: number): string {
	return `terminal_${String(paneId)}`;
}

function resolveAirportTerminalEntryPath(): string {
	const airportTerminalEntryPath = process.env['AIRPORT_TERMINAL_ENTRY_PATH']?.trim();
	if (!airportTerminalEntryPath) {
		throw new Error('AIRPORT_TERMINAL_ENTRY_PATH must be set before opening Airport runway panes.');
	}
	return airportTerminalEntryPath;
}

function resolveAirportPaneRuntimeCommand(entryScriptPath: string): string[] {
	if (process.versions['bun']) {
		return [process.execPath, entryScriptPath];
	}
	return ['bun', entryScriptPath];
}

function isAlreadyFocusedPaneError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes('already focused');
}

function isAirportPaneExpected(state: AirportState, paneId: AirportPaneId): boolean {
	if (paneId === 'runway') {
		return state.panes.runway.targetKind === 'agentSession';
	}
	return true;
}

function shellEscape(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
