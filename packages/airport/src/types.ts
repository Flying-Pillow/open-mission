export type GateId = 'dashboard' | 'editor' | 'pilot';

export type GateTargetKind =
	| 'empty'
	| 'repository'
	| 'mission'
	| 'task'
	| 'artifact'
	| 'agentSession';

export type GateMode = 'view' | 'control';

const GATE_IDS = ['dashboard', 'editor', 'pilot'] as const;
const GATE_TARGET_KINDS = ['empty', 'repository', 'mission', 'task', 'artifact', 'agentSession'] as const;
const GATE_MODES = ['view', 'control'] as const;

export interface GateBinding {
	targetKind: GateTargetKind;
	targetId?: string;
	mode?: GateMode;
}

export interface AirportFocusState {
	intentGateId?: GateId;
	observedGateId?: GateId;
	observedGateIdByClientId?: Record<string, GateId>;
}

export interface AirportClientState {
	clientId: string;
	connected: boolean;
	label: string;
	surfacePath?: string;
	claimedGateId?: GateId;
	focusedGateId?: GateId;
	connectedAt: string;
	lastSeenAt: string;
	panelProcessId?: string;
}

export interface AirportPaneState {
	paneId: number;
	expected: boolean;
	exists: boolean;
	title?: string;
}

export interface AirportSubstrateState {
	kind: 'terminal-manager';
	sessionName: string;
	layoutIntent: 'mission-control-v1';
	attached: boolean;
	panesByGate: Partial<Record<GateId, AirportPaneState>>;
	observedFocusedPaneId?: number;
	lastAppliedAt?: string;
	lastObservedAt?: string;
}

export interface AirportState {
	airportId: string;
	repositoryId?: string;
	repositoryRootPath?: string;
	sessionId?: string;
	gates: Record<GateId, GateBinding>;
	focus: AirportFocusState;
	clients: Record<string, AirportClientState>;
	substrate: AirportSubstrateState;
}

export interface PersistedAirportIntent {
	gates?: Partial<Record<GateId, GateBinding>>;
	focus?: {
		intentGateId?: GateId;
	};
}

export interface AirportGateProjectionBase {
	gateId: GateId;
	binding: GateBinding;
	connectedClientIds: string[];
	title: string;
	subtitle: string;
	intentFocused: boolean;
	observedFocused: boolean;
	pane?: AirportPaneState;
}

export type DashboardStageRailItemState = 'done' | 'active' | 'blocked' | 'pending';

export interface DashboardStageRailItem {
	id: string;
	label: string;
	state: DashboardStageRailItemState;
	subtitle?: string;
}

export type DashboardTreeNodeKind = 'stage' | 'stage-artifact' | 'task' | 'task-artifact' | 'session';

export interface DashboardTreeNode {
	id: string;
	label: string;
	kind: DashboardTreeNodeKind;
	depth: number;
	color: string;
	collapsible: boolean;
	sourcePath?: string;
	stageId?: string;
	taskId?: string;
	sessionId?: string;
}

export type DashboardCommandTargetKind = DashboardTreeNodeKind | 'repository' | 'mission';

export interface DashboardCommandContext {
	stageId?: string;
	taskId?: string;
	sessionId?: string;
	targetLabel?: string;
	targetKind?: DashboardCommandTargetKind;
}

export interface DashboardProjection extends AirportGateProjectionBase {
	surfaceMode: 'repository' | 'mission';
	centerRoute: 'repository-flow' | 'mission-control';
	repositoryId?: string;
	repositoryLabel: string;
	missionId?: string;
	missionLabel?: string;
	selectedStageId?: string;
	selectedTaskId?: string;
	selectedSessionId?: string;
	commandContext: DashboardCommandContext;
	stageRail: DashboardStageRailItem[];
	treeNodes: DashboardTreeNode[];
	emptyLabel: string;
}

export interface EditorProjection extends AirportGateProjectionBase {
	artifactId?: string;
	artifactPath?: string;
	resourceLabel?: string;
	launchPath?: string;
	emptyLabel: string;
}

