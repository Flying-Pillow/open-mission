import {
	type AirportPaneOverrides,
	type AirportFocusState,
	type AirportPaneProjectionBase,
	type AirportProjectionSet,
	type AirportState,
	type AirportStatus,
	type BriefingRoomProjection,
	type AirportSubstrateState,
	type BindAirportPaneParams,
	type ConnectAirportClientParams,
	type PaneBinding,
	type PaneMode,
	type PaneTargetKind,
	type RunwayProjection,
	type AirportPaneId,
	type PersistedAirportIntent,
	type TowerProjection,
	type ObserveAirportClientParams
} from './types.js';

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
		const defaultPanes = createDefaultPaneBindings(repositoryId);
		const paneOverrides = normalizePaneOverrides(persistedIntent?.panes, defaultPanes);

		this.state = {
			airportId,
			repositoryId,
			...(options.repositoryRootPath?.trim() ? { repositoryRootPath: options.repositoryRootPath.trim() } : {}),
			...(options.sessionId?.trim() ? { sessionId: options.sessionId.trim() } : {}),
			defaultPanes,
			paneOverrides,
			panes: createEffectivePaneBindings(defaultPanes, paneOverrides),
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
		const defaultPanes = createDefaultPaneBindings(repositoryId);
		const paneOverrides = normalizePaneOverrides(this.state.paneOverrides, defaultPanes);

		this.state = {
			...this.state,
			airportId,
			repositoryId,
			...(repositoryRootPath ? { repositoryRootPath } : {}),
			defaultPanes,
			paneOverrides,
			panes: createEffectivePaneBindings(defaultPanes, paneOverrides),
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
		const { claimedPaneId, focusedPaneId, ...releasedClient } = disconnectedClient;
		void claimedPaneId;
		void focusedPaneId;
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
		const nextBinding = normalizePaneBinding(params.binding);
		const paneOverrides = setPaneOverride(
			this.state.paneOverrides,
			params.paneId,
			nextBinding,
			this.state.defaultPanes
		);
		this.state = {
			...this.state,
			paneOverrides,
			panes: createEffectivePaneBindings(this.state.defaultPanes, paneOverrides)
		};
		return this.getStatus();
	}

	public applyDefaultBindings(
		bindings: Partial<Record<AirportPaneId, PaneBinding>>,
		options: { focusIntent?: AirportPaneId } = {}
	): AirportStatus {
		const defaultPanes = {
			...this.state.defaultPanes,
			...(bindings.tower ? { tower: normalizePaneBinding(bindings.tower) } : {}),
			...(bindings.briefingRoom ? { briefingRoom: normalizePaneBinding(bindings.briefingRoom) } : {}),
			...(bindings.runway ? { runway: normalizePaneBinding(bindings.runway) } : {})
		};
		const paneOverrides = normalizePaneOverrides(this.state.paneOverrides, defaultPanes);
		this.state = {
			...this.state,
			defaultPanes,
			paneOverrides,
			panes: createEffectivePaneBindings(defaultPanes, paneOverrides),
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

function createEffectivePaneBindings(
	defaultPanes: Record<AirportPaneId, PaneBinding>,
	paneOverrides: AirportPaneOverrides
): Record<AirportPaneId, PaneBinding> {
	return {
		...defaultPanes,
		...(paneOverrides.briefingRoom ? { briefingRoom: paneOverrides.briefingRoom } : {}),
		...(paneOverrides.runway ? { runway: paneOverrides.runway } : {})
	};
}

function normalizePaneOverrides(
	overrides: AirportPaneOverrides | undefined,
	defaultPanes: Record<AirportPaneId, PaneBinding>
): AirportPaneOverrides {
	const normalizedOverrides: AirportPaneOverrides = {};
	for (const paneId of ['briefingRoom', 'runway'] as const) {
		const override = overrides?.[paneId];
		if (!override) {
			continue;
		}
		const normalizedOverride = normalizePaneBinding(override);
		if (arePaneBindingsEqual(normalizedOverride, defaultPanes[paneId])) {
			continue;
		}
		normalizedOverrides[paneId] = normalizedOverride;
	}
	return normalizedOverrides;
}

function setPaneOverride(
	overrides: AirportPaneOverrides,
	paneId: Exclude<AirportPaneId, 'tower'>,
	binding: PaneBinding,
	defaultPanes: Record<AirportPaneId, PaneBinding>
): AirportPaneOverrides {
	const nextOverrides = { ...overrides };
	if (arePaneBindingsEqual(binding, defaultPanes[paneId])) {
		delete nextOverrides[paneId];
		return nextOverrides;
	}
	nextOverrides[paneId] = binding;
	return nextOverrides;
}

function arePaneBindingsEqual(left: PaneBinding, right: PaneBinding): boolean {
	return left.targetKind === right.targetKind
		&& (left.targetId ?? '') === (right.targetId ?? '')
		&& (left.mode ?? '') === (right.mode ?? '');
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
		const { claimedPaneId, ...releasedClient } = client;
		void claimedPaneId;
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

function createEmptyPaneBinding(): PaneBinding {
	return { targetKind: 'empty' };
}

function createDefaultPaneBindings(repositoryId: string): Record<AirportPaneId, PaneBinding> {
	return {
		tower: { targetKind: 'repository', targetId: repositoryId, mode: 'control' },
		briefingRoom: { targetKind: 'repository', targetId: repositoryId, mode: 'view' },
		runway: createEmptyPaneBinding()
	};
}

function normalizePaneBinding(binding: PaneBinding): PaneBinding {
	return {
		targetKind: binding.targetKind,
		...(binding.targetId?.trim() ? { targetId: binding.targetId.trim() } : {}),
		...(binding.mode ? { mode: binding.mode } : {})
	};
}

function derivePersistedAirportIntent(state: AirportState): PersistedAirportIntent {
	const panes = Object.keys(state.paneOverrides).length > 0
		? { ...state.paneOverrides }
		: undefined;
	return {
		...(panes ? { panes } : {}),
		...(state.focus.intentPaneId && state.focus.intentPaneId !== 'runway'
			? {
				focus: {
					intentPaneId: state.focus.intentPaneId
				}
			}
			: {})
	};
}

function normalizePersistedAirportIntent(intent: unknown): PersistedAirportIntent | undefined {
	if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
		return undefined;
	}

	const panes = normalizePersistedAirportPanes((intent as { panes?: unknown }).panes);
	const focus = normalizePersistedAirportFocus((intent as { focus?: unknown }).focus);
	if (!panes && !focus) {
		return undefined;
	}

	return {
		...(panes ? { panes } : {}),
		...(focus ? { focus } : {})
	};
}

function normalizePersistedAirportPanes(value: unknown): Partial<Record<AirportPaneId, PaneBinding>> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	const persistedPaneIds = ['briefingRoom'] as const;
	const entries = persistedPaneIds
		.map((paneId) => {
			const binding = normalizePersistedPaneBinding((value as Partial<Record<AirportPaneId, unknown>>)[paneId]);
			return binding ? [paneId, binding] as const : undefined;
		})
		.filter((entry): entry is readonly ['briefingRoom', PaneBinding] => entry !== undefined);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizePersistedAirportFocus(value: unknown): PersistedAirportIntent['focus'] | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	const intentPaneId = (value as { intentPaneId?: unknown }).intentPaneId;
	return isPersistedAirportPaneId(intentPaneId)
		? {
			intentPaneId
		}
		: undefined;
}

function normalizePersistedPaneBinding(value: unknown): PaneBinding | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	const targetKind = (value as { targetKind?: unknown }).targetKind;
	if (!isPaneTargetKind(targetKind)) {
		return undefined;
	}

	const targetId = (value as { targetId?: unknown }).targetId;
	const mode = (value as { mode?: unknown }).mode;
	return normalizePaneBinding({
		targetKind,
		...(typeof targetId === 'string' ? { targetId } : {}),
		...(isPaneMode(mode) ? { mode } : {})
	});
}

function isPersistedAirportPaneId(value: unknown): value is 'briefingRoom' {
	return value === 'briefingRoom';
}

function isPaneTargetKind(value: unknown): value is PaneTargetKind {
	return typeof value === 'string' && ['empty', 'repository', 'mission', 'task', 'artifact', 'agentSession'].includes(value);
}

function isPaneMode(value: unknown): value is PaneMode {
	return value === 'view' || value === 'control';
}

function deriveAirportProjections(state: AirportState): AirportProjectionSet {
	return {
		tower: createTowerProjection(state),
		briefingRoom: createBriefingRoomProjection(state),
		runway: createRunwayProjection(state)
	};
}

function createPaneProjectionBase(state: AirportState, paneId: AirportPaneId): AirportPaneProjectionBase {
	const binding = state.panes[paneId];
	const terminalPane = state.substrate.panes[paneId];
	return {
		paneId,
		binding: structuredClone(binding),
		connectedClientIds: Object.values(state.clients)
			.filter((client) => client.connected && client.claimedPaneId === paneId)
			.map((client) => client.clientId),
		title: formatPaneTitle(paneId),
		subtitle: formatPaneSubtitle(binding),
		intentFocused: state.focus.intentPaneId === paneId,
		observedFocused: state.focus.observedPaneId === paneId,
		...(terminalPane ? { terminalPane: { ...terminalPane } } : {})
	};
}

function createTowerProjection(state: AirportState): TowerProjection {
	const base = createPaneProjectionBase(state, 'tower');
	const binding = base.binding;
	const repositoryId = state.repositoryId ?? (binding.targetKind === 'repository' ? binding.targetId : undefined);
	const repositoryLabel = state.repositoryRootPath?.trim() || repositoryId || 'Repository';
	return {
		...base,
		...(repositoryId ? { repositoryId } : {}),
		repositoryLabel,
		emptyLabel: 'Tower is ready.',
		github: {
			cliAvailable: false,
			authenticated: false
		}
	};
}

function createBriefingRoomProjection(state: AirportState): BriefingRoomProjection {
	const base = createPaneProjectionBase(state, 'briefingRoom');
	const binding = base.binding;
	const artifactId = binding.targetKind === 'artifact' ? binding.targetId : undefined;
	const launchPath = state.repositoryRootPath?.trim() || state.repositoryId?.trim();
	return {
		...base,
		...(artifactId ? { artifactId, resourceLabel: artifactId } : {}),
		...(launchPath ? { launchPath } : {}),
		emptyLabel: artifactId
			? 'Artifact path is resolving for Briefing Room.'
			: 'Briefing Room is waiting for an artifact binding.'
	};
}

function createRunwayProjection(state: AirportState): RunwayProjection {
	const base = createPaneProjectionBase(state, 'runway');
	const binding = base.binding;
	const sessionId = binding.targetKind === 'agentSession' ? binding.targetId : undefined;
	return {
		...base,
		...(sessionId ? { sessionId, sessionLabel: sessionId } : {}),
		statusLabel: sessionId ? 'bound' : 'idle',
		emptyLabel: sessionId
			? 'Agent session details are resolving for Runway.'
			: 'Runway is idle.'
	};
}

function formatPaneTitle(paneId: AirportPaneId): string {
	switch (paneId) {
		case 'tower':
			return 'Tower';
		case 'briefingRoom':
			return 'Briefing Room';
		case 'runway':
			return 'Runway';
	}
	return paneId;
}

function formatPaneSubtitle(binding: PaneBinding): string {
	if (binding.targetKind === 'empty') {
		return 'No target bound';
	}

	const targetLabel = binding.targetId?.trim() || 'unresolved';
	return binding.mode ? `${binding.targetKind}:${targetLabel} (${binding.mode})` : `${binding.targetKind}:${targetLabel}`;
}

function resolveObservedPaneIdFromSubstrate(substrate: AirportSubstrateState): AirportPaneId | undefined {
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

function createDefaultTerminalManagerSubstrateState(options: { sessionName: string }): AirportSubstrateState {
	const sessionName = options.sessionName.trim();
	if (!sessionName) {
		throw new Error('Airport substrate requires a repository-scoped terminal session name.');
	}

	return {
		kind: 'terminal-manager',
		sessionName,
		layoutIntent: 'mission-control-v1',
		attached: false,
		panes: {}
	};
}