type AirportPaneId = 'tower' | 'briefingRoom' | 'runway';

export function createPaneConnectParams(paneId: AirportPaneId, label: string) {
	const terminalPaneId = resolveInjectedTerminalPaneId();
	const terminalSessionName = process.env['AIRPORT_TERMINAL_SESSION']?.trim()
		|| process.env['AIRPORT_TERMINAL_SESSION_NAME']?.trim();
	return {
		paneId,
		label,
		panelProcessId: String(process.pid),
		...(terminalPaneId !== undefined ? { terminalPaneId } : {}),
		...(terminalSessionName ? { terminalSessionName } : {})
	};
}

function resolveInjectedTerminalPaneId(): number | undefined {
	const rawTerminalPaneId = process.env['ZELLIJ_PANE_ID']?.trim();
	if (!rawTerminalPaneId) {
		return undefined;
	}

	const terminalPaneId = Number.parseInt(rawTerminalPaneId, 10);
	if (!Number.isInteger(terminalPaneId) || terminalPaneId < 0) {
		return undefined;
	}

	return terminalPaneId;
}