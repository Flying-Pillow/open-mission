import { note, outro } from '@clack/prompts';
import { DaemonApi } from '@flying-pillow/mission-core';
import {
	connectSurfaceDaemon,
	resolveSurfaceDaemonLaunchMode
} from '../daemon/connectSurfaceDaemon.js';
import type { CommandContext } from './types.js';

export async function runAirportStatus(context: CommandContext): Promise<void> {
	if (
		context.args.includes('--help')
		|| context.args.includes('-h')
		|| context.args.includes('help')
	) {
		process.stdout.write('mission airport:status [--json]\n');
		return;
	}

	const client = await connectSurfaceDaemon({
		surfacePath: context.launchCwd,
		launchMode: resolveSurfaceDaemonLaunchMode(import.meta.url)
	});

	try {
		const api = new DaemonApi(client);
		const snapshot = await api.airport.getStatus();

		if (context.json) {
			process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
			return;
		}

		const gateLines = Object.entries(snapshot.state.airport.gates).map(([gateId, binding]) => {
			const suffix = binding.targetId ? `:${binding.targetId}` : '';
			const mode = binding.mode ? ` (${binding.mode})` : '';
			return `${gateId}: ${binding.targetKind}${suffix}${mode}`;
		});

		const clientLines = Object.values(snapshot.state.airport.clients).map((airportClient) => {
			return [
				airportClient.clientId,
				airportClient.label,
				airportClient.connected ? 'connected' : 'disconnected',
				airportClient.claimedGateId ? `gate=${airportClient.claimedGateId}` : undefined,
				airportClient.focusedGateId ? `focus=${airportClient.focusedGateId}` : undefined
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
		const substrateLines = Object.entries(snapshot.state.airport.substrate.panesByGate).map(([gateId, pane]) => {
			return `${gateId}: ${pane.exists ? `pane=${String(pane.paneId)}` : 'missing'}${pane.title ? ` title=${pane.title}` : ''}`;
		});

		note(
			[
				`version: ${String(snapshot.state.version)}`,
				`airport: ${snapshot.state.airport.airportId}`,
				`repository: ${snapshot.state.airport.repositoryRootPath ?? snapshot.state.airport.repositoryId ?? 'unscoped'}`,
				`session: ${snapshot.state.airport.substrate.sessionName}`,
				`focus intent: ${snapshot.state.airport.focus.intentGateId ?? 'none'}`,
				`focus observed: ${snapshot.state.airport.focus.observedGateId ?? 'none'}`,
				`substrate: ${snapshot.state.airport.substrate.kind} (${snapshot.state.airport.substrate.attached ? 'attached' : 'detached'})`,
				`focused pane: ${snapshot.state.airport.substrate.observedFocusedPaneId ?? 'none'}`,
				`known airports: ${String(Object.keys(snapshot.state.airports.repositories).length)}`,
				`active repository: ${snapshot.state.airports.activeRepositoryId ?? 'unscoped'}`,
				'',
				'Known airports:',
				...(knownAirportLines.length > 0 ? knownAirportLines : ['none']),
				'',
				'Gates:',
				...gateLines,
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