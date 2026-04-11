/** @jsxImportSource @opentui/solid */

import { spawn } from 'node:child_process';
import path from 'node:path';
import type {
	DaemonClient,
	GateIntent,
	MissionSystemSnapshot,
	OperatorActionDescriptor,
	OperatorActionQueryContext,
	OperatorActionTargetContext,
	OperatorActionExecutionStep,
	OperatorActionFlowDescriptor,
	OperatorActionFlowStep,
	MissionSelector,
	MissionStageId,
	MissionStageStatus,
	MissionTaskState,
	MissionSelectionCandidate,
	MissionRepositoryCandidate,
	OperatorStatus,
	MissionAgentSessionRecord,
	ContextGraph,
	TrackedIssueSummary,
	MissionWorkspaceContext
} from '@flying-pillow/mission-core';
import {
	DaemonApi,
} from '@flying-pillow/mission-core';
import { useKeyboard, useRenderer } from '@opentui/solid';
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSXElement } from 'solid-js';
import { TowerScreen } from './components/TowerScreen.js';
import { IntroSplash } from './components/IntroSplash.js';
import { applyTowerTheme, towerTheme, type TowerThemeName, isTowerThemeName } from './components/towerTheme.js';
import type { ProgressRailItem } from './components/progressModels.js';
import type { CommandItem, FocusArea, SelectItem } from './components/types.js';
import { CommandPickerPanel } from './components/command/CommandPickerPanel.js';
import type { CommandToolbarItem } from './components/command/commandDomain.js';
import {
	buildDefaultCollapsedTreeNodeIds,
	buildVisibleTreeTargets,
	createSessionNodeId,
	moveTreeTargetSelection,
	pickPreferredStageId,
	pickPreferredTreeTargetId,
	type TreeTargetDescriptor,
	type TreeTargetKind
} from './components/mission-control/MissionControlDomain.js';
import { MissionControlPanel } from './components/mission-control/MissionControlPanel.js';
import { MissionFlowOverlay, RepositoryFlowSurface } from './components/flow/FlowPanels.js';
import { createCommandFlowController } from './components/flow/createCommandFlowController.js';
import {
	buildCommandFlowStep,
	buildExecuteCommandSteps,
	buildFlowStepTitle,
	buildThemePickerItems,
	type CommandFlowCompletion,
	type CommandFlowDefinition,
	type CommandFlowResult,
	type CommandFlowSelectionValue,
	type CommandFlowState,
	type CommandFlowStep,
	type CommandFlowStepValue,
} from './components/flow/flowEngine.js';
import type { TowerConnectRequest } from './bootstrapTowerPane.js';

export type TowerConnection = {
	client: DaemonClient;
	snapshot: MissionSystemSnapshot;
	status: OperatorStatus;
	dispose: () => void;
};

export type TowerUiOptions = {
	workspaceContext: MissionWorkspaceContext;
	initialSelector: MissionSelector;
	initialTheme: TowerThemeName;
	initialShowIntroSplash?: boolean;
	initialConnection?: TowerConnection;
	initialConnectionError?: string;
	connect: (request?: TowerConnectRequest) => Promise<TowerConnection>;
};

type TowerShellProps = TowerUiOptions;

type DaemonState = 'connected' | 'degraded' | 'booting';
type TowerMode = 'repository' | 'mission';
type PickerMode = 'command-select';
type CenterRoute =
	| { kind: 'repository-flow' }
	| { kind: 'mission-control' };
type ShellOverlay =
	| { kind: 'none' }
	| { kind: 'command-select' }
	| { kind: 'mission-flow' };
type CommandPanelDescriptor = {
	title: string;
	placeholder: string;
};
type HeaderTab = {
	id: string;
	label: string;
	target: { kind: 'repository' } | { kind: 'mission'; missionId: string };
};

type HeaderMissionSummary = {
	typeLabel: string;
	numberLabel: string;
	title: string;
};
const repositoryFocusOrder: FocusArea[] = ['header', 'flow', 'command'];
const missionFocusOrder: FocusArea[] = ['header', 'tree', 'command'];

