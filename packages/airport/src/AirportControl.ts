import {
	createDefaultGateBindings,
	deriveAirportProjections,
	type AirportProjectionSet,
	type AirportState,
	type AirportStatus,
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
import {
	createDefaultZellijSubstrateState,
	InMemoryZellijSubstrateController,
	type AirportSubstrateController
} from './zellij.js';

export class AirportControl {
	private state: AirportState;

	public constructor(
		private readonly substrate: AirportSubstrateController = new InMemoryZellijSubstrateController(),
		options: {
			airportId?: string;
			repositoryId?: string;
			repositoryRootPath?: string;
			sessionId?: string;
			persistedIntent?: PersistedAirportIntent;
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
			substrate: this.substrate.getState?.() ?? createDefaultZellijSubstrateState()
		};
	}

	public async scopeToRepository(options: {
		repositoryId: string;
		repositoryRootPath?: string;
		airportId: string;
		sessionName: string;
	}): Promise<AirportStatus> {
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
			substrate: this.substrate.setSessionName(sessionName)
		};
		await this.reconcileSubstrate();
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

	public async setTerminalSessionName(sessionName: string): Promise<AirportStatus> {
		const normalizedSessionName = sessionName.trim();
		if (!normalizedSessionName || normalizedSessionName === this.state.substrate.sessionName) {
			return this.getStatus();
		}

		this.state = {
			...this.state,
			substrate: this.substrate.setSessionName(normalizedSessionName)
		};
		await this.reconcileSubstrate();
		return this.getStatus();
	}

	public async connectClient(params: ConnectAirportClientParams): Promise<AirportStatus> {
		if (params.terminalSessionName?.trim()) {
			await this.setTerminalSessionName(params.terminalSessionName);
		}
		const now = new Date().toISOString();
		const existing = this.state.clients[params.clientId];
		const clients = releaseClaimedGate(this.state.clients, params.clientId, params.gateId);
		this.state = {
			...this.state,
			focus: deriveFocusState(clients, this.state.focus.intentGateId),
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
		await this.reconcileSubstrate();
		return this.getStatus();
	}

	public async disconnectClient(clientId: string): Promise<AirportStatus> {
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
			focus: deriveFocusState(clients, this.state.focus.intentGateId),
			clients: {
				...clients
			}
		};
		await this.reconcileSubstrate();
		return this.getStatus();
	}

	public async observeClient(params: ObserveAirportClientParams): Promise<AirportStatus> {
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
			focus: deriveFocusState(clients, params.intentGateId ?? this.state.focus.intentGateId),
			clients
		};
		await this.reconcileSubstrate();
		return this.getStatus();
	}

	public async bindGate(params: BindAirportGateParams): Promise<AirportStatus> {
		this.state = {
			...this.state,
			gates: {
				...this.state.gates,
				[params.gateId]: normalizeGateBinding(params.binding)
			}
		};
		await this.reconcileSubstrate();
		return this.getStatus();
	}

	public async applyDefaultBindings(
		bindings: Partial<Record<GateId, GateBinding>>,
		options: { focusIntent?: GateId } = {}
	): Promise<AirportStatus> {
		this.state = {
			...this.state,
			gates: {
				...this.state.gates,
				...(bindings.dashboard ? { dashboard: normalizeGateBinding(bindings.dashboard) } : {}),
				...(bindings.editor ? { editor: normalizeGateBinding(bindings.editor) } : {}),
				...(bindings.pilot ? { pilot: normalizeGateBinding(bindings.pilot) } : {})
			},
			focus: {
				...(options.focusIntent ? { intentGateId: options.focusIntent } : this.state.focus.intentGateId ? { intentGateId: this.state.focus.intentGateId } : {}),
				...(this.state.focus.observedGateId ? { observedGateId: this.state.focus.observedGateId } : {}),
				...(this.state.focus.observedGateIdByClientId ? { observedGateIdByClientId: { ...this.state.focus.observedGateIdByClientId } } : {})
			}
		};
		await this.reconcileSubstrate();
		return this.getStatus();
	}

	private async reconcileSubstrate(): Promise<void> {
		this.state = {
			...this.state,
			substrate: await this.substrate.reconcile(this.state)
		};
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
	intentGateId: GateId | undefined
) {
	const observedClients = Object.values(clients)
		.filter((client) => client.connected && client.focusedGateId)
		.sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt) || left.clientId.localeCompare(right.clientId));
	const observedGateIdByClientId = Object.fromEntries(
		observedClients.map((client) => [client.clientId, client.focusedGateId as GateId])
	);
	const observedGateId = observedClients[0]?.focusedGateId;
	return {
		...(intentGateId ? { intentGateId } : {}),
		...(observedGateId ? { observedGateId } : {}),
		...(Object.keys(observedGateIdByClientId).length > 0 ? { observedGateIdByClientId } : {})
	};
}