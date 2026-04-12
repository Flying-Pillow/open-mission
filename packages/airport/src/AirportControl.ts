import {
	createDefaultPaneBindings,
	deriveAirportProjections,
	type AirportFocusState,
	type AirportProjectionSet,
	type AirportState,
	type AirportStatus,
	type AirportSubstrateState,
	type BindAirportPaneParams,
	type ConnectAirportClientParams,
	type PaneBinding,
	type AirportPaneId,
	type PersistedAirportIntent,
	derivePersistedAirportIntent,
	normalizePaneBinding,
	normalizePersistedAirportIntent,
	type ObserveAirportClientParams
} from './types.js';
import { resolveObservedPaneIdFromSubstrate } from './effects.js';
import { createDefaultTerminalManagerSubstrateState } from './terminal-manager.js';

type RepositoryScopedAirportControlOptions = {
	airportId: string;
	repositoryId: string;
	repositoryRootPath?: string;
	sessionId?: string;
	terminalSessionName: string;
	persistedIntent?: PersistedAirportIntent;
	initialSubstrateState?: AirportSubstrateState;
};

export class AirportControl {
	private state: AirportState;

	public constructor(options: RepositoryScopedAirportControlOptions) {
		const persistedIntent = normalizePersistedAirportIntent(options.persistedIntent);
		const airportId = options.airportId.trim();
		const repositoryId = options.repositoryId.trim();
		const terminalSessionName = options.terminalSessionName.trim();
		if (!airportId) {
			throw new Error('Airport control requires a repository-scoped airport id.');
		}
		if (!repositoryId) {
			throw new Error('Airport control requires a repository id.');
		}
		if (!terminalSessionName) {
			throw new Error('Airport control requires a repository-scoped terminal session name.');
		}

		this.state = {
			airportId,
			repositoryId,
			...(options.repositoryRootPath?.trim() ? { repositoryRootPath: options.repositoryRootPath.trim() } : {}),
			...(options.sessionId?.trim() ? { sessionId: options.sessionId.trim() } : {}),
			panes: {
				...createDefaultPaneBindings(repositoryId),
				...(persistedIntent?.panes ?? {})
			},
			focus: persistedIntent?.focus?.intentPaneId ? { intentPaneId: persistedIntent.focus.intentPaneId } : {},
			clients: {},
			substrate: options.initialSubstrateState
				? structuredClone(options.initialSubstrateState)
				: createDefaultTerminalManagerSubstrateState({ sessionName: terminalSessionName })
		};
	}

	public scopeToRepository(options: {
		repositoryId: string;
		repositoryRootPath?: string;
		airportId: string;
		sessionName: string;
	}): AirportStatus {
		const repositoryId = options.repositoryId.trim();
		const repositoryRootPath = options.repositoryRootPath?.trim();
		const airportId = options.airportId.trim();
		const sessionName = options.sessionName.trim();
		const sameScope = this.state.repositoryId === repositoryId
			&& this.state.airportId === airportId
			&& this.state.substrate.sessionName === sessionName
			&& (this.state.repositoryRootPath ?? '') === (repositoryRootPath ?? '');
		if (sameScope) {
			return this.getStatus();
		}

		this.state = {
			...this.state,
			airportId,
			repositoryId,
			...(repositoryRootPath ? { repositoryRootPath } : {}),
			panes: createDefaultPaneBindings(repositoryId),
			substrate: {
				...createDefaultTerminalManagerSubstrateState({ sessionName }),
				layoutIntent: this.state.substrate.layoutIntent
			}
		};
		return this.getStatus();
	}

	public getState(): AirportState {
		return structuredClone(this.state);
	}

	public getProjections(): AirportProjectionSet {
		return deriveAirportProjections(this.state);
	}

	public getStatus(): AirportStatus {
		return {
			state: this.getState(),
			projections: this.getProjections()
		};
	}

	public getPersistedIntent(): PersistedAirportIntent {
		return derivePersistedAirportIntent(this.state);
	}

	public connectClient(params: ConnectAirportClientParams): AirportStatus {
		const now = new Date().toISOString();
		const existing = this.state.clients[params.clientId];
		const clients = releaseClaimedPane(this.state.clients, params.clientId, params.paneId);
		const substrate = params.terminalPaneId !== undefined
			? assignTerminalPaneToAirportPane(this.state.substrate, params.paneId, params.terminalPaneId)
			: this.state.substrate;
		this.state = {
			...this.state,
			focus: deriveFocusState(clients, this.state.focus.intentPaneId, substrate),
			clients: {
				...clients,
				[params.clientId]: {
					clientId: params.clientId,
					connected: true,
					label: params.label?.trim() || existing?.label || 'panel',
					connectedAt: existing?.connectedAt || now,
					lastSeenAt: now,
					...(params.surfacePath?.trim()
						? { surfacePath: params.surfacePath.trim() }
						: existing?.surfacePath
							? { surfacePath: existing.surfacePath }
							: {}),
					claimedPaneId: params.paneId,
					...(existing?.focusedPaneId ? { focusedPaneId: existing.focusedPaneId } : {}),
					...(params.panelProcessId?.trim()
						? { panelProcessId: params.panelProcessId.trim() }
						: existing?.panelProcessId
							? { panelProcessId: existing.panelProcessId }
							: {})
				}
			},
			substrate
		};
		return this.getStatus();
	}

