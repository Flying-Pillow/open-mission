import type { AirportState, AirportSubstrateState, GateId } from './types.js';

export type AirportSubstrateEffect = {
	kind: 'focus-gate';
	gateId: GateId;
	paneId: number;
};

export function planAirportSubstrateEffects(state: AirportState): AirportSubstrateEffect[] {
	const intentGateId = state.focus.intentGateId;
	if (!intentGateId) {
		return [];
	}

	const observedGateId = resolveObservedGateIdFromSubstrate(state.substrate) ?? state.focus.observedGateId;
	if (observedGateId === intentGateId) {
		return [];
	}

	const pane = state.substrate.panesByGate[intentGateId];
	if (!pane?.exists || pane.paneId < 0) {
		return [];
	}

	return [{ kind: 'focus-gate', gateId: intentGateId, paneId: pane.paneId }];
}

export function resolveObservedGateIdFromSubstrate(substrate: AirportSubstrateState): GateId | undefined {
	if (substrate.observedFocusedPaneId === undefined) {
		return undefined;
	}

	for (const [gateId, pane] of Object.entries(substrate.panesByGate) as Array<[GateId, AirportSubstrateState['panesByGate'][GateId]]>) {
		if (pane?.exists && pane.paneId === substrate.observedFocusedPaneId) {
			return gateId;
		}
	}

	return undefined;
}