export function TowerController({
	workspaceContext,
	initialSelector,
	initialTheme,
	initialShowIntroSplash,
	initialConnection,
	initialConnectionError,
	connect
}: TowerShellProps) {
	const renderer = useRenderer();
	const [selector, setSelector] = createSignal<MissionSelector>(initialSelector);
	const [connection, setConnection] = createSignal<TowerConnection | undefined>(initialConnection);
	const [status, setStatus] = createSignal<OperatorStatus>(initialConnection?.status ?? { found: false });
	const [systemSnapshot, setSystemSnapshot] = createSignal<MissionSystemSnapshot | undefined>(initialConnection?.snapshot);
	const [daemonState, setDaemonState] = createSignal<DaemonState>(
		initialConnection ? 'connected' : initialConnectionError ? 'degraded' : 'booting'
	);
	const [, setActivityLog] = createSignal<string[]>([
		createInitialStatusMessage(initialConnectionError)
	]);
	const [inputValue, setInputValue] = createSignal<string>('');
	const [isRunningCommand, setIsRunningCommand] = createSignal<boolean>(false);
	const [focusArea, setFocusArea] = createSignal<FocusArea>('command');
	const [activePicker, setActivePicker] = createSignal<PickerMode | undefined>();
	const [commandPickerQuery, setCommandPickerQuery] = createSignal<string>('');
	const [selectedPickerItemId, setSelectedPickerItemId] = createSignal<string | undefined>();
	const [selectedCommandId, setSelectedCommandId] = createSignal<string | undefined>();
	const [openIssues, setOpenIssues] = createSignal<TrackedIssueSummary[]>([]);
	const [selectedStageId, setSelectedStageId] = createSignal<MissionStageId | undefined>(initialConnection?.status.stage);
	const currentControlRoot = createMemo(() => status().control?.controlRoot?.trim() || workspaceContext.workspaceRoot);
	const [selectedTaskId, setSelectedTaskId] = createSignal<string>('');
	const [selectedSessionId, setSelectedSessionId] = createSignal<string | undefined>();
	const [selectedTreeTargetId, setSelectedTreeTargetId] = createSignal<string | undefined>();
	const [collapsedTreeNodeIds, setCollapsedTreeNodeIds] = createSignal<Set<string>>(new Set<string>());
	const [treePageScrollRequest, setTreePageScrollRequest] = createSignal<{ delta: number } | undefined>();
	const [collapseDefaultsMissionId, setCollapseDefaultsMissionId] = createSignal<string | undefined>();
	const [selectedThemeName, setSelectedThemeName] = createSignal<TowerThemeName>(initialTheme);
	let lastObservedSelectionKey: string | undefined;
	const [fallbackGitHubUser, setFallbackGitHubUser] = createSignal<string | undefined>();
	const [isGitHubUserProbeInFlight, setIsGitHubUserProbeInFlight] = createSignal<boolean>(false);
	const [fallbackControlBranch, setFallbackControlBranch] = createSignal<string | undefined>();
	const [isControlBranchProbeInFlight, setIsControlBranchProbeInFlight] = createSignal<boolean>(false);
	const [selectedHeaderTabId, setSelectedHeaderTabId] = createSignal<string | undefined>();
	const [showIntroSplash, setShowIntroSplash] = createSignal<boolean>(initialShowIntroSplash ?? true);
	const [selectedToolbarCommandId, setSelectedToolbarCommandId] = createSignal<string | undefined>();
	const [confirmingToolbarCommandId, setConfirmingToolbarCommandId] = createSignal<string | undefined>();
	const [toolbarConfirmationChoice, setToolbarConfirmationChoice] = createSignal<'confirm' | 'cancel'>('confirm');
	const [availableActions, setAvailableActions] = createSignal<OperatorActionDescriptor[]>([]);
	let availableActionsQueryVersion = 0;
	const flowController = createCommandFlowController({
		onNotify: appendLog,
		onFlowClosed: () => {
			setInputValue('');
			setFocusArea('command');
		},
		onFlowRestarted: (definition) => {
			setInputValue('');
			const firstStep = definition.steps[0];
			setFocusArea(towerMode() === 'repository' || firstStep?.kind === 'selection' ? 'flow' : 'command');
		}
	});
	const client = createMemo(() => connection()?.client);
	const systemDomain = createMemo(() => systemSnapshot()?.state.domain);
	const projectedAvailableMissions = createMemo<MissionSelectionCandidate[]>(() =>
		buildProjectedMissionCandidates(systemDomain())
	);
	const currentMissionId = createMemo(() =>
		selector().missionId
			?? status().missionId
	);
	const headerTabs = createMemo<HeaderTab[]>(() =>
		buildHeaderTabs(status(), projectedAvailableMissions())
	);
	const activeHeaderTabId = createMemo(() => {
		const missionId = currentMissionId();
		return missionId ? `mission:${missionId}` : repositoryTabId;
	});
	const effectiveHeaderTabId = createMemo(() => selectedHeaderTabId() ?? activeHeaderTabId());
	const selectedHeaderTab = createMemo(() => {
		const selectedTabId = effectiveHeaderTabId();
		return headerTabs().find((tab) => tab.id === selectedTabId) ?? headerTabs()[0];
	});
	const selectedShellTarget = createMemo<HeaderTab['target']>(() => {
		const selectedTarget = selectedHeaderTab()?.target;
		if (selectedTarget) {
			return selectedTarget;
		}
		return { kind: 'repository' };
	});
	const towerMode = createMemo<TowerMode>(() => {
		const target = selectedShellTarget();
		if (target.kind === 'mission') {
			return 'mission';
		}
		return 'repository';
	});
	const airportProjections = createMemo(() => systemSnapshot()?.airportProjections);
	const dashboardProjection = createMemo(() => airportProjections()?.dashboard);
	const editorProjection = createMemo(() => airportProjections()?.editor);
	const agentSessionProjection = createMemo(() => airportProjections()?.agentSession);
	const selectedMissionContext = createMemo(() => {
		const target = selectedShellTarget();
		return target.kind === 'mission'
			? systemDomain()?.missions[target.missionId]
			: undefined;
	});
	const selectedTowerProjection = createMemo(() =>
		selectedMissionMatchesLoaded() ? status().tower : undefined
	);
	const selectedMissionMatchesLoaded = createMemo(() => {
		const target = selectedShellTarget();
		return target.kind === 'mission'
			&& status().found
			&& target.missionId === currentMissionId();
	});
	const centerRoute = createMemo<CenterRoute>(() => {
		if (towerMode() === 'repository') {
			return { kind: 'repository-flow' };
		}
		const projectedRoute = dashboardProjection()?.centerRoute;
		if (projectedRoute === 'mission-control') {
			return { kind: 'mission-control' };
		}
		if (projectedRoute === 'repository-flow') {
			return { kind: 'repository-flow' };
		}
		return { kind: 'mission-control' };
	});
	const commandFlowOwner = flowController.owner;
	const shellOverlay = createMemo<ShellOverlay>(() => {
		if (activePicker() === 'command-select' && commandQuery().length > 0) {
			return { kind: 'command-select' };
		}
		if (commandFlowOwner() === 'mission' && currentCommandFlowStep()) {
			return { kind: 'mission-flow' };
		}
		return { kind: 'none' };
	});
	const controlStatus = createMemo(() => status().control);
	const stages = createMemo(() => (centerRoute().kind === 'mission-control' ? buildProjectedStageStatuses(systemDomain(), selectedTowerProjection()?.stageRail) : []));
	const sessions = createMemo(() => (centerRoute().kind === 'mission-control' ? buildProjectedSessionRecords(systemDomain()) : []));
	const stageItems = createMemo<ProgressRailItem[]>(() =>
		(selectedTowerProjection()?.stageRail ?? []).map((item) => ({
			id: item.id,
			label: item.label,
			state: item.state,
			selected: item.id === selectedStageId(),
			...(item.subtitle ? { subtitle: item.subtitle } : {})
		}))
	);
	const themePickerItems = createMemo<SelectItem[]>(() =>
		buildThemePickerItems(selectedThemeName())
	);
	const issuePickerItems = createMemo<SelectItem[]>(() =>
		buildIssuePickerItems(openIssues())
	);
	const commandQuery = createMemo(() => commandPickerQuery());
	const currentCommandFlow = flowController.flow;
	const currentCommandFlowStep = flowController.currentStep;
	const showCommandFlowOverlay = flowController.isMissionSelectionOverlay;
	const isMissionFlowTextStep = flowController.isMissionTextStep;
	const headerPanelTitle = createMemo(() => {
			const workspaceLabel = resolveHeaderWorkspaceLabel(status().control, currentControlRoot());
		if (status().operationalMode === 'setup') {
			return `SETUP ${workspaceLabel}`;
		}
		return workspaceLabel;
	});
	const headerTabsFocusable = createMemo(() => headerTabs().length > 1);
	const headerStatusLines = createMemo(() =>
		buildHeaderStatusLines(
			status(),
					currentControlRoot(),
			selectedHeaderTab(),
			projectedAvailableMissions()
		)
	);
	const headerFooterBadges = createMemo(() =>
		buildHeaderFooterBadges({
			mode: towerMode(),
			status: status(),
			daemonState: daemonState(),
			fallbackGitHubUser: fallbackGitHubUser()
		})
	);
	const currentMissionTitle = createMemo(() => {
		const missionId = currentMissionId();
		if (!missionId) {
			return undefined;
		}
		return selectedMissionContext()?.briefSummary
			?? systemDomain()?.missions[missionId]?.briefSummary
			?? projectedAvailableMissions().find((candidate) => candidate.missionId === missionId)?.title
			?? missionId;
	});
	const commandTargetContext = createMemo<OperatorActionTargetContext>(() => {
		if (towerMode() !== 'mission') {
			return {};
		}
		const stageId = selectedStageId();
		const explicitTaskId = selectedTaskId();
		const explicitSessionId = selectedSessionId();
		const taskId = explicitTaskId || undefined;
		const sessionId = explicitSessionId
			?? (explicitTaskId || selectedStageId() ? undefined : undefined);
		return {
			...(stageId ? { stageId } : {}),
			...(taskId ? { taskId } : {}),
			...(sessionId ? { sessionId } : {})
		};
	});
	const selectedCommandTargetDescriptor = createMemo<{
		sessionId?: string;
		stageId?: MissionStageId;
		targetLabel?: string;
		targetKind?: TreeTargetKind;
	}>(() => {
		if (towerMode() !== 'mission') {
			return {
						targetLabel: dashboardProjection()?.repositoryLabel ?? resolveHeaderWorkspaceLabel(status().control, currentControlRoot())
			};
		}
		const sessionId = selectedSessionId();
		if (sessionId) {
			const session = sessions().find((candidate) => candidate.sessionId === sessionId);
			const sessionStageId = session?.taskId ? systemDomain()?.tasks[session.taskId]?.stageId : undefined;
			return {
				sessionId,
				...(sessionStageId ? { stageId: sessionStageId } : {}),
				targetLabel: session?.currentTurnTitle ?? session?.assignmentLabel ?? sessionId,
				targetKind: 'session'
			};
		}
		const taskId = selectedTaskId().trim();
		if (taskId) {
			const task = systemDomain()?.tasks[taskId];
			return {
				...(task?.stageId ? { stageId: task.stageId } : {}),
				targetLabel: task?.subject ?? taskId,
				targetKind: 'task'
			};
		}
		const stageId = selectedStageId();
		if (stageId) {
			const label = selectedTowerProjection()?.stageRail.find((item) => item.id === stageId)?.label ?? stageId;
			return {
				stageId,
				targetLabel: label,
				targetKind: 'stage'
			};
		}
		const missionLabel = currentMissionTitle();
		return {
			...(missionLabel ? { targetLabel: missionLabel } : {})
		};
	});
	const availableCommandById = createMemo(() => {
		const entries = new Map<string, OperatorActionDescriptor>();
		for (const command of availableActions()) {
			entries.set(command.id, command);
		}
		return entries;
	});
	const toolbarCommandDescriptors = createMemo<OperatorActionDescriptor[]>(() =>
		availableActions()
	);
	const toolbarCommands = createMemo<CommandToolbarItem[]>(() =>
		toolbarCommandDescriptors().map((command) => ({
			id: command.id,
			label: formatToolbarCommandLabel(command),
			enabled: command.enabled,
			...(command.ui?.requiresConfirmation !== undefined
				? { requiresConfirmation: command.ui.requiresConfirmation }
				: {}),
			...(command.ui?.confirmationPrompt
				? { confirmationPrompt: command.ui.confirmationPrompt }
				: {}),
			...(command.reason ? { reason: command.reason } : {})
		}))
	);
	const selectedToolbarCommand = createMemo(() =>
		availableCommandById().get(selectedToolbarCommandId() ?? '')
	);
	const selectedCommand = createMemo(() =>
		availableCommandById().get(selectedCommandId() ?? '')
	);
	const commandInputQuery = createMemo(() => commandPickerQuery());
	const commandPickerItems = createMemo<CommandItem[]>(() =>
		buildCommandPickerItems(availableActions(), commandInputQuery(), { includeDisabled: true })
	);
	const commandCycleItems = createMemo<CommandItem[]>(() =>
		buildCommandPickerItems(availableActions(), '')
	);
	const showCommandPicker = createMemo(
		() => commandInputQuery().length > 0
	);
	const selectedCommandPickerItemId = createMemo(() =>
		pickSelectItemId(commandPickerItems(), selectedPickerItemId())
	);
	const focusOrder = createMemo<FocusArea[]>(() =>
		buildFocusOrder({
			baseOrder: towerMode() === 'mission'
				? missionFocusOrder
				: repositoryFocusOrder,
			headerTabsFocusable: headerTabsFocusable(),
			showCommandFlow: showCommandFlowOverlay(),
			showCommandPicker: showCommandPicker(),
			expandedComposer: false
		})
	);
	const commandHelp = createMemo(() => {
		const step = currentCommandFlowStep();
		if (step && towerMode() !== 'repository') {
			return step.helperText;
		}
		if (towerMode() === 'repository' && step?.kind === 'selection') {
			return 'Repository flow active. Tab to the flow panel, use left/right to move between steps, and use up/down to browse options.';
		}
		if (towerMode() === 'repository' && step?.kind === 'text') {
			return 'Repository flow active. Tab to the flow panel to continue, or use Ctrl+left/right to move between steps.';
		}
		const enabledCommands = availableActions()
			.filter((command) => command.enabled)
			.map((command) => command.action);
		const uniqueCommands = [...new Set(enabledCommands)];
		if (uniqueCommands.length === 0) {
			return 'No commands available for the current selection.';
		}
		return `Available: ${uniqueCommands.join(', ')}`;
	});
	const keyHintsText = createMemo(() =>
		buildKeyHintsText({
			focusArea: focusArea(),
			activePicker: activePicker(),
			commandItems: commandCycleItems(),
			inputValue: inputValue(),
			selectedHeaderTabKind: selectedHeaderTab()?.target.kind,
			currentFlowStep: currentCommandFlowStep(),
			towerMode: towerMode()
		})
	);
	const screenTitle = createMemo(() => {
		if (towerMode() !== 'mission') {
					return dashboardProjection()?.repositoryLabel || resolveHeaderWorkspaceLabel(status().control, currentControlRoot());
		}
		return currentMissionTitle()
			|| (selectedMissionMatchesLoaded() ? currentMissionId() ?? 'Mission' : 'Mission');
	});
	const treeTargets = createMemo<TreeTargetDescriptor[]>(() =>
		(selectedTowerProjection()?.treeNodes ?? []).map((node) => ({
			id: node.id,
			label: node.label,
			kind: node.kind as TreeTargetKind,
			depth: node.depth,
			color: node.color,
			collapsible: node.collapsible,
			collapsed: collapsedTreeNodeIds().has(node.id),
			...(node.sourcePath ? { sourcePath: node.sourcePath } : {}),
			...(node.stageId ? { stageId: node.stageId as MissionStageId } : {}),
			...(node.taskId ? { taskId: node.taskId } : {}),
			...(node.sessionId ? { sessionId: node.sessionId } : {})
		}))
	);
	const visibleTreeTargets = createMemo<TreeTargetDescriptor[]>(() =>
		buildVisibleTreeTargets(treeTargets(), collapsedTreeNodeIds())
	);
	const selectedTreeTarget = createMemo(() => {
		const preferredId = pickPreferredTreeTargetId(visibleTreeTargets(), selectedTreeTargetId(), {
			selectedStageId: selectedStageId(),
			selectedTaskId: selectedTaskId(),
			selectedSessionId: selectedSessionId()
		});
		return visibleTreeTargets().find((target) => target.id === preferredId);
	});
	const selectedSessionRecord = createMemo(() => {
		const sessionId = selectedSessionId();
		if (!sessionId) {
			return undefined;
		}
		return sessions().find((session) => session.sessionId === sessionId);
	});
	function resolvePromptableSessionRecord() {
		const target = selectedTreeTarget();
		if (target?.kind !== 'session' || target.sessionId !== selectedSessionId()) {
			return undefined;
		}
		const session = selectedSessionRecord();
		if (!session) {
			return undefined;
		}
		return session.lifecycleState !== 'completed'
			&& session.lifecycleState !== 'failed'
			&& session.lifecycleState !== 'cancelled'
			? session
			: undefined;
	}
	const canSendSessionText = createMemo(() => {
		return resolvePromptableSessionRecord() !== undefined;
	});
	const commandPanelDescriptor = createMemo<CommandPanelDescriptor>(() =>
		buildCommandPanelDescriptor({
			commandFlow: currentCommandFlow(),
			currentCommandFlowStep: currentCommandFlowStep(),
			showCommandPicker: showCommandPicker(),
			selectedCommandText: showCommandPicker()
				? commandPickerItems().find((item) => item.id === selectedCommandPickerItemId())?.command
				: selectedCommand()?.action,
			availableActions: availableActions(),
			inputValue: inputValue(),
			status: status(),
			canSendSessionText: canSendSessionText(),
			selectedSessionId: selectedCommandTargetDescriptor().sessionId,
			selectedStageId: selectedCommandTargetDescriptor().stageId,
			selectedTreeTargetTitle: selectedTreeTarget()?.label
				?? selectedCommandTargetDescriptor().targetLabel
				?? agentSessionProjection()?.sessionLabel
				?? editorProjection()?.resourceLabel,
			selectedTreeTargetKind: selectedTreeTarget()?.kind ?? selectedCommandTargetDescriptor().targetKind
		})
	);
	const commandPanelMode = createMemo<'input' | 'toolbar'>(() => {
		if (isMissionFlowTextStep()) {
			return 'input';
		}
		if (canSendSessionText()) {
			return 'input';
		}
		return 'toolbar';
	});
	const commandPanelInputValue = createMemo(() =>
		isMissionFlowTextStep() ? flowController.textValue() : inputValue()
	);
	const commandPanelPrefix = createMemo(() => {
		if (isMissionFlowTextStep()) {
			return undefined;
		}
		const commandText = selectedCommand()?.action;
		if (commandText) {
			return commandText;
		}
		if (showCommandPicker()) {
			return '/';
		}
		return undefined;
	});
	const isCommandInteractionRunning = createMemo(() =>
		isRunningCommand() || flowController.isRunning()
	);
	function renderMissionControlPanel(): JSXElement | undefined {
		if (towerMode() !== 'mission') {
			return undefined;
		}
		return (
			<MissionControlPanel
				focused={focusArea() === 'tree'}
				rows={visibleTreeTargets()}
				selectedRowId={selectedTreeTarget()?.id}
				treePageScrollRequest={treePageScrollRequest()}
				emptyLabel={dashboardProjection()?.emptyLabel ?? 'No mission structure is available yet.'}
				onMoveSelection={() => undefined}
				onPageScroll={() => undefined}
				onActivateSelection={() => undefined}
			/>
		);
	}
	const repositoryFlowPanel = createMemo<JSXElement>(() => {
		const exactCommand = findAvailableCommandByText(availableActions(), inputValue().trim());
		return (
			<RepositoryFlowSurface
				controller={flowController}
				focused={focusArea() === 'flow'}
				onCancel={() => {
					resetCommandFlow();
					setFocusArea('command');
				}}
				{...(exactCommand?.flow && exactCommand.flow.steps.length > 0
					? {
						preview: {
							title: `${exactCommand.flow.targetLabel} > ${exactCommand.flow.actionLabel}`,
							text: exactCommand.flow.steps[0]?.helperText ?? 'Press Enter in the command dock to start this flow.'
						}
					}
					: dashboardProjection()
						? {
							preview: {
								title: dashboardProjection()?.title ?? 'DASHBOARD',
								text: dashboardProjection()?.emptyLabel ?? 'Repository mode is ready.'
							}
						}
					: {})}
			/>
		);
	});
	const centerContent = createMemo<JSXElement>(() => {
		switch (centerRoute().kind) {
			case 'mission-control':
				return renderMissionControlPanel() ?? <box />;
			case 'repository-flow':
			default:
				return repositoryFlowPanel();
		}
	});
	const overlayContent = createMemo<JSXElement | undefined>(() => {
		if (shellOverlay().kind === 'command-select') {
			return (
				<CommandPickerPanel
					items={commandPickerItems()}
					selectedItemId={selectedCommandPickerItemId()}
					focused={focusArea() === 'flow'}
					query={commandInputQuery()}
					emptyLabel={
						commandInputQuery() === '/'
							? 'No commands are available for the current selection.'
							: `No commands match ${commandInputQuery()}.`
					}
						helperText="Keep typing to filter. Use arrow keys to highlight a command. Enter runs the selected command or opens its flow. Esc closes the list."
					onHighlight={(itemId) => {
						setSelectedPickerItemId(itemId);
					}}
					onSelect={(itemId) => {
							selectCommandById(itemId, { fromPicker: true });
					}}
					onClose={() => {
						closeCommandPicker({ clearCommandInput: commandQuery() === '/' });
					}}
					onAppendFilter={(value) => {
						appendCommandPickerFilter(value);
					}}
					onPopFilter={() => {
						popCommandPickerFilter();
					}}
				/>
			);
		}
		if (shellOverlay().kind === 'mission-flow') {
			return (
				<MissionFlowOverlay
					controller={flowController}
					flowFocused={focusArea() === 'flow'}
					commandFocused={focusArea() === 'command'}
					onCancel={() => {
						resetCommandFlow();
						setFocusArea('command');
					}}
				/>
			);
		}
		return undefined;
	});
	createEffect(() => {
		setSelectedTreeTargetId(undefined);
		setCollapsedTreeNodeIds(new Set<string>());
		setCollapseDefaultsMissionId(undefined);
		setSelectedSessionId(undefined);
		setSelectedTaskId('');
		setSelectedStageId(undefined);
	});

	createEffect(() => {
		if (towerMode() !== 'mission') {
			return;
		}
		const missionId = currentMissionId();
		if (!missionId || collapseDefaultsMissionId() === missionId) {
			return;
		}
		if (stages().length === 0) {
			return;
		}
		setCollapsedTreeNodeIds(buildDefaultCollapsedTreeNodeIds(stages(), sessions()));
		setCollapseDefaultsMissionId(missionId);
	});

	createEffect(() => {
		setSelectedStageId((current) => pickPreferredStageId(
			stages(),
			current,
				selectedMissionContext()?.currentStage
		));
	});

	createEffect(() => {
		const sessionId = selectedSessionId();
		if (!sessionId) {
			return;
		}
		if (sessions().some((session) => session.sessionId === sessionId)) {
			return;
		}
		setSelectedSessionId(undefined);
	});

	createEffect(() => {
		const target = towerMode() === 'mission' ? selectedTreeTarget() : undefined;
		if (!target || target.taskId) {
			return;
		}
		if (selectedTaskId() !== '') {
			setSelectedTaskId('');
		}
	});

	createEffect(() => {
		setSelectedTreeTargetId((current) =>
			pickPreferredTreeTargetId(visibleTreeTargets(), current, {
				selectedStageId: selectedStageId(),
				selectedTaskId: selectedTaskId(),
				selectedSessionId: selectedSessionId()
			})
		);
	});

	createEffect(() => {
		if (towerMode() === 'mission') {
			const target = selectedTreeTarget();
			if (!target) {
				return;
			}
			if (target.stageId && target.stageId !== selectedStageId()) {
				setSelectedStageId(target.stageId);
			}
			const nextTaskId = target.taskId ?? '';
			if (nextTaskId !== selectedTaskId()) {
				setSelectedTaskId(nextTaskId);
			}
			if (target.sessionId !== selectedSessionId()) {
				setSelectedSessionId(target.sessionId);
			}
			return;
		}
	});

	createEffect(() => {
		const currentClient = client();
		if (!currentClient) {
			return;
		}
		const observation = {
			...(currentControlRoot() ? { repositoryId: currentControlRoot() } : {})
		};
		const observationKey = JSON.stringify(observation);
		if (observationKey === lastObservedSelectionKey) {
			return;
		}
		lastObservedSelectionKey = observationKey;
		void new DaemonApi(currentClient).airport.observeClient(observation).catch(() => undefined);
	});

	createEffect(() => {
		const currentClient = client();
		const mode = towerMode();
		const missionId = currentMissionId();
		const context = commandTargetContext();
		systemSnapshot()?.state.version;
		if (!currentClient) {
			setAvailableActions([]);
			return;
		}
		if (mode === 'mission' && (!missionId || !selectedMissionMatchesLoaded())) {
			setAvailableActions([]);
			return;
		}
		const requestVersion = ++availableActionsQueryVersion;
		const nextContext: OperatorActionQueryContext | undefined = mode === 'mission' ? context : undefined;
		void (async () => {
			try {
				const api = new DaemonApi(currentClient);
				const nextActions = mode === 'mission'
					? await api.mission.listAvailableActions({ missionId: missionId! }, nextContext)
					: await api.control.listAvailableActions();
				if (requestVersion === availableActionsQueryVersion) {
					setAvailableActions(nextActions);
				}
			} catch {
				if (requestVersion === availableActionsQueryVersion) {
					setAvailableActions([]);
				}
			}
		})();
	});

	createEffect(() => {
		setSelectedToolbarCommandId((current) =>
			pickPreferredToolbarCommandId(toolbarCommands(), current)
		);
	});

	createEffect(() => {
		if (commandPanelMode() !== 'toolbar') {
			setConfirmingToolbarCommandId(undefined);
			setToolbarConfirmationChoice('confirm');
			return;
		}
		const confirming = confirmingToolbarCommandId();
		if (!confirming) {
			return;
		}
		if (!toolbarCommands().some((item) => item.id === confirming)) {
			setConfirmingToolbarCommandId(undefined);
			setToolbarConfirmationChoice('confirm');
		}
	});

	createEffect(() => {
		const control = status().control;
		if (!control) {
			setFallbackGitHubUser(undefined);
			setIsGitHubUserProbeInFlight(false);
			return;
		}
		if (control?.githubAuthenticated === false) {
			setFallbackGitHubUser(undefined);
			setIsGitHubUserProbeInFlight(false);
			return;
		}
		if (control.githubUser?.trim()) {
			setFallbackGitHubUser(undefined);
			setIsGitHubUserProbeInFlight(false);
			return;
		}
		if (fallbackGitHubUser() || isGitHubUserProbeInFlight()) {
			return;
		}
		setIsGitHubUserProbeInFlight(true);
		void resolveGitHubCliUser(currentControlRoot())
			.then((user) => {
				if (user) {
					setFallbackGitHubUser(user);
				}
			})
			.finally(() => {
				setIsGitHubUserProbeInFlight(false);
			});
	});

	createEffect(() => {
		if (towerMode() !== 'repository') {
			setFallbackControlBranch(undefined);
			setIsControlBranchProbeInFlight(false);
			return;
		}
		const daemonBranch = status().control?.currentBranch?.trim();
		if (daemonBranch && daemonBranch.length > 0 && daemonBranch !== 'HEAD' && daemonBranch.toLowerCase() !== 'unknown') {
			setFallbackControlBranch(undefined);
			setIsControlBranchProbeInFlight(false);
			return;
		}
		if (fallbackControlBranch() || isControlBranchProbeInFlight()) {
			return;
		}
		setIsControlBranchProbeInFlight(true);
		void resolveGitBranchName(currentControlRoot())
			.then((branch) => {
				if (branch && branch !== 'HEAD') {
					setFallbackControlBranch(branch);
				}
			})
			.finally(() => {
				setIsControlBranchProbeInFlight(false);
			});
	});

	createEffect(() => {
		setSelectedHeaderTabId((current) =>
			pickPreferredHeaderTabId(headerTabs(), current, activeHeaderTabId())
		);
	});

	createEffect(() => {
		const owner = commandFlowOwner();
		if (!owner) {
			return;
		}
		if (owner === 'repository' && towerMode() !== 'repository') {
			resetCommandFlow({ clearCommandInput: true });
			closeCommandPicker({ clearCommandInput: true });
			return;
		}
		if (owner === 'mission' && towerMode() !== 'mission') {
			resetCommandFlow({ clearCommandInput: true });
			closeCommandPicker({ clearCommandInput: true });
		}
	});

	createEffect(() => {
		const order = focusOrder();
		if (!order.includes(focusArea())) {
			setFocusArea(order[0] ?? 'command');
		}
	});

	createEffect(() => {
		const currentClient = client();
		if (!currentClient) {
			return;
		}
		const subscription = currentClient.onDidEvent((event) => {
			if (event.type === 'airport.state') {
				applySystemSnapshot(event.snapshot);
				return;
			}
			if ('missionId' in event && event.missionId !== currentMissionId()) {
				return;
			}
			const missionStatusEvent = asMissionStatusNotification(event);
			if (missionStatusEvent) {
				applyMissionStatus(missionStatusEvent.status);
				setDaemonState('connected');
				return;
			}
			if (event.type === 'session.console') {
				const sessionId = event.event.state.sessionId;
				if (event.event.state.awaitingInput && sessionId) {
					setSelectedSessionId(sessionId);
					setSelectedTreeTargetId(createSessionNodeId(sessionId));
					setFocusArea('command');
				}
				return;
			}
			if (event.type === 'session.event') {
				appendLog(describeAgentEvent(event.event));
			}
		});
		onCleanup(() => {
			subscription.dispose();
		});
	});

	onMount(() => {
		renderer.setBackgroundColor(towerTheme.background);
		if (!initialConnection) {
			void connectClient(initialSelector);
		}
	});

	createEffect(() => {
		selectedThemeName();
		renderer.setBackgroundColor(towerTheme.background);
	});

	onCleanup(() => {
		connection()?.dispose();
	});

	useKeyboard((key) => {
		if (key.ctrl && key.name === 'q') {
			renderer.destroy();
			return;
		}
		if (key.name === 'tab') {
			moveFocus(key.shift ? -1 : 1);
			return;
		}
		if (
			!isMissionFlowTextStep() &&
			focusArea() !== 'flow' &&
			key.sequence === '/' &&
			(focusArea() !== 'command' ||
				inputValue().length === 0 ||
				(activePicker() === 'command-select' && commandQuery() === '/'))
		) {
			openCommandPickerShortcut();
			return;
		}
		if (focusArea() === 'header') {
			if (key.name === 'left') {
				previewHeaderTabSelection(-1);
				return;
			}
			if (key.name === 'right') {
				previewHeaderTabSelection(1);
				return;
			}
			if (key.name === 'enter' || key.name === 'return') {
				void activateHeaderTab(selectedHeaderTabId());
				return;
			}
		}
		if (key.name === 'up') {
			if (focusArea() === 'header') {
				moveFocus(-1);
				return;
			}
			if (moveSelection(-1)) {
				return;
			}
		}
		if (key.name === 'down') {
			if (focusArea() === 'header') {
				moveFocus(1);
				return;
			}
			if (moveSelection(1)) {
				return;
			}
		}
		if (focusArea() === 'tree' && towerMode() === 'mission') {
			if (key.name === 'pageup') {
				requestTreePageScroll(-1);
				return;
			}
			if (key.name === 'pagedown') {
				requestTreePageScroll(1);
				return;
			}
		}
		if (key.name === 'escape' && focusArea() === 'command') {
			if (commandPanelMode() === 'toolbar') {
				if (confirmingToolbarCommandId()) {
					setConfirmingToolbarCommandId(undefined);
					setToolbarConfirmationChoice('confirm');
				}
				return;
			}
			if (activePicker() === 'command-select') {
				closeCommandPicker({ clearCommandInput: commandQuery() === '/' });
				return;
			}
			if (isMissionFlowTextStep()) {
				resetCommandFlow({ clearCommandInput: true });
				setFocusArea('command');
				return;
			}
			setInputValue('');
			setFocusArea('command');
			return;
		}
		if ((key.name === 'q' || key.sequence === 'q') && focusArea() !== 'command' && !activePicker()) {
			renderer.destroy();
			return;
		}
		if (focusArea() === 'command') {
			if (commandPanelMode() === 'toolbar') {
				if (key.name === 'left') {
					if (confirmingToolbarCommandId()) {
						moveToolbarConfirmationSelection(-1);
					} else {
						moveToolbarCommandSelection(-1);
					}
					return;
				}
				if (key.name === 'right') {
					if (confirmingToolbarCommandId()) {
						moveToolbarConfirmationSelection(1);
					} else {
						moveToolbarCommandSelection(1);
					}
					return;
				}
				if (key.name === 'space' || key.name === 'enter' || key.name === 'return') {
					void submitToolbarConfirmation();
					return;
				}
				if (key.name === 'escape' && confirmingToolbarCommandId()) {
					setConfirmingToolbarCommandId(undefined);
					setToolbarConfirmationChoice('confirm');
					return;
				}
			}
			return;
		}
		if ((key.name === 'enter' || key.name === 'return') && focusArea() === 'tree' && towerMode() === 'mission') {
			activateTreeTarget(selectedTreeTarget()?.id);
			return;
		}
		if (key.name === 'left') {
			if (moveSelection(-1)) {
				return;
			}
		}
		if (key.name === 'right') {
			if (moveSelection(1)) {
				return;
			}
		}
	});

	function moveFocus(delta: number): void {
		const order = focusOrder();
		const currentIndex = order.indexOf(focusArea());
		const nextIndex = (currentIndex + delta + order.length) % order.length;
		setFocusArea(order[nextIndex] ?? 'command');
	}

	function moveSelection(delta: number): boolean {
		switch (focusArea()) {
			case 'tree':
				if (towerMode() === 'mission') {
					selectTreeTarget(moveTreeTargetSelection(visibleTreeTargets(), selectedTreeTarget()?.id, delta));
					return true;
				}
				return false;
			default:
				return false;
		}
	}

	function requestTreePageScroll(delta: number): void {
		setTreePageScrollRequest({ delta });
	}

	function previewHeaderTabSelection(delta: number): void {
		if (!headerTabsFocusable()) {
			return;
		}
		const nextTabId = moveHeaderTabSelection(
			headerTabs(),
			selectedHeaderTabId() ?? activeHeaderTabId(),
			delta
		);
		if (!nextTabId) {
			return;
		}
		void activateHeaderTab(nextTabId, { preserveFocus: true });
	}

	async function activateHeaderTab(
		tabId: string | undefined,
		options?: { preserveFocus?: boolean }
	): Promise<void> {
		if (!tabId) {
			return;
		}
		const selectedTab = headerTabs().find((tab) => tab.id === tabId);
		if (!selectedTab) {
			return;
		}
		setSelectedHeaderTabId(tabId);
		if (selectedTab.target.kind === 'repository') {
			resetMissionContextSelection();
			if (!currentMissionId()) {
				setSelectedHeaderTabId(repositoryTabId);
				if (!options?.preserveFocus) {
					setFocusArea('flow');
				}
				return;
			}
			await connectClient({});
			setSelectedHeaderTabId(repositoryTabId);
			if (!options?.preserveFocus) {
				setFocusArea('flow');
			}
			return;
		}

		if (selectedTab.target.missionId === currentMissionId()) {
			setSelectedHeaderTabId(tabId);
			return;
		}

		await connectClient({ missionId: selectedTab.target.missionId });
		setSelectedHeaderTabId(tabId);
		if (!options?.preserveFocus) {
			setFocusArea('command');
		}
	}

	function resetMissionContextSelection(): void {
		setSelectedTreeTargetId(undefined);
		setSelectedSessionId(undefined);
		setSelectedTaskId('');
		setSelectedStageId(undefined);
		setCollapsedTreeNodeIds(new Set<string>());
		setTreePageScrollRequest(undefined);
		setCollapseDefaultsMissionId(undefined);
		resetCommandFlow({ clearCommandInput: true });
		closeCommandPicker({ clearCommandInput: true });
		setSelectedCommandId(undefined);
	}

	function selectTreeTarget(targetId: string | undefined): void {
		if (!targetId) {
			return;
		}
		setSelectedTreeTargetId(targetId);
		const target = visibleTreeTargets().find((candidate) => candidate.id === targetId)
			?? treeTargets().find((candidate) => candidate.id === targetId);
		if (!target) {
			return;
		}
		if (target.stageId) {
			setSelectedStageId(target.stageId);
		}
		setSelectedTaskId(target.taskId ?? '');
		setSelectedSessionId(target.sessionId);
	}

	function activateTreeTarget(targetId: string | undefined): void {
		if (!targetId) {
			return;
		}
		const target = treeTargets().find((candidate) => candidate.id === targetId);
		if (!target) {
			return;
		}
		if (target.collapsible) {
			setCollapsedTreeNodeIds((current) => {
				const next = new Set(current);
				if (next.has(target.id)) {
					next.delete(target.id);
				} else {
					next.add(target.id);
				}
				return next;
			});
			return;
		}
		selectTreeTarget(targetId);
	}

	async function replaceConnection(next: TowerConnection | undefined): Promise<void> {
		const previous = connection();
		if (previous && previous !== next) {
			previous.dispose();
		}
		setConnection(next);
	}

	function appendLog(message: string): void {
		const timestamp = new Date().toISOString().slice(11, 19);
		setActivityLog((current) => [...current, `[${timestamp}] ${message}`].slice(-240));
	}

	function appendLogLines(lines: string[]): void {
		for (const line of lines) {
			appendLog(line);
		}
	}

	function openIssuePicker(): void {
		if (openIssues().length === 0) {
			appendLog('No open GitHub issues are available.');
			return;
		}
		startCommandFlow(buildIssueBootstrapFlow());
	}

	function openThemePicker(): void {
		startCommandFlow(buildThemeFlow());
	}

	function openCommandPickerShortcut(): void {
		setSelectedCommandId(undefined);
		setInputValue('');
		updateCommandPicker('');
	}

	function appendCommandPickerFilter(value: string): void {
		const nextValue = normalizeCommandInputValue(`${inputValue()}${value}`);
		setInputValue(nextValue);
		updateCommandPicker(nextValue);
	}

	function popCommandPickerFilter(): void {
		const nextValue = inputValue().slice(0, -1);
		setInputValue(nextValue);
		updateCommandPicker(nextValue);
	}

	function updateCommandPicker(value: string): void {
		const normalized = value.trim();
		const query = normalized.length === 0
			? '/'
			: normalized.startsWith('/')
				? parseCommandQuery(normalized)
				: `/${normalized}`;
		setCommandPickerQuery(query);

		if (!query) {
			if (activePicker() === 'command-select') {
				closeCommandPicker();
			}
			return;
		}
		const items = buildCommandPickerItems(availableActions(), query, { includeDisabled: true });
		setActivePicker('command-select');
		setSelectedPickerItemId((current) => pickSelectItemId(items, current));
		setFocusArea('flow');
	}

	function closeCommandPicker(options?: { clearCommandInput?: boolean }): void {
		setActivePicker(undefined);
		setCommandPickerQuery('');
		if (options?.clearCommandInput) {
			setInputValue('');
		}
		if (focusArea() === 'flow') {
			setFocusArea('command');
		}
	}

	function resetCommandFlow(options?: { clearCommandInput?: boolean }): void {
		flowController.reset();
		if (options?.clearCommandInput) {
			setInputValue('');
		}
	}

	function cycleCommandInput(delta: number): void {
		if (isMissionFlowTextStep()) {
			return;
		}
		const items = commandCycleItems();
		if (items.length === 0) {
			return;
		}
		const currentId = selectedCommandId();
		const currentIndex = items.findIndex((item) => item.id === currentId);
		const seedIndex = currentIndex >= 0 ? currentIndex : 0;
		const nextIndex = (seedIndex + delta + items.length) % items.length;
		const nextCommand = items[nextIndex];
		if (!nextCommand) {
			return;
		}
		setSelectedCommandId(nextCommand.id);
		setInputValue('');
		closeCommandPicker();
		setSelectedPickerItemId(nextCommand.id);
		setFocusArea('command');
	}

	function selectCommandById(
		commandId: string,
		options?: { execute?: boolean; fromPicker?: boolean; items?: CommandItem[] }
	): void {
		const nextCommand = options?.items?.find((item) => item.id === commandId)
			?? commandPickerItems().find((item) => item.id === commandId)
			?? (() => {
				const command = availableCommandById().get(commandId);
				return command
					? {
						id: command.id,
						command: command.action,
						label: command.action,
						description: command.label
					}
					: undefined;
			})();
		if (!nextCommand) {
			return;
		}
		const descriptor = availableCommandById().get(commandId);
		setSelectedPickerItemId(commandId);
		if (options?.execute) {
			void runCommandById(commandId, nextCommand.command);
			return;
		}
		resetCommandFlow();
		if (descriptor?.flow && descriptor.flow.steps.length > 0) {
			const definition = buildCommandFlowFromCommand(
				descriptor,
				resolveCommandExecutionSelector(descriptor)
			);
			if (definition) {
				closeCommandPicker({ clearCommandInput: true });
				startCommandFlow(definition);
				return;
			}
		}
		if (options?.fromPicker) {
			void runCommandById(commandId, nextCommand.command);
			return;
		}
		setSelectedCommandId(commandId);
		setInputValue('');
		closeCommandPicker();
	}

	function runCommandById(commandId: string, commandTextOverride?: string): void {
		setInputValue('');
		setSelectedCommandId(commandId);
		closeCommandPicker({ clearCommandInput: true });
		setIsRunningCommand(true);
		const descriptor = availableCommandById().get(commandId);
		const execution = descriptor
			? executeActionById(commandId)
			: executeCommand(commandTextOverride ?? commandId.replace(/^custom:/u, ''));
		void execution
			.catch((error) => {
				appendLog(toErrorMessage(error));
			})
			.finally(() => {
				setIsRunningCommand(false);
			});
	}

	function startCommandFlow(definition: CommandFlowDefinition): void {
		const firstStep = definition.steps[0];
		if (!firstStep) {
			return;
		}
		setCommandPickerQuery('');
		setActivePicker(undefined);
		setSelectedCommandId(undefined);
		setInputValue('');
		flowController.start(definition);
		if (towerMode() === 'repository') {
			setFocusArea('flow');
			return;
		}
		setFocusArea(firstStep.kind === 'selection' ? 'flow' : 'command');
	}

	async function submitCommandFlowTextStep(rawValue: string): Promise<void> {
		flowController.setTextValue(rawValue);
		await flowController.commitCurrentStep();
	}

	function buildIssueBootstrapFlow(): CommandFlowDefinition {
		return {
			id: 'issue-bootstrap',
			owner: 'repository',
			targetLabel: 'ISSUE',
			actionLabel: 'START',
			steps: [
				{
					kind: 'selection',
					id: 'issue',
					label: 'ISSUE',
					title: 'OPEN ISSUES',
					emptyLabel: 'No open GitHub issues are available.',
					helperText: 'Choose an issue. The selection runs immediately.',
					selectionMode: 'single',
					items: issuePickerItems
				}
			],
			onComplete: async (result) => {
				const issueStep = result.steps.find(
					(step): step is CommandFlowSelectionValue => step.kind === 'selection' && step.stepId === 'issue'
				);
				const issueNumber = issueStep?.optionIds[0];
				if (!issueNumber || !/^\d+$/u.test(issueNumber)) {
					throw new Error('No GitHub issue was selected.');
				}
				await selectIssueByNumber(Number(issueNumber));
			}
		};
	}

	function buildThemeFlow(): CommandFlowDefinition {
		return {
			id: 'theme-select',
			owner: towerMode() === 'repository' ? 'repository' : 'mission',
			targetLabel: 'THEME',
			actionLabel: 'APPLY',
			steps: [
				{
					kind: 'selection',
					id: 'theme',
					label: 'THEME',
					title: 'THEMES',
					emptyLabel: 'No themes are available.',
					helperText: 'Choose a theme. The selection runs immediately.',
					selectionMode: 'single',
					items: themePickerItems
				}
			],
			onComplete: async (result) => {
				const themeStep = result.steps.find(
					(step): step is CommandFlowSelectionValue => step.kind === 'selection' && step.stepId === 'theme'
				);
				const themeId = themeStep?.optionIds[0];
				if (!themeId) {
					throw new Error('No theme was selected.');
				}
				await selectThemeById(themeId);
			}
		};
	}

	function buildCommandFlowFromCommand(
		command: OperatorActionDescriptor | undefined,
		executeSelector: MissionSelector,
		onCompleteLog?: (result: Awaited<ReturnType<typeof executeDaemonCommandById>>, flowResult: CommandFlowResult) => string | undefined
	): CommandFlowDefinition | undefined {
		if (!command?.flow) {
			return undefined;
		}
		const flow = command.flow as OperatorActionFlowDescriptor & {
			actionLabel: string;
			steps: OperatorActionFlowStep[];
		};

		const completeFlow = async (result: CommandFlowResult) => {
			if (command.id === 'control.repository.switch') {
				const repositoryStep = result.steps.find(
					(step): step is CommandFlowSelectionValue => step.kind === 'selection' && step.stepId === 'repository'
				);
				const repositoryRootPath = repositoryStep?.optionIds[0]?.trim();
				if (!repositoryRootPath) {
					throw new Error('Repository switch requires a repository selection.');
				}
				const repositories = await loadRegisteredRepositories();
				const repository = repositories.find((candidate) => candidate.repositoryRootPath === repositoryRootPath);
				if (!repository) {
					throw new Error('Repository switch requires a registered repository.');
				}
				await switchRepository(repository);
				return { kind: 'close' } satisfies CommandFlowCompletion;
			}

			if (command.id === 'control.repository.add') {
				const pathStep = result.steps.find((step) => step.kind === 'text' && step.stepId === 'path');
				const repositoryPath = pathStep?.kind === 'text' ? pathStep.value.trim() : '';
				if (!repositoryPath) {
					throw new Error('Repository path is required.');
				}
				await addRepositoryAndSwitch(repositoryPath);
				return { kind: 'close' } satisfies CommandFlowCompletion;
			}

			const executionResult = await executeDaemonCommandById(
				command.id,
				buildExecuteCommandSteps(result.steps),
				executeSelector
			);
			if (command.id === 'control.mission.start' || command.id === 'control.mission.select') {
				activateLoadedMissionShell(executionResult.status, executeSelector);
			}
			const message = onCompleteLog?.(executionResult, result);
			if (message) {
				appendLog(message);
			}
			return { kind: 'close' } satisfies CommandFlowCompletion;
		};

		const buildDefinition = (descriptor: OperatorActionFlowDescriptor): CommandFlowDefinition => ({
			id: command.id,
			owner: command.id.startsWith('control.') ? 'repository' : 'mission',
			targetLabel: descriptor.targetLabel,
			actionLabel: descriptor.actionLabel,
			steps: descriptor.steps.map((step) => buildCommandFlowStep(step)),
			...(command.id.startsWith('control.')
				? {
					resolveDefinition: async (stepValues: CommandFlowStepValue[]) =>
						buildDefinition(await loadControlFlowDescriptor(command.id, stepValues, executeSelector))
				}
				: {}),
			onComplete: completeFlow
		});

		return buildDefinition(flow);
	}

	async function loadControlFlowDescriptor(
		actionId: string,
		stepValues: CommandFlowStepValue[],
		nextSelector: MissionSelector
	): Promise<OperatorActionFlowDescriptor> {
		const currentClient = client() ?? (await connectClient(nextSelector));
		if (!currentClient) {
			throw new Error('Unable to connect to resolve the Mission command flow.');
		}
		return new DaemonApi(currentClient).control.describeActionFlow(
			actionId,
			buildExecuteCommandSteps(stepValues)
		);
	}

	function applyMissionStatus(
		nextStatus: OperatorStatus,
		fallbackSelector: MissionSelector = selector()
	): MissionSelector {
		const nextSelector = selectorFromTowerState(nextStatus, systemSnapshot(), fallbackSelector);
		setStatus(nextStatus);
		setSelector(nextSelector);
		return nextSelector;
	}

	function applySystemSnapshot(nextSystem: MissionSystemSnapshot): void {
		setSystemSnapshot((current) => {
			const currentVersion = current?.state.version ?? -1;
			if (nextSystem.state.version < currentVersion) {
				return current;
			}
			return nextSystem;
		});
	}

	function activateLoadedMissionShell(nextStatus: OperatorStatus, nextSelector: MissionSelector = selector()): void {
		const missionId = nextStatus.missionId ?? nextSelector.missionId;
		if (!missionId) {
			return;
		}
		setSelectedHeaderTabId(`mission:${missionId}`);
		setFocusArea('tree');
	}

	async function selectThemeById(themeId: string): Promise<void> {
		if (!isTowerThemeName(themeId)) {
			appendLog(`Unknown theme '${themeId}'.`);
			return;
		}
		const currentClient = client() ?? (await connectClient({}));
		if (currentClient) {
			try {
				const nextStatus = await new DaemonApi(currentClient).control.updateSetting('towerTheme', themeId);
				applyMissionStatus(nextStatus, selector());
			} catch (error) {
				appendLog(`Unable to persist theme '${themeId}': ${toErrorMessage(error)}`);
				return;
			}
		}
		applyTowerTheme(themeId);
		setSelectedThemeName(themeId);
		setSelectedPickerItemId(themeId);
		appendLog(`Theme set to ${themeId}.`);
		resetCommandFlow();
		setFocusArea('command');
	}

	async function selectIssueByNumber(issueNumber: number): Promise<void> {
		const started = await startIssueMission(issueNumber);
		if (!started) {
			return;
		}
		setSelectedPickerItemId(String(issueNumber));
		resetCommandFlow();
	}

	async function connectClient(nextSelector: MissionSelector = selector(), surfacePath?: string): Promise<DaemonClient | undefined> {
		setDaemonState('booting');
		try {
			const nextConnection = await connect({ selector: nextSelector, ...(surfacePath ? { surfacePath } : {}) });
			await replaceConnection(nextConnection);
			applySystemSnapshot(nextConnection.snapshot);
			applyMissionStatus(nextConnection.status, nextSelector);
			setDaemonState('connected');
			appendLog(
				nextConnection.status.found
					? `Connected to ${nextConnection.status.missionId ?? nextSelector.missionId ?? 'the selected mission'}.`
					: describeControlConnection(nextConnection.status)
			);
			return nextConnection.client;
		} catch (error) {
			await replaceConnection(undefined);
			setDaemonState('degraded');
			appendLog(toErrorMessage(error));
			return undefined;
		}
	}

	async function loadRegisteredRepositories(): Promise<MissionRepositoryCandidate[]> {
		const currentClient = client() ?? (await connectClient(selector()));
		if (!currentClient) {
			appendLog('Unable to connect to list registered repositories.');
			return [];
		}
		const repositories = await new DaemonApi(currentClient).control.listRegisteredRepositories();
		if (repositories.length === 0) {
			appendLog('No registered repositories are available. Use /add-repo to register one.');
		}
		return repositories;
	}

	async function switchRepository(repository: MissionRepositoryCandidate): Promise<void> {
		await connectClient({}, repository.repositoryRootPath);
		setSelectedHeaderTabId(repositoryTabId);
		closeCommandPicker();
		resetCommandFlow();
		appendLog(`Switched to repository ${repository.label}.`);
	}

	async function switchRepositoryByQuery(query: string): Promise<void> {
		const trimmedQuery = query.trim().toLowerCase();
		if (!trimmedQuery) {
			if (await executeActionByText('/repo')) {
				return;
			}
			appendLog('Repository switch is not available right now.');
			return;
		}
		const repositories = await loadRegisteredRepositories();
		if (repositories.length === 0) {
			return;
		}
		const exact = repositories.find((repository) => {
			const githubRepository = repository.githubRepository?.toLowerCase();
			return repository.label.toLowerCase() === trimmedQuery
				|| repository.repositoryRootPath.toLowerCase() === trimmedQuery
				|| githubRepository === trimmedQuery;
		});
		if (exact) {
			await switchRepository(exact);
			return;
		}
		const partialMatches = repositories.filter((repository) => {
			const haystacks = [repository.label, repository.repositoryRootPath, repository.githubRepository]
				.filter((value): value is string => typeof value === 'string');
			return haystacks.some((value) => value.toLowerCase().includes(trimmedQuery));
		});
		if (partialMatches.length === 1) {
			await switchRepository(partialMatches[0]!);
			return;
		}
		if (partialMatches.length > 1) {
			appendLog(`Repository query '${query}' matched multiple repositories. Use /repo and pick one.`);
			return;
		}
		appendLog(`No registered repository matched '${query}'.`);
	}

	async function addRepositoryAndSwitch(repositoryPath: string): Promise<void> {
		const currentClient = client() ?? (await connectClient(selector()));
		if (!currentClient) {
			appendLog('Unable to connect to register a repository.');
			return;
		}
		const repository = await new DaemonApi(currentClient).control.addRepository(repositoryPath);
		appendLog(`Registered repository ${repository.label}.`);
		await switchRepository(repository);
	}

	async function loadIssues(): Promise<void> {
		if (workspaceContext.kind !== 'control-root') {
			appendLog('Issue intake is only available from the repository root.');
			return;
		}
		if (!canUseIssueIntake(controlStatus())) {
			appendLog(describeIssueIntakeStatus(controlStatus()));
			return;
		}
		if (selectedMissionMatchesLoaded()) {
			appendLog('Issue intake is only available in repository mode. Use /root first.');
			return;
		}
		const currentClient = client() ?? (await connectClient(selector()));
		if (!currentClient) {
			appendLog('Unable to connect to list GitHub issues.');
			return;
		}
		const nextIssues = await new DaemonApi(currentClient).control.listOpenIssues(20);
		setOpenIssues(nextIssues);
		appendLog(`Loaded ${String(nextIssues.length)} open GitHub issue(s).`);
		if (nextIssues.length === 0) {
			appendLog('No open GitHub issues are available.');
			return;
		}
		openIssuePicker();
		}

	async function startIssueMission(issueNumber: number): Promise<boolean> {
		const currentClient = client() ?? (await connectClient(selector()));
		if (!currentClient) {
			appendLog('Unable to connect to bootstrap an issue mission.');
			return false;
		}
		try {
			const next = await new DaemonApi(currentClient).mission.fromIssue(issueNumber);
			const nextSelector = applyMissionStatus(next);
			activateLoadedMissionShell(next, nextSelector);
			if (next.preparation?.kind === 'repository-bootstrap') {
				appendLog(
					`Repository bootstrap prepared on ${next.preparation.branchRef}. PR: ${next.preparation.pullRequestUrl}`
				);
			} else if (next.preparation?.kind === 'mission') {
				appendLog(
					`Mission ${next.preparation.missionId} prepared from issue ${String(issueNumber)} on ${next.preparation.branchRef}. Worktree: ${next.preparation.worktreePath}`
				);
			} else {
				appendLog(
					`Mission ${next.missionId ?? 'unknown'} selected from issue ${String(issueNumber)}.`
				);
			}
			return true;
		} catch (error) {
			appendLog(toErrorMessage(error));
			return false;
		}
	}

	async function executeDaemonCommandById(
		commandId: string,
		steps: OperatorActionExecutionStep[],
		nextSelector: MissionSelector = currentMissionSelector() ?? {}
	) {
		const status = await withDaemonClientRetry(nextSelector, async (currentClient) => {
			const api = new DaemonApi(currentClient);
			return Object.keys(nextSelector).length > 0
				? await api.mission.executeAction(nextSelector, commandId, steps)
				: await api.control.executeAction(commandId, steps);
		});
		applyMissionStatus(status, nextSelector);
		setDaemonState('connected');
		return { status };
	}

	async function launchSelectedTaskSession(taskIdOverride?: string): Promise<boolean> {
		const missionSelector = currentMissionSelector();
		if (!missionSelector) {
			appendLog(noMissionSelectedMessage(status()));
			return true;
		}

		const resolvedTaskId = taskIdOverride?.trim()
			|| selectedTreeTarget()?.taskId
			|| selectedTaskId().trim();
		if (!resolvedTaskId) {
					appendLog('No task is selected. Select a task in mission control before using /launch.');
			return true;
		}

		const sessionsBeforeLaunch = await withDaemonClientRetry(missionSelector, (currentClient) =>
			new DaemonApi(currentClient).mission.listSessions(missionSelector)
		);

		const session = await withDaemonClientRetry(missionSelector, (currentClient) =>
			new DaemonApi(currentClient).mission.launchTaskSession(
				missionSelector,
				resolvedTaskId,
				process.env['MISSION_TERMINAL_SESSION']?.trim()
					? { terminalSessionName: process.env['MISSION_TERMINAL_SESSION'].trim() }
					: undefined
			)
		);
		setSelectedSessionId(session.sessionId);
		setSelectedTreeTargetId(createSessionNodeId(session.sessionId));
		setFocusArea('command');
		const reusedExistingSession = sessionsBeforeLaunch.some(
			(candidate) => candidate.sessionId === session.sessionId
		);
		appendLog(
			reusedExistingSession
				? `Launch requested for ${resolvedTaskId}. Reusing active session ${session.sessionId}.`
				: `Launch requested for ${resolvedTaskId}. Session ${session.sessionId} created.`
		);
		return true;
	}

	async function withDaemonClientRetry<TResult>(
		nextSelector: MissionSelector,
		run: (currentClient: DaemonClient) => Promise<TResult>
	): Promise<TResult> {
		const initialClient = client() ?? (await connectClient(nextSelector));
		if (!initialClient) {
			throw new Error('Unable to connect to the Mission daemon.');
		}

		try {
			return await run(initialClient);
		} catch (error) {
			if (!isRecoverableDaemonDisconnect(error)) {
				throw error;
			}
			await replaceConnection(undefined);
			const reconnectedClient = await connectClient(nextSelector);
			if (!reconnectedClient) {
				throw error;
			}
			return run(reconnectedClient);
		}
	}

	function isRecoverableDaemonDisconnect(error: unknown): boolean {
		const message = error instanceof Error ? error.message : String(error);
		return message.includes('Mission daemon connection closed')
			|| message.includes('Daemon client is not connected')
			|| message.includes('ECONNRESET')
			|| message.includes('EPIPE');
	}

	function currentMissionSelector(): MissionSelector | undefined {
		if (!selectedMissionMatchesLoaded()) {
			return undefined;
		}
		const missionId = currentMissionId();
		return missionId ? { missionId } : undefined;
	}

	function resolveCommandExecutionSelector(command: OperatorActionDescriptor): MissionSelector {
		if (command.id.startsWith('control.')) {
			return {};
		}
		return currentMissionSelector() ?? {};
	}

	async function sendPromptToSelectedSession(text: string): Promise<boolean> {
		const trimmed = text.trim();
		if (!trimmed) {
			return false;
		}
		const session = resolvePromptableSessionRecord();
		if (!session) {
			appendLog('No live agent session is selected. Select a session node to send a reply.');
			return true;
		}
		const missionSelector = currentMissionSelector();
		const currentClient = client() ?? (await connectClient(missionSelector ?? selector()));
		if (!currentClient || !missionSelector) {
			appendLog(noMissionSelectedMessage(status()));
			return true;
		}
		await new DaemonApi(currentClient).mission.promptSession(missionSelector, session.sessionId, {
			source: 'operator',
			text: trimmed
		});
		appendLog(`Sent prompt to ${session.sessionId}.`);
		return true;
	}

	async function executeActionByText(commandText: string): Promise<boolean> {
		const command = findAvailableCommandByText(availableActions(), commandText);
		if (!command) {
			return false;
		}
		return executeActionById(command.id);
	}

	async function executeActionById(commandId: string): Promise<boolean> {
		const command = availableCommandById().get(commandId);
		if (!command) {
			return false;
		}

		if (!command.enabled) {
			appendLog(command.reason ?? `Action ${command.action} is not available for the selected target.`);
			return true;
		}

		if (!command.id.startsWith('control.') && !currentMissionSelector()) {
			appendLog(noMissionSelectedMessage(status()));
			return true;
		}

		if (command.id === 'control.issues.list') {
			await loadIssues();
			return true;
		}

		const flowSteps = command.flow?.steps ?? [];
		if (flowSteps.length > 0) {
			const definition = buildCommandFlowFromCommand(
				command,
				resolveCommandExecutionSelector(command),
				(result) => {
					if (command.id === 'control.mission.start') {
						const nextStatus = result.status;
						if (!nextStatus) {
							return 'Mission prepared.';
						}
						if (nextStatus.preparation?.kind === 'repository-bootstrap') {
							return `Repository bootstrap prepared on ${nextStatus.preparation.branchRef}. PR: ${nextStatus.preparation.pullRequestUrl}`;
						}
						if (nextStatus.preparation?.kind === 'mission') {
							return `Mission ${nextStatus.preparation.missionId} prepared on ${nextStatus.preparation.branchRef}. Worktree: ${nextStatus.preparation.worktreePath}`;
						}
						return `Mission ${nextStatus.missionId ?? 'unknown'} selected on ${nextStatus.branchRef ?? 'its mission branch'}.`;
					}
					if (command.id === 'control.mission.select') {
						const missionId = result.status?.missionId;
						return missionId ? `Selected mission ${missionId}.` : 'Selected mission.';
					}
					if (command.id === 'control.setup.edit') {
						return 'Setting saved.';
					}
					return undefined;
				}
			);
			if (!definition) {
				appendLog(`Mission action ${command.action} is not available right now.`);
				return true;
			}
			startCommandFlow(definition);
			return true;
		}

		if (command.id.startsWith('task.launch.')) {
			return launchSelectedTaskSession(command.targetId);
		}

		const result = await executeDaemonCommandById(
			command.id,
			[],
			resolveCommandExecutionSelector(command)
		);

		if (command.id === 'mission.deliver') {
			appendLog(result.status && isMissionDelivered(result.status) ? 'Mission delivered.' : 'Mission delivery completed.');
			return true;
		}

		if (command.id.startsWith('task.start.') || command.id.startsWith('task.done.') || command.id.startsWith('task.block.') || command.id.startsWith('task.reopen.')) {
			appendLog(`${command.label}${command.targetId ? `: ${command.targetId}` : '.'}`);
			return true;
		}

		if (command.id.startsWith('session.cancel.')) {
			appendLog(`Cancellation requested for ${command.targetId ?? 'session'}.`);
			return true;
		}

		if (command.id.startsWith('session.terminate.')) {
			appendLog(`Termination requested for ${command.targetId ?? 'session'}.`);
			return true;
		}

		appendLog(`Executed ${command.action}.`);
		return true;
	}

	function moveToolbarCommandSelection(delta: number): void {
		const items = toolbarCommands().filter((item) => item.enabled);
		if (items.length === 0) {
			setSelectedToolbarCommandId(undefined);
			return;
		}
		const current = selectedToolbarCommandId();
		const currentIndex = Math.max(0, items.findIndex((item) => item.id === current));
		const nextIndex = (currentIndex + delta + items.length) % items.length;
		setSelectedToolbarCommandId(items[nextIndex]?.id);
	}

	function moveToolbarConfirmationSelection(delta: number): void {
		if (delta === 0) {
			return;
		}
		setToolbarConfirmationChoice((current) => (current === 'confirm' ? 'cancel' : 'confirm'));
	}

	function openToolbarConfirmation(): void {
		const command = selectedToolbarCommand();
		if (!command) {
			appendLog('No command is selected.');
			return;
		}
		if (!command.enabled) {
			appendLog(command.reason ?? `Action ${command.action} is not available for the selected target.`);
			return;
		}
		setConfirmingToolbarCommandId(command.id);
		setToolbarConfirmationChoice('confirm');
	}

	async function submitToolbarConfirmation(): Promise<void> {
		const commandId = confirmingToolbarCommandId();
		if (!commandId) {
			const selected = selectedToolbarCommand();
			if (!selected) {
				appendLog('No command is selected.');
				return;
			}
			if (!selected.enabled) {
				appendLog(selected.reason ?? `Action ${selected.action} is not available for the selected target.`);
				return;
			}
			if (selected.ui?.requiresConfirmation === true) {
				openToolbarConfirmation();
				return;
			}
			appendLog(`Executing ${selected.action}.`);
			setIsRunningCommand(true);
			try {
				await executeActionById(selected.id);
			} catch (error) {
				appendLog(toErrorMessage(error));
			} finally {
				setIsRunningCommand(false);
			}
			return;
		}
		if (toolbarConfirmationChoice() === 'cancel') {
			setConfirmingToolbarCommandId(undefined);
			setToolbarConfirmationChoice('confirm');
			return;
		}
		const command = availableCommandById().get(commandId);
		setConfirmingToolbarCommandId(undefined);
		setToolbarConfirmationChoice('confirm');
		if (!command) {
			appendLog('Selected command is no longer available.');
			return;
		}
		appendLog(`Executing ${command.action}.`);
		setIsRunningCommand(true);
		try {
			await executeActionById(command.id);
		} catch (error) {
			appendLog(toErrorMessage(error));
		} finally {
			setIsRunningCommand(false);
		}
	}

	async function executeCommand(rawCommand: string): Promise<void> {
		const trimmed = rawCommand.trim();
		if (!trimmed) {
			return;
		}
		setIsRunningCommand(true);
		try {
			if (!trimmed.startsWith('/')) {
				await sendPromptToSelectedSession(trimmed);
				return;
			}

			appendLog(`Executing ${trimmed}.`);

			const [instruction, ...args] = trimmed.split(/\s+/u);
			if (!instruction) {
				return;
			}
			switch (instruction.toLowerCase()) {
				case '/help':
					appendLogLines([
						'/setup',
						'/repo [query]',
						'/add-repo [path]',
						'/theme [ocean|sand]',
						...(workspaceContext.kind === 'control-root' ? ['/root'] : []),
						'/issues',
						'/issue <number>',
						'/start',
						'/select',
						...(selectedMissionMatchesLoaded() ? ['/launch', '/task <active|done|blocked>'] : []),
						'/gate [implement|verify|audit|deliver]',
						'/transition <stage>',
						'/cancel',
						'/terminate',
						'/deliver',
						'/sessions',
						'/clear',
						'/quit'
					]);
					return;
				case '/clear':
					setActivityLog([]);
					return;
				case '/quit':
					renderer.destroy();
					return;
				case '/setup':
				case '/init':
				case '/start':
				case '/select':
				case '/task':
				case '/transition':
				case '/cancel':
				case '/terminate':
				case '/deliver':
					if (await executeActionByText(trimmed)) {
						return;
					}
					appendLog(`Command ${trimmed} is not available for the selected target.`);
					return;
				case '/root': {
					if (workspaceContext.kind !== 'control-root') {
						appendLog('This tower is locked to the current mission worktree. Relaunch from the repository root to browse missions.');
						return;
					}
					await connectClient({});
					closeCommandPicker();
					appendLog('Returned to repository mode.');
					return;
				}
				case '/repo': {
					if (args.length === 0) {
						if (await executeActionByText(trimmed)) {
							return;
						}
						appendLog('Repository switch is not available right now.');
						return;
					}
					await switchRepositoryByQuery(args.join(' '));
					return;
				}
				case '/add-repo': {
					if (args.length === 0) {
						if (await executeActionByText(trimmed)) {
							return;
						}
						appendLog('Repository registration is not available right now.');
						return;
					}
					await addRepositoryAndSwitch(args.join(' '));
					return;
				}
				case '/launch': {
					await launchSelectedTaskSession(args[0]);
					return;
				}
				case '/issues':
					await loadIssues();
					return;
				case '/theme': {
					const requestedTheme = args[0];
					if (!requestedTheme) {
						openThemePicker();
						return;
					}
					await selectThemeById(requestedTheme.toLowerCase());
					return;
				}
				case '/issue': {
					const issueNumber = args[0];
					if (!issueNumber) {
						await loadIssues();
						return;
					}
					if (!/^\d+$/u.test(issueNumber)) {
						appendLog('Usage: /issue <number>');
						return;
					}
					if (selectedMissionMatchesLoaded()) {
						appendLog('Issue intake is only available in repository mode. Use /root first.');
						return;
					}
					await selectIssueByNumber(Number(issueNumber));
					return;
				}
				case '/sessions':
					if (!selectedMissionMatchesLoaded()) {
						appendLog('No mission is selected.');
						return;
					}
					if (sessions().length === 0) {
						appendLog('No agent sessions are currently attached to this mission.');
						return;
					}
					appendLogLines(
						sessions().map(
							(session) =>
								`${session.sessionId} | ${session.runnerId} | ${session.lifecycleState}${session.assignmentLabel ? ` | ${session.assignmentLabel}` : ''}`
						)
					);
					return;
				case '/gate': {
					const missionSelector = currentMissionSelector();
					const currentClient = client() ?? (await connectClient(missionSelector ?? selector()));
					if (!selectedMissionMatchesLoaded() || !currentClient || !missionSelector) {
						appendLog(noMissionSelectedMessage(status()));
						return;
					}
					const intent = (args[0] as GateIntent | undefined) ?? gateIntentForStage(
						selectedStageId()
					);
					const gate = await new DaemonApi(currentClient).mission.evaluateGate(missionSelector, intent);
					appendLog(gate.allowed ? `Gate ${intent} passed.` : `Gate ${intent} blocked: ${gate.errors.join(' | ')}`);
					return;
				}
				default:
					if (await executeActionByText(trimmed)) {
						return;
					}
					appendLog(`Unknown command '${trimmed}'. Type /help.`);
					return;
			}
		} catch (error) {
			appendLog(toErrorMessage(error));
		} finally {
			setIsRunningCommand(false);
		}
	}

	function buildCommandLine(argumentValue: string): string {
		const commandText = selectedCommand()?.action?.trim();
		const argsText = argumentValue.trim();
		if (!commandText) {
			return argsText;
		}
		return argsText.length > 0 ? `${commandText} ${argsText}` : commandText;
	}

	return (
		<Show when={selectedThemeName()} keyed>
			<Show when={!showIntroSplash()} fallback={<IntroSplash onComplete={() => setShowIntroSplash(false)} />}>
				<TowerScreen
					headerPanelTitle={headerPanelTitle()}
					showHeader={true}
					title={screenTitle()}
					headerTabs={headerTabs().map((tab) => ({ id: tab.id, label: tab.label }))}
					headerSelectedTabId={effectiveHeaderTabId()}
					headerTabsFocusable={headerTabsFocusable()}
					headerStatusLines={headerStatusLines()}
					headerFooterBadges={headerFooterBadges()}
					stageItems={stageItems()}
					focusArea={focusArea()}
					centerContent={centerContent()}
					overlayContent={overlayContent()}
					showCommandPanel={true}
					commandPanelTitle={commandPanelDescriptor().title}
					commandPanelPlaceholder={commandPanelDescriptor().placeholder}
					{...(commandPanelPrefix() ? { commandPanelPrefix: commandPanelPrefix() } : {})}
					isRunningCommand={isCommandInteractionRunning()}
					inputValue={commandPanelInputValue()}
					commandHelp={commandHelp()}
					keyHintsText={keyHintsText()}
					onInputChange={(value) => {
						const nextValue = isMissionFlowTextStep() ? value : value;
						if (isMissionFlowTextStep()) {
							flowController.setTextValue(nextValue);
							return;
						}
						if (!selectedCommandId()) {
							const normalizedFilter = nextValue.startsWith('/')
								? normalizeCommandInputValue(nextValue).replace(/^\//u, '')
								: nextValue;
							setInputValue(normalizedFilter);
							updateCommandPicker(normalizedFilter);
							return;
						}
						setInputValue(nextValue);
					}}
					onInputSubmit={(submittedValue?: string) => {
						const value = typeof submittedValue === 'string' ? submittedValue : commandPanelInputValue();
						if (isMissionFlowTextStep()) {
							flowController.setTextValue(value);
							void submitCommandFlowTextStep(value);
							return;
						}
						const trimmedValue = value.trim();
						if (showCommandPicker()) {
							const exactCommand = findAvailableCommandByText(availableActions(), commandInputQuery());
							if (exactCommand) {
								setInputValue('');
								closeCommandPicker({ clearCommandInput: true });
								void executeCommand(exactCommand.action);
								return;
							}
							const submittedCommandItems = commandPickerItems();
							const nextSelectedCommandId = pickSelectItemId(
								submittedCommandItems,
								selectedCommandPickerItemId()
							) ?? submittedCommandItems[0]?.id;
							if (nextSelectedCommandId) {
								selectCommandById(nextSelectedCommandId, {
									items: submittedCommandItems
								});
							} else {
								setInputValue('');
								closeCommandPicker({ clearCommandInput: true });
								void executeCommand(commandInputQuery());
							}
							return;
						}
						if (!selectedCommandId()) {
							const submittedQuery = commandInputQuery();
							const exactCommand = findAvailableCommandByText(availableActions(), submittedQuery);
							if (exactCommand) {
								setInputValue('');
								void executeCommand(exactCommand.action);
								return;
							}
							const submittedCommandItems = submittedQuery
								? buildCommandPickerItems(availableActions(), submittedQuery, { includeDisabled: true })
								: [];
							if (submittedCommandItems.length > 0) {
								const nextSelectedCommandId = pickSelectItemId(
									submittedCommandItems,
									selectedCommandPickerItemId()
								) ?? submittedCommandItems[0]?.id;
								if (nextSelectedCommandId) {
									selectCommandById(nextSelectedCommandId, {
										items: submittedCommandItems
									});
								}
								return;
							}
							appendLog('No commands are available for the current selection.');
							return;
						}
						const commandLine = buildCommandLine(trimmedValue);
						const exactCommand = findAvailableCommandByText(availableActions(), commandLine);
						if (exactCommand) {
							setInputValue('');
							void executeCommand(commandLine);
							return;
						}
						setInputValue('');
						void executeCommand(commandLine);
					}}
					onInputKeyDown={(event) => {
						if (event.sequence === '/' && !isMissionFlowTextStep()) {
							event.preventDefault();
							event.stopPropagation();
							openCommandPickerShortcut();
							return;
						}
						if (event.name === 'escape') {
							if (focusArea() !== 'command') {
								return;
							}
							event.preventDefault();
							event.stopPropagation();
							if (activePicker() === 'command-select') {
								closeCommandPicker({ clearCommandInput: commandQuery() === '/' });
								return;
							}
							if (isMissionFlowTextStep()) {
								resetCommandFlow({ clearCommandInput: true });
								setFocusArea('command');
								return;
							}
							if (selectedCommandId() && inputValue().trim().length === 0) {
								setSelectedCommandId(undefined);
								updateCommandPicker('');
								setFocusArea('command');
								return;
							}
							setInputValue('');
							setFocusArea('command');
							return;
						}
						if (event.name !== 'left' && event.name !== 'right') {
							return;
						}
						if (isMissionFlowTextStep()) {
							return;
						}
						if (selectedCommandId() && inputValue().trim().length > 0) {
							return;
						}
						if (focusArea() !== 'command') {
							return;
						}
						const trimmed = commandPanelInputValue().trim();
						if (!selectedCommandId() && trimmed.length > 0 && trimmed.startsWith('/')) {
							return;
						}
						if (selectedCommandId() && trimmed.length > 0) {
							return;
						}
						event.preventDefault();
						event.stopPropagation();
						cycleCommandInput(event.name === 'left' ? -1 : 1);
				}}
			/>
		</Show>
		</Show>
	);

}
function asMissionStatusNotification(
	event: unknown
): { type: 'mission.status'; workspaceRoot: string; missionId: string; status: OperatorStatus } | undefined {
	if (!event || typeof event !== 'object') {
		return undefined;
	}
	const candidate = event as { type?: unknown; workspaceRoot?: unknown; missionId?: unknown; status?: unknown };
	if (candidate.type !== 'mission.status') {
		return undefined;
	}
	if (typeof candidate.workspaceRoot !== 'string' || candidate.workspaceRoot.length === 0) {
		return undefined;
	}
	if (typeof candidate.missionId !== 'string' || candidate.missionId.length === 0) {
		return undefined;
	}
	if (!candidate.status || typeof candidate.status !== 'object') {
		return undefined;
	}
	return candidate as { type: 'mission.status'; workspaceRoot: string; missionId: string; status: OperatorStatus };
}

function selectorFromTowerState(
	status: OperatorStatus,
	snapshot: MissionSystemSnapshot | undefined,
	fallback: MissionSelector = {}
): MissionSelector {
	if (status.missionId) {
		return { missionId: status.missionId };
	}
	const projectedMissionId = snapshot?.airportProjections.dashboard.missionId;
	if (projectedMissionId) {
		return { missionId: projectedMissionId };
	}
	if (fallback.missionId) {
		return { missionId: fallback.missionId };
	}
	return {};
}

function clampIndex(index: number, length: number): number {
	return Math.max(0, Math.min(length - 1, index));
}

function describeAgentEvent(event: { type: string; state: { sessionId: string } }): string {
	if (event.type === 'prompt-accepted') {
		return `prompt sent · ${event.state.sessionId}`;
	}
	if (event.type === 'prompt-rejected') {
		const candidate = event as { reason?: string; state: { sessionId: string } };
		return candidate.reason
			? `prompt rejected · ${candidate.state.sessionId} · ${candidate.reason}`
			: `prompt rejected · ${candidate.state.sessionId}`;
	}
	return `${event.type} · ${event.state.sessionId}`;
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function createInitialStatusMessage(initialConnectionError?: string): string {
	if (initialConnectionError) {
		return `Tower could not connect immediately: ${initialConnectionError}`;
	}
	return 'Connecting to the Mission daemon.';
}

function isCommandQueryInput(value: string): boolean {
	return /^\/\S*$/u.test(value.trim());
}

function parseCommandQuery(value: string): string {
	const trimmed = value.trim();
	return isCommandQueryInput(trimmed) ? trimmed : '';
}

function normalizeCommandInputValue(value: string): string {
	if (value.startsWith('/')) {
		return value.replace(/^\/+/u, '/');
	}
	return value;
}

const repositoryTabId = 'repository';

function buildCommandPickerItems(
	commands: OperatorActionDescriptor[],
	query: string,
	options?: { includeDisabled?: boolean }
): CommandItem[] {
	const normalizedQuery = query.toLowerCase();
	const includeDisabled = options?.includeDisabled ?? false;
	return commands
		.map((command) => ({
			id: command.id,
			command: command.action,
			label: command.action,
			description: formatCommandDescription(command),
			disabled: !command.enabled
		}))
		.filter((command) => includeDisabled || !command.disabled)
		.filter((command) => {
			if (!normalizedQuery) {
				return true;
			}
			const commandText = command.command.toLowerCase();
			const labelText = command.label.toLowerCase();
			const descriptionText = command.description.toLowerCase();
			return (
				commandText.includes(normalizedQuery) ||
				labelText.includes(normalizedQuery) ||
				descriptionText.includes(normalizedQuery)
			);
		});
}

function formatCommandDescription(command: OperatorActionDescriptor): string {
	const baseDescription = command.targetId ? `${command.label} [${command.targetId}]` : command.label;
	if (command.enabled || !command.reason) {
		return baseDescription;
	}
	return `${baseDescription} - Unavailable: ${command.reason}`;
}

function buildIssuePickerItems(issues: TrackedIssueSummary[]): SelectItem[] {
	return issues.map((issue) => ({
		id: String(issue.number),
		label: `#${String(issue.number)} ${issue.title}`,
		description: formatIssueDescription(issue)
	}));
}

function buildHeaderTabs(
	status: OperatorStatus,
	missionCandidates: MissionSelectionCandidate[] = []
): HeaderTab[] {
	const tabs: HeaderTab[] = [];
	const seenMissionIds = new Set<string>();
	const activeMissionId = status.missionId?.trim();
	if (activeMissionId) {
		const activeMissionTitle = missionCandidates.find(
			(candidate) => candidate.missionId === activeMissionId
		)?.title || activeMissionId;
		tabs.push({
			id: `mission:${activeMissionId}`,
			label: formatHeaderMissionLabel(
				activeMissionId,
				missionCandidates.find((candidate) => candidate.missionId === activeMissionId)?.issueId,
				activeMissionTitle
			),
			target: { kind: 'mission', missionId: activeMissionId }
		});
		seenMissionIds.add(activeMissionId);
	}
	for (const candidate of missionCandidates) {
		if (!candidate.missionId || seenMissionIds.has(candidate.missionId)) {
			continue;
		}
		tabs.push({
			id: `mission:${candidate.missionId}`,
			label: formatHeaderMissionLabel(candidate.missionId, candidate.issueId, candidate.title),
			target: { kind: 'mission', missionId: candidate.missionId }
		});
		seenMissionIds.add(candidate.missionId);
	}
	tabs.push(
		{
			id: repositoryTabId,
			label: 'REPOSITORY',
			target: { kind: 'repository' }
		}
	);
	return tabs;
}

function formatHeaderMissionLabel(missionId: string, issueId?: number, title?: string): string {
	const summary = buildHeaderMissionSummary(missionId, issueId, title);
	return `${summary.typeLabel} ${summary.numberLabel}`;
}

function pickPreferredHeaderTabId(
	tabs: HeaderTab[],
	current: string | undefined,
	active: string
): string | undefined {
	if (tabs.length === 0) {
		return undefined;
	}
	if (current && tabs.some((tab) => tab.id === current)) {
		return current;
	}
	if (tabs.some((tab) => tab.id === active)) {
		return active;
	}
	return tabs[0]?.id;
}

function moveHeaderTabSelection(
	tabs: HeaderTab[],
	current: string | undefined,
	delta: number
): string | undefined {
	if (tabs.length === 0) {
		return undefined;
	}
	const currentId = current && tabs.some((tab) => tab.id === current) ? current : tabs[0]?.id;
	const currentIndex = Math.max(0, tabs.findIndex((tab) => tab.id === currentId));
	const nextIndex = clampIndex(currentIndex + delta, tabs.length);
	return tabs[nextIndex]?.id;
}

function buildFocusOrder(input: {
	baseOrder: FocusArea[];
	headerTabsFocusable: boolean;
	showCommandFlow: boolean;
	showCommandPicker: boolean;
	expandedComposer: boolean;
}): FocusArea[] {
	if (input.expandedComposer) {
		return ['flow', 'command'];
	}
	const baseOrder = input.headerTabsFocusable
		? input.baseOrder
		: input.baseOrder.filter((area) => area !== 'header');
	if (!input.showCommandFlow && !input.showCommandPicker) {
		return baseOrder;
	}
	return ['flow', ...baseOrder.filter((area) => area !== 'flow' && area !== 'command'), 'command'];
}

async function resolveGitHubCliUser(cwd: string): Promise<string | undefined> {
	return new Promise<string | undefined>((resolve) => {
		const child = spawn('gh', ['api', 'user', '--jq', '.login'], {
			cwd,
			env: {
				...process.env,
				NO_COLOR: '1',
				TERM: 'dumb'
			},
			stdio: ['ignore', 'pipe', 'ignore']
		});

		let stdout = '';
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.once('error', () => {
			resolve(undefined);
		});
		child.once('close', (code) => {
			if (code !== 0) {
				resolve(undefined);
				return;
			}
			const user = stdout.trim();
			resolve(user.length > 0 ? user : undefined);
		});
	});
}

async function resolveGitBranchName(cwd: string): Promise<string | undefined> {
	return new Promise<string | undefined>((resolve) => {
		const child = spawn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
			cwd,
			env: {
				...process.env,
				NO_COLOR: '1',
				TERM: 'dumb'
			},
			stdio: ['ignore', 'pipe', 'ignore']
		});

		let stdout = '';
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.once('error', () => {
			resolve(undefined);
		});
		child.once('close', (code) => {
			if (code !== 0) {
				resolve(undefined);
				return;
			}
			const branch = stdout.trim();
			resolve(branch.length > 0 ? branch : undefined);
		});
	});
}

