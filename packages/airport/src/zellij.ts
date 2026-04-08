import type { AirportState, AirportSubstrateState } from './types.js';

export interface AirportSubstrateController {
	getState(): AirportSubstrateState;
	reconcile(state: AirportState): Promise<AirportSubstrateState>;
	setSessionName(sessionName: string): AirportSubstrateState;
	observePane(gateId: keyof AirportSubstrateState['observedPaneIds'], paneId?: string): AirportSubstrateState;
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
			connected: true,
			observedSessionName: this.state.sessionName,
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
			observedSessionName: _observedSessionName,
			lastAppliedAt: _lastAppliedAt,
			lastObservedAt: _lastObservedAt,
			...persistentState
		} = this.state;

		this.state = {
			...persistentState,
			sessionName: normalizedSessionName,
			connected: false,
			observedPaneIds: {}
		};
		return this.getState();
	}

	public observePane(gateId: keyof AirportSubstrateState['observedPaneIds'], paneId?: string): AirportSubstrateState {
		const observedPaneIds = { ...this.state.observedPaneIds };
		if (paneId?.trim()) {
			observedPaneIds[gateId] = paneId;
		} else {
			delete observedPaneIds[gateId];
		}
		this.state = {
			...this.state,
			observedPaneIds,
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
		connected: false,
		observedPaneIds: {}
	};
}