export type AirportPaneId = 'tower' | 'briefingRoom' | 'runway';

export type PaneTargetKind =
	| 'empty'
	| 'repository'
	| 'mission'
	| 'task'
	| 'artifact'
	| 'agentSession';

export type PaneMode = 'view' | 'control';

const PERSISTED_AIRPORT_PANE_IDS = ['tower', 'briefingRoom'] as const;
const PANE_TARGET_KINDS = ['empty', 'repository', 'mission', 'task', 'artifact', 'agentSession'] as const;
const PANE_MODES = ['view', 'control'] as const;

export interface PaneBinding {
	targetKind: PaneTargetKind;
	targetId?: string;
	mode?: PaneMode;
}

export interface AirportFocusState {
	intentPaneId?: AirportPaneId;
	observedPaneId?: AirportPaneId;
	observedPaneIdByClientId?: Record<string, AirportPaneId>;
}

export interface AirportClientState {
	clientId: string;
	connected: boolean;
	label: string;
	surfacePath?: string;
	claimedPaneId?: AirportPaneId;
	focusedPaneId?: AirportPaneId;
	connectedAt: string;
	lastSeenAt: string;
	panelProcessId?: string;
}

export interface AirportPaneState {
	terminalPaneId: number;
	expected: boolean;
	exists: boolean;
	title?: string;
}

export interface AirportSubstrateState {
	kind: 'terminal-manager';
	sessionName: string;
	layoutIntent: 'mission-control-v1';
	attached: boolean;
	panes: Partial<Record<AirportPaneId, AirportPaneState>>;
	observedFocusedTerminalPaneId?: number;
	lastAppliedAt?: string;
	lastObservedAt?: string;
}

export interface AirportState {
	airportId: string;
	repositoryId?: string;
	repositoryRootPath?: string;
	sessionId?: string;
	panes: Record<AirportPaneId, PaneBinding>;
	focus: AirportFocusState;
	clients: Record<string, AirportClientState>;
	substrate: AirportSubstrateState;
}

export interface PersistedAirportIntent {
	panes?: Partial<Record<AirportPaneId, PaneBinding>>;
	focus?: {
		intentPaneId?: AirportPaneId;
	};
}

export interface AirportPaneProjectionBase {
	paneId: AirportPaneId;
	binding: PaneBinding;
	connectedClientIds: string[];
	title: string;
	subtitle: string;
	intentFocused: boolean;
	observedFocused: boolean;
	terminalPane?: AirportPaneState;
}

export interface TowerProjection extends AirportPaneProjectionBase {
	repositoryId?: string;
	repositoryLabel: string;
	emptyLabel: string;
}

export interface BriefingRoomProjection extends AirportPaneProjectionBase {
	artifactId?: string;
	artifactPath?: string;
	resourceLabel?: string;
	launchPath?: string;
	emptyLabel: string;
}

export interface RunwayProjection extends AirportPaneProjectionBase {
	sessionId?: string;
	taskId?: string;
	missionId?: string;
	workingDirectory?: string;
	sessionLabel?: string;
	statusLabel: string;
	emptyLabel: string;
}

export interface AirportProjectionSet {
	tower: TowerProjection;
	briefingRoom: BriefingRoomProjection;
	runway: RunwayProjection;
}

export interface AirportStatus {
	state: AirportState;
	projections: AirportProjectionSet;
}

export interface ConnectAirportClientParams {
	clientId: string;
	label?: string;
	surfacePath?: string;
	paneId: AirportPaneId;
	panelProcessId?: string;
	terminalPaneId?: number;
}

export interface ObserveAirportClientParams {
	clientId: string;
	focusedPaneId?: AirportPaneId;
	intentPaneId?: AirportPaneId;
	surfacePath?: string;
	terminalPaneId?: number;
}

export interface BindAirportPaneParams {
	paneId: Exclude<AirportPaneId, 'tower'>;
	binding: PaneBinding;
}

export function derivePersistedAirportIntent(state: AirportState): PersistedAirportIntent {
	return {
		panes: {
			tower: normalizePaneBinding(state.panes.tower),
			briefingRoom: normalizePaneBinding(state.panes.briefingRoom)
		},
		...(state.focus.intentPaneId && state.focus.intentPaneId !== 'runway'
			? {
				focus: {
					intentPaneId: state.focus.intentPaneId
				}
			}
			: {})
	};
}

export function normalizePersistedAirportIntent(intent: unknown): PersistedAirportIntent | undefined {
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

export function createEmptyPaneBinding(): PaneBinding {
	return { targetKind: 'empty' };
}

export function createDefaultPaneBindings(repositoryId: string): Record<AirportPaneId, PaneBinding> {
	return {
		tower: { targetKind: 'repository', targetId: repositoryId, mode: 'control' },
		briefingRoom: { targetKind: 'repository', targetId: repositoryId, mode: 'view' },
		runway: createEmptyPaneBinding()
	};
}

export function deriveAirportProjections(state: AirportState): AirportProjectionSet {
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
		emptyLabel: 'Tower is ready.'
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

export function normalizePaneBinding(binding: PaneBinding): PaneBinding {
	return {
		targetKind: binding.targetKind,
		...(binding.targetId?.trim() ? { targetId: binding.targetId.trim() } : {}),
		...(binding.mode ? { mode: binding.mode } : {})
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

function normalizePersistedAirportPanes(value: unknown): Partial<Record<AirportPaneId, PaneBinding>> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	const entries = PERSISTED_AIRPORT_PANE_IDS
		.map((paneId) => {
			const binding = normalizePersistedPaneBinding((value as Partial<Record<AirportPaneId, unknown>>)[paneId]);
			return binding ? [paneId, binding] as const : undefined;
		})
		.filter((entry): entry is readonly [(typeof PERSISTED_AIRPORT_PANE_IDS)[number], PaneBinding] => entry !== undefined);
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

function isPersistedAirportPaneId(value: unknown): value is (typeof PERSISTED_AIRPORT_PANE_IDS)[number] {
	return typeof value === 'string' && (PERSISTED_AIRPORT_PANE_IDS as readonly string[]).includes(value);
}

function isPaneTargetKind(value: unknown): value is PaneTargetKind {
	return typeof value === 'string' && (PANE_TARGET_KINDS as readonly string[]).includes(value);
}

function isPaneMode(value: unknown): value is PaneMode {
	return typeof value === 'string' && (PANE_MODES as readonly string[]).includes(value);
}