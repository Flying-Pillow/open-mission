import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AirportPaneState, AirportState, AirportSubstrateState, GateId } from './types.js';

const execFileAsync = promisify(execFile);

const GATE_PANE_TITLES: Record<GateId, string> = {
	dashboard: 'MISSION',
	editor: 'EDITOR',
	pilot: 'PILOT'
};

type ZellijPaneMetadata = {
	id: number;
	title: string;
	tabId?: number;
	tab_id?: number;
	is_plugin: boolean;
	is_focused?: boolean;
	is_suppressed?: boolean;
};

export type ZellijExecutorResult = {
	stdout: string;
	stderr: string;
};

export type ZellijExecutor = (args: string[]) => Promise<ZellijExecutorResult>;

export interface AirportSubstrateController {
	getState(): AirportSubstrateState;
	reconcile(state: AirportState): Promise<AirportSubstrateState>;
	setSessionName(sessionName: string): AirportSubstrateState;
	observePane(gateId: GateId, pane: AirportPaneState | undefined): AirportSubstrateState;
}

export class ZellijSubstrateController implements AirportSubstrateController {
	private state: AirportSubstrateState;
	private readonly executor: ZellijExecutor;
	private lastAppliedPilotTargetKey: string | undefined;

	public constructor(options: { sessionName?: string; executor?: ZellijExecutor; terminalBinary?: string } = {}) {
		this.state = createDefaultZellijSubstrateState(options);
		const terminalBinary = options.terminalBinary?.trim() || process.env['MISSION_TERMINAL_BINARY']?.trim() || 'zellij';
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

	public async reconcile(state: AirportState): Promise<AirportSubstrateState> {
		const now = new Date().toISOString();
		const panes = await this.listPanes().catch(() => undefined);
		const nextState = panes
			? buildObservedState(this.state, panes, now)
			: buildDetachedState(this.state, now);

		this.state = nextState;
		await this.applyPilotBindingEffect(state, panes);
		return this.getState();
	}

	public setSessionName(sessionName: string): AirportSubstrateState {
		const normalizedSessionName = sessionName.trim() || 'mission-control';
		if (normalizedSessionName === this.state.sessionName) {
			return this.getState();
		}

		this.lastAppliedPilotTargetKey = undefined;
		this.state = {
			...createDefaultZellijSubstrateState({ sessionName: normalizedSessionName }),
			layoutIntent: this.state.layoutIntent
		};
		return this.getState();
	}

	public observePane(gateId: GateId, pane: AirportPaneState | undefined): AirportSubstrateState {
		const panesByGate = { ...this.state.panesByGate };
		if (pane) {
			panesByGate[gateId] = { ...pane };
		} else {
			delete panesByGate[gateId];
		}
		this.state = {
			...this.state,
			panesByGate,
			lastObservedAt: new Date().toISOString()
		};
		return this.getState();
	}

	private async listPanes(): Promise<ZellijPaneMetadata[]> {
		const result = await this.executor([
			'--session',
			this.state.sessionName,
			'action',
			'list-panes',
			'--json',
			'--all'
		]);
		return (JSON.parse(result.stdout) as ZellijPaneMetadata[]).filter((pane) => !pane.is_plugin);
	}

	private async applyPilotBindingEffect(state: AirportState, panes: ZellijPaneMetadata[] | undefined): Promise<void> {
		if (!panes || panes.length === 0) {
			return;
		}

		const pilotBinding = state.gates.pilot;
		const boundSessionId = pilotBinding.targetKind === 'agentSession' ? pilotBinding.targetId?.trim() : undefined;
		if (!boundSessionId) {
			this.lastAppliedPilotTargetKey = undefined;
			return;
		}

		const targetPane = boundSessionId
			? panes.find((pane) => pane.title === boundSessionId)
			: undefined;
		if (!targetPane) {
			this.lastAppliedPilotTargetKey = undefined;
			return;
		}

		const desiredPane = targetPane;
		const desiredTargetKey = `${boundSessionId}:${String(desiredPane.id)}`;
		if (this.lastAppliedPilotTargetKey === desiredTargetKey) {
			return;
		}

		const previouslyFocusedPaneId = panes.find((pane) => pane.is_focused)?.id;
		if (previouslyFocusedPaneId === desiredPane.id) {
			this.lastAppliedPilotTargetKey = desiredTargetKey;
			return;
		}

		await this.focusPane(desiredPane.id);
		this.lastAppliedPilotTargetKey = desiredTargetKey;
		if (previouslyFocusedPaneId && previouslyFocusedPaneId !== desiredPane.id) {
			await this.focusPane(previouslyFocusedPaneId).catch(() => undefined);
		}
	}

	private async focusPane(paneId: number): Promise<void> {
		await this.executor([
			'--session',
			this.state.sessionName,
			'action',
			'focus-pane-id',
			`terminal_${String(paneId)}`
		]);
	}
}

export class InMemoryZellijSubstrateController implements AirportSubstrateController {
	private state: AirportSubstrateState;

