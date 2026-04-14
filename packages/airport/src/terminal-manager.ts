import { execFile } from 'node:child_process';
import { performance } from 'node:perf_hooks';
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
		const startedAt = performance.now();
		const now = new Date().toISOString();
		const panes = await this.listPanes().catch(() => undefined);
		this.state = panes
			? buildObservedState(state, panes, now)
			: buildDetachedState(state, now);
		const durationMs = performance.now() - startedAt;
		process.stdout.write(
			`${new Date().toISOString().slice(11, 19)} terminal-manager.observe session=${this.state.sessionName} attached=${String(Boolean(panes))} duration=${durationMs.toFixed(1)}ms paneCount=${String(panes?.length ?? 0)}\n`
		);
		return this.getState();
	}

	public async applyEffects(effects: AirportSubstrateEffect[]): Promise<AirportSubstrateState> {
		const startedAt = performance.now();
		for (const effect of effects) {
			try {
				await this.executor([
					'--session',
					this.state.sessionName,
					'action',
					'focus-pane-id',
					toTerminalPaneReference(effect.terminalPaneId)
				]);
			} catch (error) {
				if (isAlreadyFocusedPaneError(error) || isMissingPaneError(error)) {
					continue;
				}
				throw error;
			}
		}
		this.state = {
			...this.state,
			lastAppliedAt: new Date().toISOString()
		};
		const durationMs = performance.now() - startedAt;
		process.stdout.write(
			`${new Date().toISOString().slice(11, 19)} terminal-manager.applyEffects session=${this.state.sessionName} effects=${String(effects.length)} duration=${durationMs.toFixed(1)}ms\n`
		);
		return this.getState();
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
		return parseTerminalManagerPaneListing(result.stdout).filter((pane) => !pane.is_plugin);
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
		const focusEffect = effects[0];
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

function isAlreadyFocusedPaneError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes('already focused');
}

function isMissingPaneError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes('Pane with id') && message.includes('not found');
}

function parseTerminalManagerPaneListing(output: string): TerminalManagerPaneMetadata[] {
	const normalizedOutput = output.trim();
	if (!normalizedOutput || !normalizedOutput.startsWith('[')) {
		return [];
	}

	try {
		return JSON.parse(normalizedOutput) as TerminalManagerPaneMetadata[];
	} catch {
		return [];
	}
}

function isAirportPaneExpected(state: AirportState, paneId: AirportPaneId): boolean {
	void state;
	void paneId;
	return true;
}