function pickSelectItemId(items: SelectItem[], current: string | undefined): string | undefined {
	if (items.length === 0) {
		return undefined;
	}
	if (current && items.some((item) => item.id === current)) {
		return current;
	}
	return items[0]?.id;
}

function buildProjectedStageStatuses(
	domain: ContextGraph | undefined,
	stageRail: Array<{ id: string; label: string; state: string }> | undefined
): MissionStageStatus[] {
	if (!domain) {
		return [];
	}

	const tasksByStage = new Map<MissionStageId, MissionTaskState[]>();
	for (const taskContext of Object.values(domain.tasks)) {
		const blockedBy = taskContext.dependencyIds.filter((dependencyId) => domain.tasks[dependencyId]?.lifecycleState !== 'done');
		const tasks = tasksByStage.get(taskContext.stageId) ?? [];
		tasks.push({
			taskId: taskContext.taskId,
			stage: taskContext.stageId,
			sequence: tasks.length + 1,
			subject: taskContext.subject,
			instruction: taskContext.instructionSummary,
			body: taskContext.instructionSummary,
			dependsOn: [...taskContext.dependencyIds],
			blockedBy,
			status: taskContext.lifecycleState,
			agent: 'projected',
			retries: 0,
			fileName: `${taskContext.taskId}.md`,
			filePath: taskContext.taskId,
			relativePath: taskContext.taskId
		});
		tasksByStage.set(taskContext.stageId, tasks);
	}

	const orderedStageIds = new Set<MissionStageId>();
	for (const item of stageRail ?? []) {
		if (item.id) {
			orderedStageIds.add(item.id as MissionStageId);
		}
	}
	for (const stageId of tasksByStage.keys()) {
		orderedStageIds.add(stageId);
	}

	return [...orderedStageIds].map((stageId) => {
		const tasks = (tasksByStage.get(stageId) ?? []).sort((left, right) => left.sequence - right.sequence || left.taskId.localeCompare(right.taskId));
		const activeTaskIds = tasks.filter((task) => task.status === 'active').map((task) => task.taskId);
		const readyTaskIds = tasks.filter((task) => task.status === 'todo' && task.blockedBy.length === 0).map((task) => task.taskId);
		const completedTaskCount = tasks.filter((task) => task.status === 'done').length;
		const railState = stageRail?.find((item) => item.id === stageId)?.state;
		const status = railState === 'done' || railState === 'active' || railState === 'blocked' || railState === 'pending'
			? railState
			: activeTaskIds.length > 0
				? 'active'
				: completedTaskCount === tasks.length && tasks.length > 0
					? 'done'
					: tasks.some((task) => task.blockedBy.length > 0)
						? 'blocked'
						: 'pending';
		return {
			stage: stageId,
			folderName: stageId,
			status,
			taskCount: tasks.length,
			completedTaskCount,
			activeTaskIds,
			readyTaskIds,
			tasks
		};
	});
}

