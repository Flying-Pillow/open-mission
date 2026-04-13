import type { AirportPaneId, AirportState, AirportSubstrateState } from './types.js';

export type AirportSubstrateEffect = {
	kind: 'focus-pane';
	paneId: AirportPaneId;
	terminalPaneId: number;
};

export function planAirportSubstrateEffects(state: AirportState): AirportSubstrateEffect[] {
	const effects: AirportSubstrateEffect[] = [];

	const intentPaneId = state.focus.intentPaneId;
	if (!intentPaneId) {
		return effects;
	}

	const observedPaneId = resolveObservedPaneIdFromSubstrate(state.substrate) ?? state.focus.observedPaneId;
	if (observedPaneId === intentPaneId) {
		return effects;
	}

	const pane = state.substrate.panes[intentPaneId];
	if (!pane?.exists || pane.terminalPaneId < 0) {
		return effects;
	}

	effects.push({ kind: 'focus-pane', paneId: intentPaneId, terminalPaneId: pane.terminalPaneId });
	return effects;
}

export function resolveObservedPaneIdFromSubstrate(substrate: AirportSubstrateState): AirportPaneId | undefined {
	if (substrate.observedFocusedTerminalPaneId === undefined) {
		return undefined;
	}

	for (const [paneId, pane] of Object.entries(substrate.panes) as Array<[AirportPaneId, AirportSubstrateState['panes'][AirportPaneId]]>) {
		if (pane?.exists && pane.terminalPaneId === substrate.observedFocusedTerminalPaneId) {
			return paneId;
		}
	}

	return undefined;
}