	public disconnectClient(clientId: string): AirportStatus {
		const existing = this.state.clients[clientId];
		if (!existing) {
			return this.getStatus();
		}
		const disconnectedClient: typeof existing = {
			...existing,
			connected: false,
			lastSeenAt: new Date().toISOString()
		};
		const { claimedPaneId: _claimedPaneId, focusedPaneId: _focusedPaneId, ...releasedClient } = disconnectedClient;
		const clients = {
			...this.state.clients,
			[clientId]: releasedClient
		};
		this.state = {
			...this.state,
			focus: deriveFocusState(clients, this.state.focus.intentPaneId, this.state.substrate),
			clients: {
				...clients
			}
		};
		return this.getStatus();
	}

	public observeClient(params: ObserveAirportClientParams): AirportStatus {
		const existing = this.state.clients[params.clientId];
		if (!existing) {
			throw new Error(`Airport client '${params.clientId}' is not registered.`);
		}
		const substrate = params.terminalPaneId !== undefined && existing.claimedPaneId
			? assignTerminalPaneToAirportPane(this.state.substrate, existing.claimedPaneId, params.terminalPaneId)
			: this.state.substrate;
		const clients = {
			...this.state.clients,
			[params.clientId]: {
				...existing,
				lastSeenAt: new Date().toISOString(),
				...(params.surfacePath?.trim() ? { surfacePath: params.surfacePath.trim() } : {}),
				...(params.focusedPaneId ? { focusedPaneId: params.focusedPaneId } : {})
			}
		};

		this.state = {
			...this.state,
			focus: deriveFocusState(clients, params.intentPaneId ?? this.state.focus.intentPaneId, substrate),
			clients,
			substrate
		};
		return this.getStatus();
	}

	public bindPane(params: BindAirportPaneParams): AirportStatus {
		this.state = {
			...this.state,
			panes: {
				...this.state.panes,
				[params.paneId]: normalizePaneBinding(params.binding)
			}
		};
		return this.getStatus();
	}

	public applyDefaultBindings(
		bindings: Partial<Record<AirportPaneId, PaneBinding>>,
		options: { focusIntent?: AirportPaneId } = {}
	): AirportStatus {
		this.state = {
			...this.state,
			panes: {
				...this.state.panes,
				...(bindings.tower ? { tower: normalizePaneBinding(bindings.tower) } : {}),
				...(bindings.briefingRoom ? { briefingRoom: normalizePaneBinding(bindings.briefingRoom) } : {}),
				...(bindings.runway ? { runway: normalizePaneBinding(bindings.runway) } : {})
			},
			focus: deriveFocusState(this.state.clients, options.focusIntent ?? this.state.focus.intentPaneId, this.state.substrate)
		};
		return this.getStatus();
	}

	public observeSubstrate(substrate: AirportSubstrateState): AirportStatus {
		this.state = {
			...this.state,
			substrate: structuredClone(substrate),
			focus: deriveFocusState(this.state.clients, this.state.focus.intentPaneId, substrate)
		};
		return this.getStatus();
	}
}

function releaseClaimedPane(
	clients: AirportState['clients'],
	clientId: string,
	paneId: AirportPaneId
): AirportState['clients'] {
	const nextClients = { ...clients };
	for (const [candidateClientId, client] of Object.entries(clients)) {
		if (candidateClientId === clientId || !client.connected || client.claimedPaneId !== paneId) {
			continue;
		}
		const { claimedPaneId: _claimedPaneId, ...releasedClient } = client;
		nextClients[candidateClientId] = releasedClient;
	}
	return nextClients;
}

function deriveFocusState(
	clients: AirportState['clients'],
	intentPaneId: AirportPaneId | undefined,
	substrate: AirportSubstrateState
): AirportFocusState {
	const observedClients = Object.values(clients)
		.filter((client) => client.connected && client.focusedPaneId)
		.sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt) || left.clientId.localeCompare(right.clientId));
	const observedPaneIdByClientId = Object.fromEntries(
		observedClients.map((client) => [client.clientId, client.focusedPaneId as AirportPaneId])
	);
	const observedPaneId = resolveObservedPaneIdFromSubstrate(substrate) ?? observedClients[0]?.focusedPaneId;
	return {
		...(intentPaneId ? { intentPaneId } : {}),
		...(observedPaneId ? { observedPaneId } : {}),
		...(Object.keys(observedPaneIdByClientId).length > 0 ? { observedPaneIdByClientId } : {})
	};
}

function assignTerminalPaneToAirportPane(
	substrate: AirportSubstrateState,
	paneId: AirportPaneId,
	terminalPaneId: number
): AirportSubstrateState {
	if (!Number.isInteger(terminalPaneId) || terminalPaneId < 0) {
		return substrate;
	}

	const nextPanes = Object.fromEntries(
		(Object.entries(substrate.panes) as Array<[AirportPaneId, AirportSubstrateState['panes'][AirportPaneId]]>).map(
			([candidatePaneId, pane]) => {
				if (!pane || pane.terminalPaneId !== terminalPaneId || candidatePaneId === paneId) {
					return [candidatePaneId, pane];
				}

				return [candidatePaneId, { ...pane, exists: false }];
			}
		)
	) as AirportSubstrateState['panes'];
	const currentPane = nextPanes[paneId];

	return {
		...substrate,
		panes: {
			...nextPanes,
			[paneId]: {
				terminalPaneId,
				expected: currentPane?.expected ?? true,
				exists: substrate.attached,
				...(currentPane?.title ? { title: currentPane.title } : {})
			}
		}
	};
}