function buildProjectedSessionRecords(
	domain: ContextGraph | undefined
): MissionAgentSessionRecord[] {
	if (!domain) {
		return [];
	}

	return Object.values(domain.agentSessions)
		.map((session) => ({
			sessionId: session.sessionId,
			runnerId: session.runnerId,
			runnerLabel: session.runnerId,
			lifecycleState: session.lifecycleState as MissionAgentSessionRecord['lifecycleState'],
			...(session.taskId ? { taskId: session.taskId } : {}),
			...(session.taskId ? { assignmentLabel: domain.tasks[session.taskId]?.subject ?? session.taskId } : {}),
			...(session.workingDirectory ? { workingDirectory: session.workingDirectory } : {}),
			...(session.promptTitle ? { currentTurnTitle: session.promptTitle } : {}),
			...(session.transportId ? { transportId: session.transportId } : {}),
			createdAt: '',
			lastUpdatedAt: ''
		}))
		.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
}

function buildProjectedMissionCandidates(
	domain: ContextGraph | undefined
): MissionSelectionCandidate[] {
	return Object.values(domain?.missions ?? {})
		.map((mission) => {
			return {
				missionId: mission.missionId,
				title: mission.briefSummary,
				branchRef: mission.branchRef ?? mission.missionId,
				createdAt: mission.createdAt ?? '',
				...(mission.issueId !== undefined ? { issueId: mission.issueId } : {})
			} satisfies MissionSelectionCandidate;
		})
		.sort((left, right) => left.missionId.localeCompare(right.missionId));
}