	public constructor(options: { sessionName?: string } = {}) {
		this.state = createDefaultZellijSubstrateState(options);
	}

	public getState(): AirportSubstrateState {
		return structuredClone(this.state);
	}

	public async reconcile(_state: AirportState): Promise<AirportSubstrateState> {
		const now = new Date().toISOString();
		this.state = {
			...this.state,
			attached: true,
			lastAppliedAt: now,
			lastObservedAt: now
		};
		return this.getState();
	}

	public setSessionName(sessionName: string): AirportSubstrateState {
		const normalizedSessionName = sessionName.trim() || 'mission-control';
		if (normalizedSessionName === this.state.sessionName) {
			return this.getState();
		}

		const {
			lastAppliedAt: _lastAppliedAt,
			lastObservedAt: _lastObservedAt,
			observedFocusedPaneId: _observedFocusedPaneId,
			...persistentState
		} = this.state;

		this.state = {
			...persistentState,
			sessionName: normalizedSessionName,
			attached: false,
			panesByGate: {}
		};
		return this.getState();
	}

	public observePane(gateId: GateId, pane: AirportPaneState | undefined): AirportSubstrateState {
		const panesByGate = { ...this.state.panesByGate };
		if (pane) {
			panesByGate[gateId] = { ...pane };
		} else {
			delete panesByGate[gateId];
		}
		this.state = {
			...this.state,
			panesByGate,
			lastObservedAt: new Date().toISOString()
		};
		return this.getState();
	}
}

export function createDefaultZellijSubstrateState(options: { sessionName?: string } = {}): AirportSubstrateState {
	return {
		kind: 'zellij',
		sessionName: options.sessionName?.trim() || 'mission-control',
		layoutIntent: 'mission-control-v1',
		attached: false,
		panesByGate: {}
	};
}

function buildObservedState(
	currentState: AirportSubstrateState,
	panes: ZellijPaneMetadata[],
	now: string
): AirportSubstrateState {
	const focusedPaneId = panes.find((pane) => pane.is_focused)?.id;
	const panesByGate = Object.fromEntries(
		(Object.keys(GATE_PANE_TITLES) as GateId[]).map((gateId) => {
			const hostTitle = GATE_PANE_TITLES[gateId];
			const pane = panes.find((candidate) => candidate.title === hostTitle);
			return [
				gateId,
				pane
					? {
						paneId: pane.id,
						expected: true,
						exists: true,
						title: pane.title
					}
					: {
						paneId: -1,
						expected: true,
						exists: false,
						title: hostTitle
					}
			] as const;
		})
	) as Partial<Record<GateId, AirportPaneState>>;

	return {
		...currentState,
		attached: true,
		panesByGate,
		lastAppliedAt: now,
		lastObservedAt: now,
		...(focusedPaneId !== undefined
			? { observedFocusedPaneId: focusedPaneId }
			: {})
	};
}

function buildDetachedState(currentState: AirportSubstrateState, now: string): AirportSubstrateState {
	const { observedFocusedPaneId: _observedFocusedPaneId, ...nextState } = currentState;
	return {
		...nextState,
		attached: false,
		panesByGate: Object.fromEntries(
			(Object.keys(GATE_PANE_TITLES) as GateId[]).map((gateId) => [
				gateId,
				{
					paneId: -1,
					expected: true,
					exists: false,
					title: GATE_PANE_TITLES[gateId]
				}
			])
		) as Partial<Record<GateId, AirportPaneState>>,
		lastObservedAt: now
	};
}