import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AirportPaneState, AirportState, AirportSubstrateState, GateId } from './types.js';

const execFileAsync = promisify(execFile);

const GATE_PANE_TITLES: Record<GateId, string> = {
	dashboard: 'MISSION',
	editor: 'EDITOR',
	agentSession: 'AGENT SESSION'
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
	reconcile(state: AirportState): Promise<AirportSubstrateState>;
	setSessionName(sessionName: string): AirportSubstrateState;
	observePane(gateId: GateId, pane: AirportPaneState | undefined): AirportSubstrateState;
}

export class TerminalManagerSubstrateController implements AirportSubstrateController {
	private state: AirportSubstrateState;
	private readonly executor: TerminalManagerExecutor;
	private lastAppliedAgentSessionTargetKey: string | undefined;

	public constructor(options: { sessionName?: string; executor?: TerminalManagerExecutor; terminalBinary?: string } = {}) {
		this.state = createDefaultTerminalManagerSubstrateState(options);
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
		await this.applyAgentSessionBindingEffect(state, panes);
		return this.getState();
	}

	public setSessionName(sessionName: string): AirportSubstrateState {
		const normalizedSessionName = sessionName.trim() || 'mission-control';
		if (normalizedSessionName === this.state.sessionName) {
			return this.getState();
		}

		this.lastAppliedAgentSessionTargetKey = undefined;
		this.state = {
			...createDefaultTerminalManagerSubstrateState({ sessionName: normalizedSessionName }),
			layoutIntent: this.state.layoutIntent
		};
		return this.getState();
	}

	public observePane(gateId: GateId, pane: AirportPaneState | undefined): AirportSubstrateState {
		const panesByGate = mergeObservedPane(this.state.panesByGate, gateId, pane);
		this.state = {
			...this.state,
			panesByGate,
			lastObservedAt: new Date().toISOString()
		};
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
		return (JSON.parse(result.stdout) as TerminalManagerPaneMetadata[]).filter((pane) => !pane.is_plugin);
	}

	private async applyAgentSessionBindingEffect(state: AirportState, panes: TerminalManagerPaneMetadata[] | undefined): Promise<void> {
		if (!panes || panes.length === 0) {
			return;
		}

		const agentSessionBinding = state.gates.agentSession;
		const boundSessionId = agentSessionBinding.targetKind === 'agentSession' ? agentSessionBinding.targetId?.trim() : undefined;
		if (!boundSessionId) {
			this.lastAppliedAgentSessionTargetKey = undefined;
			return;
		}

		const targetPane = panes.find((pane) => pane.title === boundSessionId);
		if (!targetPane) {
			this.lastAppliedAgentSessionTargetKey = undefined;
			return;
		}

		const desiredTargetKey = `${boundSessionId}:${String(targetPane.id)}`;
		if (this.lastAppliedAgentSessionTargetKey === desiredTargetKey) {
			return;
		}

		const previouslyFocusedPaneId = panes.find((pane) => pane.is_focused)?.id;
		if (previouslyFocusedPaneId === targetPane.id) {
			this.lastAppliedAgentSessionTargetKey = desiredTargetKey;
			return;
		}

		await this.focusPane(targetPane.id);
		this.lastAppliedAgentSessionTargetKey = desiredTargetKey;
		if (previouslyFocusedPaneId && previouslyFocusedPaneId !== targetPane.id) {
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

export class InMemoryTerminalManagerSubstrateController implements AirportSubstrateController {
	private state: AirportSubstrateState;

	public constructor(options: { sessionName?: string } = {}) {
		this.state = createDefaultTerminalManagerSubstrateState(options);
	}

	public getState(): AirportSubstrateState {
		return structuredClone(this.state);
	}

	public reconcile(_state: AirportState): Promise<AirportSubstrateState> {
		const now = new Date().toISOString();
		this.state = {
			...this.state,
			attached: true,
			lastAppliedAt: now,
			lastObservedAt: now
		};
		return Promise.resolve(this.getState());
	}

	public setSessionName(sessionName: string): AirportSubstrateState {
		const normalizedSessionName = sessionName.trim() || 'mission-control';
		if (normalizedSessionName === this.state.sessionName) {
			return this.getState();
		}

		this.state = {
			...createDefaultTerminalManagerSubstrateState({ sessionName: normalizedSessionName }),
			layoutIntent: this.state.layoutIntent
		};
		return this.getState();
	}

	public observePane(gateId: GateId, pane: AirportPaneState | undefined): AirportSubstrateState {
		const panesByGate = mergeObservedPane(this.state.panesByGate, gateId, pane);
		this.state = {
			...this.state,
			panesByGate,
			lastObservedAt: new Date().toISOString()
		};
		return this.getState();
	}
}

export function createDefaultTerminalManagerSubstrateState(options: { sessionName?: string } = {}): AirportSubstrateState {
	return {
		kind: 'terminal-manager',
		sessionName: options.sessionName?.trim() || 'mission-control',
		layoutIntent: 'mission-control-v1',
		attached: false,
		panesByGate: {}
	};
}

function buildObservedState(
	currentState: AirportSubstrateState,
	panes: TerminalManagerPaneMetadata[],
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
	return {
		kind: currentState.kind,
		sessionName: currentState.sessionName,
		layoutIntent: currentState.layoutIntent,
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
		...(currentState.lastAppliedAt ? { lastAppliedAt: currentState.lastAppliedAt } : {}),
		lastObservedAt: now
	};
}

function mergeObservedPane(
	panesByGate: Partial<Record<GateId, AirportPaneState>>,
	gateId: GateId,
	pane: AirportPaneState | undefined
): Partial<Record<GateId, AirportPaneState>> {
	if (pane) {
		return {
			...panesByGate,
			[gateId]: { ...pane }
		};
	}

	return Object.fromEntries(
		Object.entries(panesByGate).filter(([candidateGateId]) => candidateGateId !== gateId)
	) as Partial<Record<GateId, AirportPaneState>>;
}