function pickPreferredToolbarCommandId(
	items: CommandToolbarItem[],
	current: string | undefined
): string | undefined {
	const enabledItems = items.filter((item) => item.enabled);
	if (enabledItems.length === 0) {
		return undefined;
	}
	if (current && enabledItems.some((item) => item.id === current)) {
		return current;
	}
	return enabledItems[0]?.id;
}

function formatToolbarCommandLabel(command: OperatorActionDescriptor): string {
	if (command.ui?.toolbarLabel) {
		return command.ui.toolbarLabel.trim().toUpperCase();
	}
	const normalized = command.action.trim().replace(/^\/+/u, '').replace(/\s+/gu, ' ');
	return normalized.toUpperCase();
}

function formatIssueDescription(issue: TrackedIssueSummary): string {
	const labelText = issue.labels.length > 0 ? issue.labels.join(', ') : 'no labels';
	return `${issue.url} | ${labelText}`;
}

function buildKeyHintsText(input: {
	focusArea: FocusArea;
	activePicker: PickerMode | undefined;
	commandItems: CommandItem[];
	inputValue: string;
	selectedHeaderTabKind: HeaderTab['target']['kind'] | undefined;
	currentFlowStep: CommandFlowStep | undefined;
	towerMode: TowerMode;
}): string {
	if (input.activePicker === 'command-select') {
		return 'Tab/Shift+Tab focus | ↑/↓ navigate | Enter insert | Backspace filter | Esc close | Ctrl+Q quit';
	}
	if (input.focusArea === 'command') {
		if (input.currentFlowStep && input.towerMode !== 'repository') {
			return 'Tab/Shift+Tab focus | Enter continue | Ctrl+Q quit';
		}
		return 'Tab/Shift+Tab focus | ←/→ command | Enter submit | Ctrl+Q quit';
	}
	if (input.focusArea === 'flow' && input.currentFlowStep?.kind === 'selection') {
		if (input.currentFlowStep.selectionMode === 'multiple') {
			return 'Tab/Shift+Tab focus | ↑/↓ navigate | Space toggle | ←/→ step | Enter continue | Ctrl+Q quit';
		}
		return 'Tab/Shift+Tab focus | ↑/↓ navigate | ←/→ step | Enter continue | Ctrl+Q quit';
	}
	if (input.focusArea === 'flow' && input.towerMode === 'repository') {
		if (input.currentFlowStep?.kind === 'text') {
			return 'Tab/Shift+Tab focus | Ctrl+←/→ step | Enter continue | Ctrl+Q quit';
		}
		return 'Tab/Shift+Tab focus | ↑/↓ navigate | ←/→ step | Enter continue | Ctrl+Q quit';
	}
	if (input.focusArea === 'tree') {
		return 'Tab/Shift+Tab focus | ↑/↓ navigate | ←/→ select | PgUp/PgDn scroll | Enter select | Ctrl+Q quit';
	}
	return 'Tab/Shift+Tab focus | ↑/↓ navigate | ←/→ select | Enter select | Ctrl+Q quit';
}