export interface PilotProjection extends AirportGateProjectionBase {
	sessionId?: string;
	taskId?: string;
	missionId?: string;
	workingDirectory?: string;
	sessionLabel?: string;
	statusLabel: string;
	emptyLabel: string;
}

export interface AirportProjectionSet {
	dashboard: DashboardProjection;
	editor: EditorProjection;
	pilot: PilotProjection;
}

export interface AirportStatus {
	state: AirportState;
	projections: AirportProjectionSet;
}

export interface ConnectAirportClientParams {
	clientId: string;
	label?: string;
	surfacePath?: string;
	gateId: GateId;
	panelProcessId?: string;
	terminalSessionName?: string;
}

export interface ObserveAirportClientParams {
	clientId: string;
	focusedGateId?: GateId;
	intentGateId?: GateId;
	surfacePath?: string;
}

export interface BindAirportGateParams {
	gateId: GateId;
	binding: GateBinding;
}

export function derivePersistedAirportIntent(state: AirportState): PersistedAirportIntent {
	return {
		gates: {
			dashboard: normalizeGateBinding(state.gates.dashboard),
			editor: normalizeGateBinding(state.gates.editor),
			pilot: normalizeGateBinding(state.gates.pilot)
		},
		...(state.focus.intentGateId
			? {
				focus: {
					intentGateId: state.focus.intentGateId
				}
			}
			: {})
	};
}

export function normalizePersistedAirportIntent(intent: unknown): PersistedAirportIntent | undefined {
	if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
		return undefined;
	}

	const gates = normalizePersistedAirportGates((intent as { gates?: unknown }).gates);
	const focus = normalizePersistedAirportFocus((intent as { focus?: unknown }).focus);
	if (!gates && !focus) {
		return undefined;
	}

	return {
		...(gates ? { gates } : {}),
		...(focus ? { focus } : {})
	};
}

export function createEmptyGateBinding(): GateBinding {
	return { targetKind: 'empty' };
}

export function createDefaultGateBindings(repositoryId?: string): Record<GateId, GateBinding> {
	return {
		dashboard: repositoryId
			? { targetKind: 'repository', targetId: repositoryId, mode: 'control' }
			: { targetKind: 'repository', mode: 'control' },
		editor: repositoryId
			? { targetKind: 'repository', targetId: repositoryId, mode: 'view' }
			: createEmptyGateBinding(),
		pilot: createEmptyGateBinding()
	};
}

export function deriveAirportProjections(state: AirportState): AirportProjectionSet {
	return {
		dashboard: createDashboardProjection(state),
		editor: createEditorProjection(state),
		pilot: createPilotProjection(state)
	};
}

function createGateProjectionBase(state: AirportState, gateId: GateId): AirportGateProjectionBase {
	const binding = state.gates[gateId];
	const pane = state.substrate.panesByGate[gateId];
	return {
		gateId,
		binding: structuredClone(binding),
		connectedClientIds: Object.values(state.clients)
			.filter((client) => client.connected && client.claimedGateId === gateId)
			.map((client) => client.clientId),
		title: formatGateTitle(gateId),
		subtitle: formatGateSubtitle(binding),
		intentFocused: state.focus.intentGateId === gateId,
		observedFocused: state.focus.observedGateId === gateId,
		...(pane ? { pane: { ...pane } } : {})
	};
}

function createDashboardProjection(state: AirportState): DashboardProjection {
	const base = createGateProjectionBase(state, 'dashboard');
	const binding = base.binding;
	const missionId = binding.targetKind === 'mission' ? binding.targetId : undefined;
	const repositoryId = state.repositoryId ?? (binding.targetKind === 'repository' ? binding.targetId : undefined);
	const repositoryLabel = state.repositoryRootPath?.trim() || repositoryId || 'Repository';
	return {
		...base,
		surfaceMode: missionId ? 'mission' : 'repository',
		centerRoute: missionId ? 'mission-control' : 'repository-flow',
		...(repositoryId ? { repositoryId } : {}),
		repositoryLabel,
		...(missionId ? { missionId, missionLabel: missionId } : {}),
		commandContext: {},
		stageRail: [],
		treeNodes: [],
		emptyLabel: missionId
			? 'No mission-control projection is available yet.'
			: 'Repository mode is ready.'
	};
}

