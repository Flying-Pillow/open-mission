// /packages/core/src/airport/types.ts: Shared airport state and view contracts for Mission surfaces.
export type AirportPaneId = 'tower' | 'briefingRoom' | 'runway';

export type PaneTargetKind =
	| 'empty'
	| 'repository'
	| 'mission'
	| 'task'
	| 'artifact'
	| 'agentSession';

export type PaneMode = 'view' | 'control';

export interface PaneBinding {
	targetKind: PaneTargetKind;
	targetId?: string;
	mode?: PaneMode;
}

export type AirportPaneOverrides = Partial<Record<Exclude<AirportPaneId, 'tower'>, PaneBinding>>;

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
	defaultPanes: Record<AirportPaneId, PaneBinding>;
	paneOverrides: AirportPaneOverrides;
	panes: Record<AirportPaneId, PaneBinding>;
	focus: AirportFocusState;
	clients: Record<string, AirportClientState>;
	substrate: AirportSubstrateState;
}

export interface PersistedAirportIntent {
	panes?: AirportPaneOverrides;
	focus?: {
		intentPaneId?: AirportPaneId;
	};
}

export interface AirportPaneViewBase {
	paneId: AirportPaneId;
	binding: PaneBinding;
	connectedClientIds: string[];
	title: string;
	subtitle: string;
	intentFocused: boolean;
	observedFocused: boolean;
	terminalPane?: AirportPaneState;
}

export interface TowerGitHubAuthView {
	cliAvailable: boolean;
	authenticated: boolean;
	user?: string;
	detail?: string;
}

export interface TowerView extends AirportPaneViewBase {
	repositoryId?: string;
	repositoryLabel: string;
	emptyLabel: string;
	github: TowerGitHubAuthView;
}

export interface BriefingRoomView extends AirportPaneViewBase {
	artifactId?: string;
	artifactPath?: string;
	resourceLabel?: string;
	launchPath?: string;
	emptyLabel: string;
}

export interface RunwayView extends AirportPaneViewBase {
	sessionId?: string;
	taskId?: string;
	missionId?: string;
	workingDirectory?: string;
	sessionLabel?: string;
	statusLabel: string;
	emptyLabel: string;
}

export interface AirportViewSet {
	tower: TowerView;
	briefingRoom: BriefingRoomView;
	runway: RunwayView;
}

export interface AirportStatus {
	state: AirportState;
	views: AirportViewSet;
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