function canUseIssueIntake(control: OperatorStatus['control']): boolean {
	return Boolean(control?.issuesConfigured && control.githubAuthenticated === true);
}

function describeIssueIntakeStatus(control: OperatorStatus['control']): string {
	if (!control) {
		return 'Repository status is still loading.';
	}
	if (!control.issuesConfigured) {
		return 'Mission could not resolve a GitHub repository from the current workspace.';
	}
	if (control.githubAuthenticated === false) {
		return control.githubAuthMessage ?? 'GitHub CLI authentication is required for issue intake.';
	}
	return 'GitHub issue intake is not ready yet.';
}

function describeControlConnection(status: OperatorStatus): string {
	const control = status.control;
	if (!control) {
		return 'Connected to Mission repository.';
	}
	return control.problems.length > 0
		? 'Connected to Mission setup. Run /setup to finish configuration.'
		: 'Connected to Mission repository.';
}

function noMissionSelectedMessage(status: OperatorStatus): string {
	if (status.operationalMode === 'setup') {
		return 'Mission setup is incomplete. Run /setup first.';
	}
	return 'No mission is selected. Use /start to create one or /select to open an existing mission.';
}

function buildCommandPanelDescriptor(input: {
	commandFlow: CommandFlowState | undefined;
	currentCommandFlowStep: CommandFlowStep | undefined;
	showCommandPicker: boolean;
	selectedCommandText: string | undefined;
	availableActions: OperatorActionDescriptor[];
	inputValue: string;
	status: OperatorStatus;
	canSendSessionText: boolean;
	selectedSessionId: string | undefined;
	selectedStageId: MissionStageId | undefined;
	selectedTreeTargetTitle: string | undefined;
	selectedTreeTargetKind: TreeTargetKind | undefined;
}): CommandPanelDescriptor {
	if (input.currentCommandFlowStep?.kind === 'text') {
		return {
			title: buildFlowStepTitle(
				input.commandFlow?.definition.targetLabel ?? 'COMMAND',
				input.currentCommandFlowStep.label,
				input.commandFlow?.definition.actionLabel ?? 'RUN'
			),
			placeholder: input.currentCommandFlowStep.placeholder
		};
	}
	if (input.currentCommandFlowStep?.kind === 'selection') {
		return {
			title: buildFlowStepTitle(
				input.commandFlow?.definition.targetLabel ?? 'COMMAND',
				input.currentCommandFlowStep.label,
				input.commandFlow?.definition.actionLabel ?? 'RUN'
			),
			placeholder: input.currentCommandFlowStep.selectionMode === 'multiple'
				? 'Use arrows to browse, Space to toggle, and Enter to continue.'
				: 'Use arrows to choose and Enter to continue.'
		};
	}
	const exactCommand = findAvailableCommandByText(input.availableActions, input.selectedCommandText ?? input.inputValue.trim());
	if (exactCommand?.flow) {
		const firstStep = exactCommand.flow.steps[0];
		return {
			title: buildFlowStepTitle(
				exactCommand.flow.targetLabel,
				firstStep?.label ?? exactCommand.flow.actionLabel,
				exactCommand.flow.actionLabel
			),
			placeholder: exactCommand.flow.steps.length > 0
				? exactCommand.flow.steps[0]?.helperText ?? 'Press Enter to continue.'
				: 'Press Enter to execute.'
		};
	}
	if (input.showCommandPicker && input.selectedCommandText) {
		return describeCommandPanelIntent(input.selectedCommandText, input.status, input.selectedStageId);
	}
	if (input.selectedCommandText) {
		return describeCommandPanelIntent(input.selectedCommandText, input.status, input.selectedStageId);
	}
	const trimmed = input.inputValue.trim();
	if (!trimmed) {
		if (input.canSendSessionText && input.selectedSessionId) {
			return {
				title: 'AGENT > SEND',
				placeholder: 'Type a reply for the selected agent session or start a command with /'
			};
		}
		if (input.status.found && input.selectedTreeTargetTitle) {
			return {
				title: buildFlowStepTitle(
					dockTargetLabel(input.selectedTreeTargetKind),
					input.selectedTreeTargetTitle,
					'ACTION'
				),
				placeholder: 'Enter an action for the selected target or use left/right to browse available actions.'
			};
		}
		const scope = commandScopeLabel(input.status);
		return {
			title: `${scope} > ACTION`,
			placeholder: scope === 'MISSION'
				? 'Enter a mission action or agent reply'
				: 'Enter a repository action'
		};
	}
	if (!trimmed.startsWith('/')) {
		return {
			title: 'AGENT > SEND',
			placeholder: 'Type a reply for the selected agent session'
		};
	}
	return describeCommandPanelIntent(trimmed, input.status, input.selectedStageId);
}

