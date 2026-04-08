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

	public async connectClient(params: ConnectAirportClientParams): Promise<AirportStatus> {
		const now = new Date().toISOString();
		const existing = this.state.clients[params.clientId];
		this.state = {
			...this.state,
			clients: {
				...this.state.clients,
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
					...(params.gateId ? { claimedGateId: params.gateId } : existing?.claimedGateId ? { claimedGateId: existing.claimedGateId } : {}),
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
		this.state = {
			...this.state,
			clients: {
				...this.state.clients,
				[clientId]: {
					...existing,
					connected: false,
					lastSeenAt: new Date().toISOString()
				}
			}
		};
		if (this.state.focus.observedGateId && existing.focusedGateId === this.state.focus.observedGateId) {
			this.state = {
				...this.state,
				focus: {
					...(this.state.focus.intentGateId ? { intentGateId: this.state.focus.intentGateId } : {})
				}
			};
		}
		await this.reconcileSubstrate();
		return this.getStatus();
	}

	public async observeClient(params: ObserveAirportClientParams): Promise<AirportStatus> {
		const existing = this.state.clients[params.clientId];
		if (!existing) {
			throw new Error(`Airport client '${params.clientId}' is not registered.`);
		}

		this.state = {
			...this.state,
			focus: {
				...(params.intentGateId ? { intentGateId: params.intentGateId } : this.state.focus.intentGateId ? { intentGateId: this.state.focus.intentGateId } : {}),
				...(params.focusedGateId ? { observedGateId: params.focusedGateId } : {})
			},
			clients: {
				...this.state.clients,
				[params.clientId]: {
					...existing,
					lastSeenAt: new Date().toISOString(),
					...(params.surfacePath?.trim() ? { surfacePath: params.surfacePath.trim() } : {}),
					...(params.focusedGateId ? { focusedGateId: params.focusedGateId } : {})
				}
			}
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
				...(this.state.focus.observedGateId ? { observedGateId: this.state.focus.observedGateId } : {})
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