import { note, outro } from '@clack/prompts';
import { DaemonApi, connectAirportDaemon, resolveAirportDaemonRuntimeMode } from '@flying-pillow/mission-core/node';
import type { EntryContext } from './entryContext.js';

export async function runAirportStatusCommand(context: EntryContext): Promise<void> {
	if (
		context.args.includes('--help')
		|| context.args.includes('-h')
		|| context.args.includes('help')
	) {
		process.stdout.write('mission airport:status [--json]\n');
		return;
	}

	const client = await connectAirportDaemon({
		surfacePath: context.workingDirectory,
		runtimeMode: resolveAirportDaemonRuntimeMode(import.meta.url)
	});

	try {
		const api = new DaemonApi(client);
		const snapshot = await api.airport.getStatus();

		if (context.json) {
			process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
			return;
		}

		const paneLines = Object.entries(snapshot.state.airport.panes).map(([paneId, binding]) => {
			const suffix = binding.targetId ? `:${binding.targetId}` : '';
			const mode = binding.mode ? ` (${binding.mode})` : '';
			return `${paneId}: ${binding.targetKind}${suffix}${mode}`;
		});

		const clientLines = Object.values(snapshot.state.airport.clients).map((airportClient) => {
			return [
				airportClient.clientId,
				airportClient.label,
				airportClient.connected ? 'connected' : 'disconnected',
				airportClient.claimedPaneId ? `pane=${airportClient.claimedPaneId}` : undefined,
				airportClient.focusedPaneId ? `focus=${airportClient.focusedPaneId}` : undefined
			].filter(Boolean).join(' | ');
		});
		const knownAirportLines = Object.values(snapshot.state.airports.repositories).map((entry) => {
			const activeMarker = snapshot.state.airports.activeRepositoryId === entry.repositoryId ? 'active' : 'idle';
			return [
				entry.airport.airportId,
				entry.repositoryRootPath,
				`session=${entry.airport.substrate.sessionName}`,
				`attached=${entry.airport.substrate.attached ? 'yes' : 'no'}`,
				activeMarker
			].join(' | ');
		});
		const substrateLines = Object.entries(snapshot.state.airport.substrate.panes).map(([paneId, pane]) => {
			return `${paneId}: ${pane.exists ? `terminalPane=${String(pane.terminalPaneId)}` : 'missing'}${pane.title ? ` title=${pane.title}` : ''}`;
		});

		note(
			[
				`version: ${String(snapshot.state.version)}`,
				`airport: ${snapshot.state.airport.airportId}`,
				`repository: ${snapshot.state.airport.repositoryRootPath ?? snapshot.state.airport.repositoryId ?? 'unscoped'}`,
				`session: ${snapshot.state.airport.substrate.sessionName}`,
				`focus intent: ${snapshot.state.airport.focus.intentPaneId ?? 'none'}`,
				`focus observed: ${snapshot.state.airport.focus.observedPaneId ?? 'none'}`,
				`substrate: ${snapshot.state.airport.substrate.kind} (${snapshot.state.airport.substrate.attached ? 'attached' : 'detached'})`,
				`focused pane: ${snapshot.state.airport.substrate.observedFocusedTerminalPaneId ?? 'none'}`,
				`known airports: ${String(Object.keys(snapshot.state.airports.repositories).length)}`,
				`active repository: ${snapshot.state.airports.activeRepositoryId ?? 'unscoped'}`,
				'',
				'Known airports:',
				...(knownAirportLines.length > 0 ? knownAirportLines : ['none']),
				'',
				'Panes:',
				...paneLines,
				'',
				'Substrate:',
				...(substrateLines.length > 0 ? substrateLines : ['none']),
				'',
				'Clients:',
				...(clientLines.length > 0 ? clientLines : ['none'])
			].join('\n'),
			'Airport status'
		);
		outro('Mission airport status loaded.');
	} finally {
		client.dispose();
	}
}