function findAvailableCommandByText(
	commands: OperatorActionDescriptor[],
	commandText: string | undefined
): OperatorActionDescriptor | undefined {
	const trimmed = commandText?.trim();
	if (!trimmed) {
		return undefined;
	}
	return commands.find((command) => command.action === trimmed);
}

function describeCommandPanelIntent(
	commandLine: string,
	status: OperatorStatus,
	selectedStageId: MissionStageId | undefined
): CommandPanelDescriptor {
	const [instruction, ...args] = commandLine.trim().split(/\s+/u);
	if (!instruction) {
		return {
			title: 'COMMAND > RUN',
			placeholder: 'Press Enter to run the current command.'
		};
	}
	switch (instruction.toLowerCase()) {
		case '/setup':
		case '/init':
			return {
					title: 'SETUP > SETTING > SAVE',
					placeholder: 'Press Enter to open the guided setup flow.'
			};
			case '/repo':
				return {
					title: 'REPO > SWITCH',
					placeholder: 'Enter a repo name or press Enter to open the repo picker.'
				};
			case '/add-repo':
				return {
					title: 'REPO > ADD',
					placeholder: 'Enter a repository path or press Enter for a guided prompt.'
				};
		case '/root':
			return {
				title: 'MISSION > SWITCH',
				placeholder: 'Press Enter to return to repository mode.'
			};
			case '/start':
				return {
						title: 'MISSION > TYPE > PREPARE',
						placeholder: 'Press Enter to open the guided mission preparation flow.'
				};
			case '/select':
				return {
					title: 'MISSION > MISSION > SWITCH',
					placeholder: 'Press Enter to choose a mission from repository mode.'
				};
		case '/issues':
			return {
				title: 'ISSUES > BROWSE',
				placeholder: 'Press Enter to browse open GitHub issues.'
			};
		case '/issue':
			return {
				title: 'ISSUE > START',
				placeholder: 'Enter an issue number or open the issue selector.'
			};
		case '/theme':
			return {
				title: 'THEME > APPLY',
				placeholder: 'Enter a theme name or open the theme selector.'
			};
		case '/launch':
			return {
				title: 'TASK > SESSION > LAUNCH',
				placeholder: 'Launch an agent session for the selected task target.'
			};
		case '/task': {
			const action = (args[0] ?? 'state').toUpperCase();
			return {
				title: `TASK > ${action}`,
				placeholder: 'Set selected task state using active, done, or blocked.'
			};
		}
		case '/start':
			return {
				title: 'MISSION > START',
				placeholder: 'Enter <title> | <body> | [type].'
			};
		case '/select':
			return {
				title: 'MISSION > SWITCH',
				placeholder: 'Enter a mission id or open the mission selector.'
			};
		case '/sessions':
			return {
				title: 'AGENT > LIST',
				placeholder: 'Press Enter to list agent sessions.'
			};
		case '/gate': {
			const intent = (args[0] ?? gateIntentForStage(status.stage)).toUpperCase();
			return {
				title: `${formatDockStageLabel(status.stage ?? selectedStageId)} > ${intent}`,
				placeholder: 'Press Enter to evaluate the current gate.'
			};
		}
		case '/transition':
			return {
				title: `${formatDockStageLabel(status.stage ?? selectedStageId)} > APPROVE`,
				placeholder: 'Enter the next stage or press Enter to approve the selected stage.'
			};
		case '/cancel':
			return {
				title: 'AGENT > CANCEL',
				placeholder: 'Enter a session id or use the selected session.'
			};
		case '/terminate':
			return {
				title: 'AGENT > TERMINATE',
				placeholder: 'Enter a session id or use the selected session.'
			};
		case '/deliver':
			return {
				title: 'MISSION > DELIVER',
				placeholder: 'Press Enter to deliver the mission.'
			};
		case '/clear':
			return {
				title: 'ACTIVITY > CLEAR',
				placeholder: 'Press Enter to clear the activity log.'
			};
		case '/quit':
			return {
				title: 'TOWER > EXIT',
				placeholder: 'Press Enter to close the tower.'
			};
		default:
			return {
				title: 'COMMAND > RUN',
				placeholder: 'Press Enter to run the current command.'
			};
	}
}

