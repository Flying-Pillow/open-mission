import {
	createDefaultGateBindings,
	deriveAirportProjections,
	type AirportFocusState,
	type AirportProjectionSet,
	type AirportState,
	type AirportStatus,
	type AirportSubstrateState,
	type BindAirportGateParams,
	type ConnectAirportClientParams,
	type GateBinding,
	type GateId,
	type PersistedAirportIntent,
	derivePersistedAirportIntent,
	normalizeGateBinding,
	normalizePersistedAirportIntent,
	type ObserveAirportClientParams
} from './types.js';
import { resolveObservedGateIdFromSubstrate } from './effects.js';
import { createDefaultTerminalManagerSubstrateState } from './terminal-manager.js';

export class AirportControl {
	private state: AirportState;

	public constructor(
		options: {
			airportId?: string;
			repositoryId?: string;
			repositoryRootPath?: string;
			sessionId?: string;
			persistedIntent?: PersistedAirportIntent;
			initialSubstrateState?: AirportSubstrateState;
		} = {}
	) {
		const persistedIntent = normalizePersistedAirportIntent(options.persistedIntent);
		const repositoryId = options.repositoryId?.trim();
		this.state = {
			airportId: options.airportId?.trim() || 'mission-airport:unscoped',
			...(repositoryId ? { repositoryId } : {}),
			...(options.repositoryRootPath?.trim() ? { repositoryRootPath: options.repositoryRootPath.trim() } : {}),
			...(options.sessionId?.trim() ? { sessionId: options.sessionId.trim() } : {}),
			gates: {
				...createDefaultGateBindings(repositoryId),
				...(persistedIntent?.gates ?? {})
			},
			focus: persistedIntent?.focus?.intentGateId ? { intentGateId: persistedIntent.focus.intentGateId } : {},
			clients: {},
			substrate: options.initialSubstrateState
				? structuredClone(options.initialSubstrateState)
				: createDefaultTerminalManagerSubstrateState()
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
			gates: createDefaultGateBindings(repositoryId),
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

	public setTerminalManagerSessionName(sessionName: string): AirportStatus {
		const normalizedSessionName = sessionName.trim();
		if (!normalizedSessionName || normalizedSessionName === this.state.substrate.sessionName) {
			return this.getStatus();
		}

		this.state = {
			...this.state,
			substrate: {
				...createDefaultTerminalManagerSubstrateState({ sessionName: normalizedSessionName }),
				layoutIntent: this.state.substrate.layoutIntent
			}
		};
		return this.getStatus();
	}

	public connectClient(params: ConnectAirportClientParams): AirportStatus {
		if (params.terminalSessionName?.trim()) {
			this.setTerminalManagerSessionName(params.terminalSessionName);
		}
		const now = new Date().toISOString();
		const existing = this.state.clients[params.clientId];
		const clients = releaseClaimedGate(this.state.clients, params.clientId, params.gateId);
		this.state = {
			...this.state,
			focus: deriveFocusState(clients, this.state.focus.intentGateId, this.state.substrate),
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
					claimedGateId: params.gateId,
					...(existing?.focusedGateId ? { focusedGateId: existing.focusedGateId } : {}),
					...(params.panelProcessId?.trim()
						? { panelProcessId: params.panelProcessId.trim() }
						: existing?.panelProcessId
							? { panelProcessId: existing.panelProcessId }
							: {})
				}
			}
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
		const { claimedGateId: _claimedGateId, focusedGateId: _focusedGateId, ...releasedClient } = disconnectedClient;
		const clients = {
			...this.state.clients,
			[clientId]: releasedClient
		};
		this.state = {
			...this.state,
			focus: deriveFocusState(clients, this.state.focus.intentGateId, this.state.substrate),
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
		const clients = {
			...this.state.clients,
			[params.clientId]: {
				...existing,
				lastSeenAt: new Date().toISOString(),
				...(params.surfacePath?.trim() ? { surfacePath: params.surfacePath.trim() } : {}),
				...(params.focusedGateId ? { focusedGateId: params.focusedGateId } : {})
			}
		};

		this.state = {
			...this.state,
			focus: deriveFocusState(clients, params.intentGateId ?? this.state.focus.intentGateId, this.state.substrate),
			clients
		};
		return this.getStatus();
	}

	public bindGate(params: BindAirportGateParams): AirportStatus {
		this.state = {
			...this.state,
			gates: {
				...this.state.gates,
				[params.gateId]: normalizeGateBinding(params.binding)
			}
		};
		return this.getStatus();
	}

	public applyDefaultBindings(
		bindings: Partial<Record<GateId, GateBinding>>,
		options: { focusIntent?: GateId } = {}
	): AirportStatus {
		this.state = {
			...this.state,
			gates: {
				...this.state.gates,
				...(bindings.dashboard ? { dashboard: normalizeGateBinding(bindings.dashboard) } : {}),
				...(bindings.editor ? { editor: normalizeGateBinding(bindings.editor) } : {}),
				...(bindings.agentSession ? { agentSession: normalizeGateBinding(bindings.agentSession) } : {})
			},
			focus: deriveFocusState(this.state.clients, options.focusIntent ?? this.state.focus.intentGateId, this.state.substrate)
		};
		return this.getStatus();
	}

	public observeSubstrate(substrate: AirportSubstrateState): AirportStatus {
		this.state = {
			...this.state,
			substrate: structuredClone(substrate),
			focus: deriveFocusState(this.state.clients, this.state.focus.intentGateId, substrate)
		};
		return this.getStatus();
	}
}

function releaseClaimedGate(
	clients: AirportState['clients'],
	clientId: string,
	gateId: GateId
): AirportState['clients'] {
	const nextClients = { ...clients };
	for (const [candidateClientId, client] of Object.entries(clients)) {
		if (candidateClientId === clientId || !client.connected || client.claimedGateId !== gateId) {
			continue;
		}
		const { claimedGateId: _claimedGateId, ...releasedClient } = client;
		nextClients[candidateClientId] = releasedClient;
	}
	return nextClients;
}

function deriveFocusState(
	clients: AirportState['clients'],
	intentGateId: GateId | undefined,
	substrate: AirportSubstrateState
): AirportFocusState {
	const observedClients = Object.values(clients)
		.filter((client) => client.connected && client.focusedGateId)
		.sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt) || left.clientId.localeCompare(right.clientId));
	const observedGateIdByClientId = Object.fromEntries(
		observedClients.map((client) => [client.clientId, client.focusedGateId as GateId])
	);
	const observedGateId = resolveObservedGateIdFromSubstrate(substrate) ?? observedClients[0]?.focusedGateId;
	return {
		...(intentGateId ? { intentGateId } : {}),
		...(observedGateId ? { observedGateId } : {}),
		...(Object.keys(observedGateIdByClientId).length > 0 ? { observedGateIdByClientId } : {})
	};
}