function createEditorProjection(state: AirportState): EditorProjection {
	const base = createGateProjectionBase(state, 'editor');
	const binding = base.binding;
	const artifactId = binding.targetKind === 'artifact' ? binding.targetId : undefined;
	const launchPath = state.repositoryRootPath?.trim() || state.repositoryId?.trim();
	return {
		...base,
		...(artifactId ? { artifactId, resourceLabel: artifactId } : {}),
		...(launchPath ? { launchPath } : {}),
		emptyLabel: artifactId
			? 'Artifact path is resolving for the editor gate.'
			: 'Editor gate is waiting for an artifact binding.'
	};
}

function createPilotProjection(state: AirportState): PilotProjection {
	const base = createGateProjectionBase(state, 'pilot');
	const binding = base.binding;
	const sessionId = binding.targetKind === 'agentSession' ? binding.targetId : undefined;
	return {
		...base,
		...(sessionId ? { sessionId, sessionLabel: sessionId } : {}),
		statusLabel: sessionId ? 'bound' : 'idle',
		emptyLabel: sessionId
			? 'Pilot session details are resolving.'
			: 'Pilot gate is idle.'
	};
}

export function normalizeGateBinding(binding: GateBinding): GateBinding {
	return {
		targetKind: binding.targetKind,
		...(binding.targetId?.trim() ? { targetId: binding.targetId.trim() } : {}),
		...(binding.mode ? { mode: binding.mode } : {})
	};
}

function formatGateTitle(gateId: GateId): string {
	switch (gateId) {
		case 'dashboard':
			return 'Dashboard';
		case 'editor':
			return 'Editor';
		case 'pilot':
			return 'Pilot';
	}
	return gateId;
}

function formatGateSubtitle(binding: GateBinding): string {
	if (binding.targetKind === 'empty') {
		return 'No target bound';
	}

	const targetLabel = binding.targetId?.trim() || 'unresolved';
	return binding.mode ? `${binding.targetKind}:${targetLabel} (${binding.mode})` : `${binding.targetKind}:${targetLabel}`;
}

function normalizePersistedAirportGates(value: unknown): Partial<Record<GateId, GateBinding>> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	const entries = GATE_IDS
		.map((gateId) => {
			const binding = normalizePersistedGateBinding((value as Partial<Record<GateId, unknown>>)[gateId]);
			return binding ? [gateId, binding] as const : undefined;
		})
		.filter((entry): entry is readonly [GateId, GateBinding] => entry !== undefined);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizePersistedAirportFocus(value: unknown): PersistedAirportIntent['focus'] | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	const intentGateId = (value as { intentGateId?: unknown }).intentGateId;
	return isGateId(intentGateId)
		? {
			intentGateId
		}
		: undefined;
}

function normalizePersistedGateBinding(value: unknown): GateBinding | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	const targetKind = (value as { targetKind?: unknown }).targetKind;
	if (!isGateTargetKind(targetKind)) {
		return undefined;
	}

	const targetId = (value as { targetId?: unknown }).targetId;
	const mode = (value as { mode?: unknown }).mode;
	return normalizeGateBinding({
		targetKind,
		...(typeof targetId === 'string' ? { targetId } : {}),
		...(isGateMode(mode) ? { mode } : {})
	});
}

function isGateId(value: unknown): value is GateId {
	return typeof value === 'string' && (GATE_IDS as readonly string[]).includes(value);
}

function isGateTargetKind(value: unknown): value is GateTargetKind {
	return typeof value === 'string' && (GATE_TARGET_KINDS as readonly string[]).includes(value);
}

function isGateMode(value: unknown): value is GateMode {
	return typeof value === 'string' && (GATE_MODES as readonly string[]).includes(value);
}