function commandScopeLabel(status: OperatorStatus): 'SETUP' | 'REPOSITORY' | 'MISSION' {
	if (status.found) {
		return 'MISSION';
	}
	return status.operationalMode === 'setup' ? 'SETUP' : 'REPOSITORY';
}

function formatDockStageLabel(stage: MissionStageId | undefined): string {
	return (stage ?? 'stage').toUpperCase();
}

function dockTargetLabel(kind: TreeTargetKind | undefined): string {
	if (!kind) {
		return 'TARGET';
	}
	if (kind === 'stage' || kind === 'stage-artifact') {
		return 'STAGE';
	}
	if (kind === 'task' || kind === 'task-artifact') {
		return 'TASK';
	}
	if (kind === 'session') {
		return 'SESSION';
	}
	return 'TARGET';
}

function buildHeaderStatusLines(
	status: OperatorStatus,
	workspaceRoot: string,
	selectedTab: HeaderTab | undefined,
	missionCandidates: MissionSelectionCandidate[] = []
): Array<{ segments: Array<{ text: string; fg: string }> }> {
	const workspaceBaseName = path.basename(workspaceRoot.trim());
	const repository = resolvedControlGitHubRepository(status.control)
		?? (workspaceBaseName.length > 0 ? workspaceBaseName : 'workspace');
	const normalizedWorkspaceRoot = workspaceRoot.trim() || 'workspace';
	const repositoryLine = {
		segments: [
			{ text: ` ${repository}`, fg: towerTheme.accent },
			{ text: ' | ', fg: towerTheme.metaText },
			{ text: normalizedWorkspaceRoot, fg: towerTheme.metaText }
		]
	};
	const missionSummary = resolveHeaderMissionSummary(status, selectedTab, missionCandidates);
	if (missionSummary) {
		return [
			{
				segments: [
					{ text: ` ${missionSummary.typeLabel} ${missionSummary.numberLabel}`, fg: towerTheme.accent },
					{ text: ' | ', fg: towerTheme.metaText },
					{ text: missionSummary.title, fg: towerTheme.primaryText }
				]
			},
			repositoryLine
		];
	}
	return [repositoryLine];
}

function resolveHeaderMissionSummary(
	status: OperatorStatus,
	selectedTab: HeaderTab | undefined,
	missionCandidates: MissionSelectionCandidate[] = []
): HeaderMissionSummary | undefined {
	if (selectedTab?.target.kind === 'repository') {
		return undefined;
	}
	const selectedMissionId = selectedTab?.target.kind === 'mission'
		? selectedTab.target.missionId
		: status.missionId;
	if (!selectedMissionId) {
		return undefined;
	}
	const missionCandidate = missionCandidates
		.find((candidate) => candidate.missionId === selectedMissionId);
	return buildHeaderMissionSummary(
		selectedMissionId,
		missionCandidate?.issueId,
		missionCandidate?.title
	);
}

function buildHeaderMissionSummary(
	missionId: string,
	issueId?: number,
	title?: string
): HeaderMissionSummary {
	const normalizedTitle = normalizeHeaderMissionTitle(title, missionId);
	if (issueId !== undefined) {
		return {
			typeLabel: 'ISSUE',
			numberLabel: String(issueId),
			title: normalizedTitle
		};
	}
	return {
		typeLabel: 'MISSION',
		numberLabel: extractHeaderMissionNumber(missionId),
		title: normalizedTitle
	};
}

function normalizeHeaderMissionTitle(title: string | undefined, missionId: string): string {
	const normalizedTitle = title?.replace(/\s+/gu, ' ').trim();
	return normalizedTitle && normalizedTitle.length > 0 ? normalizedTitle : missionId;
}

function extractHeaderMissionNumber(missionId: string): string {
	const leadingNumber = missionId.match(/^([0-9]+)/u)?.[1];
	if (leadingNumber) {
		return leadingNumber;
	}
	const branchNumber = missionId.match(/(?:^|\/)([0-9]+)(?:-|$)/u)?.[1];
	if (branchNumber) {
		return branchNumber;
	}
	return missionId;
}

function resolvedControlGitHubRepository(control: OperatorStatus['control']): string | undefined {
	if (!control || !("githubRepository" in control)) {
		return undefined;
	}
	const repository = control['githubRepository'];
	return typeof repository === 'string' && repository.trim().length > 0 ? repository : undefined;
}

function resolveHeaderWorkspaceLabel(control: OperatorStatus['control'], workspaceRoot: string): string {
	const githubRepository = resolvedControlGitHubRepository(control);
	if (githubRepository) {
		return githubRepository;
	}
	const normalizedRoot = workspaceRoot.trim();
	return normalizedRoot.length > 0 ? normalizedRoot : 'workspace';
}

function buildHeaderFooterBadges(input: {
	mode: TowerMode;
	status: OperatorStatus;
	daemonState: DaemonState;
	fallbackGitHubUser: string | undefined;
}): Array<{ text: string; tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'; framed?: boolean }> {
	const control = input.status.control;
	return [
		...buildControlHeaderGitHubBadges(control, input.fallbackGitHubUser),
		{ text: '●', tone: daemonStateTone(input.daemonState), framed: false }
	];
}

function daemonStateTone(state: DaemonState): 'accent' | 'success' | 'warning' | 'danger' {
	if (state === 'connected') {
		return 'success';
	}
	if (state === 'booting') {
		return 'warning';
	}
	return 'danger';
}

function buildControlHeaderGitHubBadges(
	control: OperatorStatus['control'],
	fallbackGitHubUser?: string
): Array<{ text: string; tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'; framed?: boolean }> {
	const githubUser = resolveHeaderGitHubUser(control, fallbackGitHubUser);
	if (githubUser && githubUser.length > 0) {
		return [{ text: githubUser, tone: 'success' }];
	}
	if (control?.githubAuthenticated === true) {
		return [{ text: 'github', tone: 'success' }];
	}
	return [{ text: 'github', tone: 'danger' }];
}

function resolveHeaderGitHubUser(
	control: OperatorStatus['control'],
	fallbackGitHubUser?: string
): string | undefined {
	if (control?.githubAuthenticated === false) {
		return undefined;
	}
	const githubUser =
		control?.githubUser?.trim()
			|| parseGitHubUserFromAuthDetail(control?.githubAuthMessage)?.trim()
			|| fallbackGitHubUser?.trim();
	return githubUser && githubUser.length > 0 ? githubUser : undefined;
}

function parseGitHubUserFromAuthDetail(detail: string | undefined): string | undefined {
	const normalized = detail?.replace(/\u001b\[[0-9;]*m/gu, '').trim();
	if (!normalized) {
		return undefined;
	}
	const patterns = [
		/Logged in to [^\s]+ account\s+([A-Za-z0-9-]+)/iu,
		/Logged in to [^\s]+ as\s+([A-Za-z0-9-]+)/iu,
		/account\s+([A-Za-z0-9-]+)\s*\(/iu,
		/as\s+([A-Za-z0-9-]+)\s*\(/iu
	];
	for (const pattern of patterns) {
		const match = pattern.exec(normalized);
		const candidate = match?.[1]?.trim();
		if (candidate) {
			return candidate;
		}
	}
	return undefined;
}

function gateIntentForStage(stage: MissionStageId | undefined): GateIntent {
	if (stage === 'prd' || stage === 'spec') {
		return 'implement';
	}
	if (stage === 'implementation') {
		return 'verify';
	}
	if (stage === 'audit') {
		return 'audit';
	}
	return 'deliver';
}

function isMissionDelivered(status: OperatorStatus): boolean {
	return Boolean(status.stages?.some((stage) => stage.stage === 'delivery' && stage.status === 'done'));
}
