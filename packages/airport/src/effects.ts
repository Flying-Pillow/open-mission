import type { AirportPaneId, AirportState, AirportSubstrateState } from './types.js';

export type AirportSubstrateEffect = {
	kind: 'focus-pane';
	paneId: AirportPaneId;
	terminalPaneId: number;
} | {
	kind: 'ensure-pane';
	paneId: 'runway';
} | {
	kind: 'remove-pane';
	paneId: 'runway';
	terminalPaneId: number;
};

export function planAirportSubstrateEffects(state: AirportState): AirportSubstrateEffect[] {
	const effects: AirportSubstrateEffect[] = [];
	const runwayBinding = state.panes.runway;
	const runwayPane = state.substrate.panes.runway;
	const shouldShowAgentSessionPane = runwayBinding.targetKind === 'agentSession';
	const hasAgentSessionPane = Boolean(runwayPane?.exists && (runwayPane.terminalPaneId ?? -1) >= 0);

	if (shouldShowAgentSessionPane && !hasAgentSessionPane) {
		effects.push({ kind: 'ensure-pane', paneId: 'runway' });
	}

	if (!shouldShowAgentSessionPane && hasAgentSessionPane && (runwayPane?.terminalPaneId ?? -1) >= 0) {
		effects.push({
			kind: 'remove-pane',
			paneId: 'runway',
			terminalPaneId: runwayPane?.terminalPaneId ?? -1
		});
	}

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