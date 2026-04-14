/** @jsxImportSource @opentui/solid */

import { spawn } from 'node:child_process';
import type {
	DaemonClient,
	ContextGraph,
	MissionResolvedSelection,
	MissionSystemSnapshot,
	OperatorActionDescriptor,
	OperatorActionTargetContext,
	MissionSelector,
	MissionStageId,
	MissionSelectionCandidate,
	TrackedIssueSummary,
	OperatorStatus,
	PaneBinding,
	MissionWorkspaceContext,
	SystemStatus
} from '@flying-pillow/mission-core';
import {
	DaemonApi,
	resolveMissionSelection,
} from '@flying-pillow/mission-core';
import { useKeyboard, useRenderer } from '@opentui/solid';
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSXElement } from 'solid-js';
import { IntroSplash } from './tower/components/IntroSplash.js';
import { applyTowerTheme, towerTheme, type TowerThemeName, isTowerThemeName } from './tower/components/towerTheme.js';
import type { FocusArea } from './tower/components/types.js';
import {
	describeCommandFlowCompletionMessage,
	describeExecutedActionMessage,
	findAvailableCommandByText,
} from './tower/components/command/commandDomain.js';
import { useCommandController } from './tower/components/command/commandController.js';
import {
	buildHeaderFooterBadges,
	buildHeaderStatusLines,
	buildHeaderTabs,
	repositoryTabId,
	resolveHeaderWorkspaceLabel,
	type ProgressRailItem,
	type HeaderTab,
} from './tower/components/header/headerDomain.js';
import { useHeaderController } from './tower/components/header/headerController.js';
import {
	buildProjectedMissionCandidates,
	type TreeTargetKind
} from './tower/components/mission-control/missionControlDomain.js';
import { useMissionControlController } from './tower/components/mission-control/missionControlController.js';
import { MissionControlPanel } from './tower/components/mission-control/MissionControlPanel.js';
import { resolvePanelBindingsFromSelection } from './tower/components/mission-control/panelBindings.js';
import { MissionFlowOverlay, RepositoryFlowSurface } from './tower/components/flow/FlowPanel.js';
import { createFlowController } from './tower/components/flow/flowController.js';
import { RepositoryPanel } from './tower/components/repository/RepositoryPanel.js';
import {
	buildCommandFlowDefinition,
	buildFlowExecutionSteps,
	type CommandFlowDefinition,
	type CommandFlowResult,
} from './tower/components/flow/flowDomain.js';
import { TowerPanel } from './tower/components/tower/TowerPanel.js';
import { createAirportController } from './airportController.js';
import {
	asMissionStatusNotification,
	buildFocusOrder,
	buildKeyHintsText,
	createInitialStatusMessage,
	resolveMissionOperatorView,
	toErrorMessage,
} from './airportDomain.js';
import type { TowerConnectRequest } from './tower/bootstrapTowerPane.js';

export type AirportConnection = {
	client: DaemonClient;
	snapshot: MissionSystemSnapshot;
	status: OperatorStatus;
	dispose: () => void;
};

export type AirportUiOptions = {
	workspaceContext: MissionWorkspaceContext;
	initialSelector: MissionSelector;
	initialTheme: TowerThemeName;
	initialShowIntroSplash?: boolean;
	initialConnection?: AirportConnection;
	initialConnectionError?: string;
	connect: (request?: TowerConnectRequest) => Promise<AirportConnection>;
};

type AirportAppProps = AirportUiOptions;
type TowerMode = 'repository' | 'mission';
type ShellOverlay =
	| { kind: 'none' }
	| { kind: 'mission-flow' };
type RepositorySelectionAction =
	| {
		kind: 'mission';
		missionId: string;
	  }
	| {
		kind: 'issue';
		issueNumber: number;
	  }
	| {
		kind: 'start';
		actionId: 'control.mission.start';
	  };
type TreeSelectionPaneBindings = NonNullable<ReturnType<typeof resolvePanelBindingsFromSelection>>;
const repositoryFocusOrder: FocusArea[] = ['header', 'flow', 'command'];
const missionFocusOrder: FocusArea[] = ['header', 'tree', 'command'];

export function AirportApp({
	workspaceContext,
	initialSelector,
	initialTheme,
	initialShowIntroSplash,
	initialConnection,
	initialConnectionError,
	connect
}: AirportAppProps) {
	const renderer = useRenderer();
	const [, setActivityLog] = createSignal<string[]>([
		createInitialStatusMessage(initialConnectionError)
	]);
	const [isRunningCommand, setIsRunningCommand] = createSignal<boolean>(false);
	const [focusArea, setFocusArea] = createSignal<FocusArea>('command');
	const [selectedRepositorySelectionItemId, setSelectedRepositorySelectionItemId] = createSignal<string | undefined>();
	const runtimeController = createAirportController({
		initialSelector,
		...(initialConnection ? { initialConnection } : {}),
		...(initialConnectionError ? { initialConnectionError } : {}),
		connect,
		onLog: appendLog,
	});
	const selector = runtimeController.selector;
	const status = runtimeController.status;
	const systemSnapshot = runtimeController.systemSnapshot;
	const daemonState = runtimeController.daemonState;
	const currentControlRoot = createMemo(() => status().control?.controlRoot?.trim() || workspaceContext.workspaceRoot);
	const [selectedThemeName, setSelectedThemeName] = createSignal<TowerThemeName>(initialTheme);
	let lastObservedSelectionKey: string | undefined;
	let inFlightSelectionSyncKey: string | undefined;
	let queuedSelectionBindings: TreeSelectionPaneBindings | undefined;
	let selectionSyncWorkerActive = false;
	const [systemStatus, setSystemStatus] = createSignal<SystemStatus | undefined>();
	const [fallbackControlBranch, setFallbackControlBranch] = createSignal<string | undefined>();
	const [isControlBranchProbeInFlight, setIsControlBranchProbeInFlight] = createSignal<boolean>(false);
	const [showIntroSplash, setShowIntroSplash] = createSignal<boolean>(initialShowIntroSplash ?? true);
	const [repositoryOpenIssues, setRepositoryOpenIssues] = createSignal<TrackedIssueSummary[]>([]);
	const flowController = createFlowController({
		onNotify: appendLog,
		onFlowClosed: () => {
			commandController.setInputValue('');
			setFocusArea('command');
		},
		onFlowRestarted: (definition) => {
			commandController.setInputValue('');
			const firstStep = definition.steps[0];
			setFocusArea(towerMode() === 'repository' || firstStep?.kind === 'selection' ? 'flow' : 'command');
		}
	});
	const client = runtimeController.client;
	const systemDomain = runtimeController.systemDomain;
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
	const headerController = useHeaderController({
		tabs: headerTabs,
		activeTabId: activeHeaderTabId,
		onActivateRepository: async (options) => {
			resetMissionContextSelection();
			if (currentMissionId()) {
				await connectClient({});
			}
			if (!options?.preserveFocus) {
				setFocusArea('flow');
			}
		},
		onActivateMission: async (missionId, options) => {
			const missionLoaded = resolveMissionOperatorView(systemSnapshot(), missionId) !== undefined;
			if (missionId !== currentMissionId() || !missionLoaded) {
				await connectClient({ missionId });
			}
			if (!options?.preserveFocus) {
				setFocusArea('command');
			}
		}
	});
	const selectedHeaderTab = headerController.selectedTab;
	const selectedShellTarget = createMemo<HeaderTab['target']>(() => {
		const selectedTarget = selectedHeaderTab()?.target;
		if (selectedTarget) {
			return selectedTarget;
		}
		return { kind: 'repository' };
	});
	const selectedShellTargetKey = createMemo(() => {
		const target = selectedShellTarget();
		return target.kind === 'mission' ? `mission:${target.missionId}` : 'repository';
	});
	const towerMode = createMemo<TowerMode>(() => {
		const target = selectedShellTarget();
		if (target.kind === 'mission') {
			return 'mission';
		}
		return 'repository';
	});
	const airportProjections = createMemo(() => systemSnapshot()?.airportProjections);
	const towerProjection = createMemo(() => airportProjections()?.tower);
	const selectedMissionId = createMemo(() => {
		const target = selectedShellTarget();
		return target.kind === 'mission' ? target.missionId : undefined;
	});
	const selectedMissionView = createMemo(() =>
		resolveMissionOperatorView(systemSnapshot(), selectedMissionId())
	);
	const selectedMissionContext = createMemo(() => {
		const target = selectedShellTarget();
		return target.kind === 'mission'
			? systemDomain()?.missions[target.missionId]
			: undefined;
	});
	const selectedMissionMatchesLoaded = createMemo(() => {
		const target = selectedShellTarget();
		return target.kind === 'mission'
			&& selectedMissionView() !== undefined;
	});
	const missionControlController = useMissionControlController({
		towerMode,
		currentMissionId,
		systemDomain,
		stageRail: createMemo(() => selectedMissionView()?.stageRail),
		treeNodes: createMemo(() => selectedMissionView()?.treeNodes),
	});
	const selectedTreeTarget = missionControlController.selectedTreeTarget;
	const selectedTreeContext = createMemo(() =>
		resolveTreeSelectionContext(selectedTreeTarget(), systemDomain())
	);
	const resolvedMissionSelection = createMemo<MissionResolvedSelection | undefined>(() => {
		if (towerMode() !== 'mission') {
			return undefined;
		}
		const missionId = selectedMissionId()?.trim();
		return resolveMissionSelection({
			target: selectedTreeTarget(),
			domain: systemDomain(),
			...(missionId ? { missionId } : {})
		});
	});
	const stageItems = createMemo<ProgressRailItem[]>(() =>
		(selectedMissionView()?.stageRail ?? []).map((item: { id: string; label: string; state: ProgressRailItem['state']; subtitle?: string }) => ({
			id: item.id,
			label: item.label,
			state: item.state,
			selected: item.id === selectedTreeContext()?.stageId,
			...(item.subtitle ? { subtitle: item.subtitle } : {})
		}))
	);
	const headerPanelTitle = createMemo(() => {
		const workspaceLabel = resolveHeaderWorkspaceLabel(status().control, currentControlRoot());
		if (status().operationalMode === 'setup') {
			return `SETUP ${workspaceLabel}`;
		}
		return workspaceLabel;
	});
	const headerTabsFocusable = headerController.tabsFocusable;
	const headerStatusLines = createMemo(() =>
		buildHeaderStatusLines(
			status(),
			currentControlRoot(),
			selectedHeaderTab(),
			projectedAvailableMissions()
		)
	);
	const currentMissionTitle = createMemo(() => {
		const missionId = selectedMissionId() ?? currentMissionId();
		if (!missionId) {
			return undefined;
		}
		return selectedMissionContext()?.briefSummary
			?? systemDomain()?.missions[missionId]?.briefSummary
			?? projectedAvailableMissions().find((candidate) => candidate.missionId === missionId)?.title
			?? missionId;
	});
	const headerFooterBadges = createMemo(() =>
		buildHeaderFooterBadges({
			status: status(),
			daemonState: daemonState(),
			systemStatus: systemStatus()
		})
	);
	const actionsInvalidationKey = createMemo(() =>
		JSON.stringify({
			systemVersion: systemSnapshot()?.state.version ?? null,
			workflowUpdatedAt: status().workflow?.updatedAt ?? null,
			workflowLifecycle: status().workflow?.lifecycle ?? null,
			missionId: status().missionId ?? null,
			controlAvailableMissionCount: status().control?.availableMissionCount ?? null,
			controlSettingsComplete: status().control?.settingsComplete ?? null,
			controlBranch: status().control?.currentBranch ?? null,
			found: status().found
		})
	);
	const commandFlowOwner = flowController.owner;
	const commandTargetContext = createMemo<OperatorActionTargetContext>(() => {
		if (towerMode() !== 'mission') {
			return {};
		}
		const treeContext = selectedTreeContext();
		const stageId = treeContext?.stageId;
		const taskId = treeContext?.taskId;
		const sessionId = treeContext?.sessionId;
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
		const treeContext = selectedTreeContext();
		const currentMissionLabel = currentMissionTitle();
		const missionLabel = treeContext?.targetLabel ?? currentMissionLabel;
		return {
			...(treeContext?.sessionId ? { sessionId: treeContext.sessionId } : {}),
			...(treeContext?.stageId ? { stageId: treeContext.stageId } : {}),
			...(missionLabel ? { targetLabel: missionLabel } : {}),
			...(treeContext?.targetKind ? { targetKind: treeContext.targetKind } : {})
		};
	});
	const commandController = useCommandController({
		client,
		actionsInvalidationKey,
		towerMode,
		currentMissionId,
		selectedMissionMatchesLoaded,
		commandTargetContext,
		status,
		canSendSessionText: missionControlController.canSendSessionText,
		selectedCommandTargetDescriptor,
		focusArea,
		onFocusAreaChange: setFocusArea,
		flowController,
		isRunningCommand,
		buildCommandFlowFromCommand: (command) =>
			buildCommandFlowFromCommand(command, resolveCommandExecutionSelector(command)),
		onInvokeAction: (actionId, commandTextOverride) => {
			setIsRunningCommand(true);
			const descriptor = commandController.availableCommandById().get(actionId);
			const execution = descriptor
				? executeAvailableActionById(actionId)
				: executeOperatorInput(commandTextOverride ?? actionId.replace(/^custom:/u, ''));
			void execution
				.catch((error) => {
					appendLog(toErrorMessage(error));
				})
				.finally(() => {
					setIsRunningCommand(false);
				});
		},
		onExecuteOperatorInput: (commandText) => executeOperatorInput(commandText),
		onSubmitFlowTextStep: (value) => submitCommandFlowTextStep(value),
		onNoCommandsAvailable: () => {
			appendLog('No commands are available for the current selection.');
		},
		onNotify: appendLog,
		onExecuteToolbarAction: async (actionId) => {
			setIsRunningCommand(true);
			try {
				await executeAvailableActionById(actionId);
			} catch (error) {
				appendLog(toErrorMessage(error));
			} finally {
				setIsRunningCommand(false);
			}
		},
	});
	const commandQuery = commandController.commandInputQuery;
	const currentCommandFlowStep = flowController.currentStep;
	const showCommandFlowOverlay = flowController.isMissionSelectionOverlay;
	const isMissionFlowTextStep = flowController.isMissionTextStep;
	const shellOverlay = createMemo<ShellOverlay>(() => {
		if (commandFlowOwner() === 'mission' && currentCommandFlowStep()) {
			return { kind: 'mission-flow' };
		}
		return { kind: 'none' };
	});
	const repositorySelectionItems = createMemo(() => {
		const items: Array<{ id: string; label: string; description: string }> = [];
		const selectCommand = commandController.availableCommandById().get('control.mission.select');
		const selectStep = selectCommand?.flow?.steps[0];
		items.push({
			id: 'section:missions',
			label: 'Your missions:',
			description: ''
		});
		if (selectStep?.kind === 'selection') {
			for (const option of selectStep.options) {
				items.push({
					id: `mission:${option.id}`,
					label: option.label,
					description: option.description
				});
			}
		}
		items.push({
			id: 'separator:between-missions-and-issues',
			label: '',
			description: ''
		});
		items.push({
			id: 'section:issues',
			label: 'New issues:',
			description: ''
		});
		const activeIssueIds = new Set<number>(
			projectedAvailableMissions()
				.map((mission) => mission.issueId)
				.filter((issueId): issueId is number => typeof issueId === 'number')
		);
		for (const issue of repositoryOpenIssues()) {
			if (activeIssueIds.has(issue.number)) {
				continue;
			}
			items.push({
				id: `issue:${String(issue.number)}`,
				label: `#${String(issue.number)} ${issue.title}`,
				description: issue.labels.length > 0 ? issue.labels.join(', ') : issue.url
			});
		}
		items.push({
			id: 'separator:between-issues-and-start',
			label: '',
			description: ''
		});
		items.push({
			id: 'section:start',
			label: 'Start:',
			description: ''
		});
		items.push({
			id: 'start:new',
			label: 'Start a new mission',
			description: 'Open the mission-start flow.'
		});
		return items;
	});
	const repositorySelectionActionsByItemId = createMemo(() => {
		const actions = new Map<string, RepositorySelectionAction>();
		const selectCommand = commandController.availableCommandById().get('control.mission.select');
		const selectStep = selectCommand?.flow?.steps[0];
		if (selectStep?.kind === 'selection') {
			for (const option of selectStep.options) {
				actions.set(`mission:${option.id}`, {
					kind: 'mission',
					missionId: option.id
				});
			}
		}
		const activeIssueIds = new Set<number>(
			projectedAvailableMissions()
				.map((mission) => mission.issueId)
				.filter((issueId): issueId is number => typeof issueId === 'number')
		);
		for (const issue of repositoryOpenIssues()) {
			if (activeIssueIds.has(issue.number)) {
				continue;
			}
			actions.set(`issue:${String(issue.number)}`, {
				kind: 'issue',
				issueNumber: issue.number
			});
		}
		actions.set('start:new', {
			kind: 'start',
			actionId: 'control.mission.start'
		});
		return actions;
	});
	createEffect(() => {
		setSelectedRepositorySelectionItemId((current) => {
			const items = repositorySelectionItems();
			if (items.length === 0) {
				return undefined;
			}
			if (current && items.some((item) => item.id === current) && !isRepositorySelectionNonSelectableId(current)) {
				return current;
			}
			return items.find((item) => !isRepositorySelectionNonSelectableId(item.id))?.id;
		});
	});
	const focusOrder = createMemo<FocusArea[]>(() =>
		buildFocusOrder({
			baseOrder: towerMode() === 'mission'
				? missionFocusOrder
				: repositoryFocusOrder,
			headerTabsFocusable: headerTabsFocusable(),
			showCommandFlow: showCommandFlowOverlay(),
			showCommandPicker: commandController.showCommandPicker(),
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
		const enabledCommands = commandController.availableActions()
			.filter((command) => command.enabled)
			.map((command) => command.action);
		const uniqueCommands = [...new Set(enabledCommands)];
		if (uniqueCommands.length === 0) {
			return 'No commands available for the current selection.';
		}
		return `Available: ${uniqueCommands.join(', ')}`;
	});
	const screenTitle = createMemo(() => {
		if (towerMode() !== 'mission') {
			return towerProjection()?.repositoryLabel || resolveHeaderWorkspaceLabel(status().control, currentControlRoot());
		}
		return currentMissionTitle()
			|| (selectedMissionMatchesLoaded() ? currentMissionId() ?? 'Mission' : 'Mission');
	});
	const keyHintsText = createMemo(() =>
		buildKeyHintsText({
			focusArea: focusArea(),
			activePicker: commandController.activePicker(),
			currentFlowStep: currentCommandFlowStep(),
			towerMode: towerMode(),
			commandPanelMode: commandController.commandPanelMode(),
			confirmingToolbarCommand: Boolean(commandController.confirmingToolbarCommandId())
		})
	);
	const missionLifecycleState = createMemo(() => {
		if (towerMode() !== 'mission') {
			return undefined;
		}
		return selectedMissionContext()?.lifecycleState
			?? status().workflow?.lifecycle;
	});

	createEffect(() => {
		selectedShellTargetKey();
		inFlightSelectionSyncKey = undefined;
		queuedSelectionBindings = undefined;
		selectionSyncWorkerActive = false;
	});

	createEffect(() => {
		if (towerMode() !== 'mission') {
			return;
		}
		const bindings = resolvePanelBindingsFromSelection(resolvedMissionSelection(), selectedMissionId());
		if (!bindings) {
			return;
		}
		const airportPanes = systemSnapshot()?.state.airport.panes;
		const updates = computeSelectionBindingUpdates(bindings, airportPanes);
		if (updates.length === 0) {
			return;
		}
		queuedSelectionBindings = bindings;
		if (selectionSyncWorkerActive) {
			return;
		}
		const currentClient = client();
		if (!currentClient) {
			return;
		}
		selectionSyncWorkerActive = true;
		void flushQueuedTreeSelectionBindings();
	});

	async function flushQueuedTreeSelectionBindings(): Promise<void> {
		try {
			while (queuedSelectionBindings) {
				const targetBindings = queuedSelectionBindings;
				queuedSelectionBindings = undefined;

				const currentClient = client();
				if (!currentClient) {
					queuedSelectionBindings = targetBindings;
					return;
				}

				const airportPanes = systemSnapshot()?.state.airport.panes;
				const updates = computeSelectionBindingUpdates(targetBindings, airportPanes);
				if (updates.length === 0) {
					continue;
				}

				const selectionSyncKey = JSON.stringify(targetBindings);
				inFlightSelectionSyncKey = selectionSyncKey;
				const api = new DaemonApi(currentClient);
				for (const [paneId, binding] of updates) {
					await api.airport.bindPane({
						paneId,
						binding
					});
				}
				if (inFlightSelectionSyncKey === selectionSyncKey) {
					inFlightSelectionSyncKey = undefined;
				}
			}
		} catch (error) {
			appendLog(`Failed to sync pane bindings: ${toErrorMessage(error)}`);
		} finally {
			selectionSyncWorkerActive = false;
			if (queuedSelectionBindings && client()) {
				selectionSyncWorkerActive = true;
				void flushQueuedTreeSelectionBindings();
			}
		}
	}

	function renderMissionControlPanel(): JSXElement | undefined {
		if (towerMode() !== 'mission') {
			return undefined;
		}
		return (
			<MissionControlPanel
				focused={focusArea() === 'tree'}
				rows={missionControlController.visibleTreeTargets()}
				selectedRowId={missionControlController.selectedTreeTarget()?.id}
				{...(missionLifecycleState() ? { missionLifecycleState: missionLifecycleState() } : {})}
				treePageScrollRequest={missionControlController.treePageScrollRequest()}
				emptyLabel={towerProjection()?.emptyLabel ?? 'No mission structure is available yet.'}
				onMoveSelection={(delta) => {
					missionControlController.moveSelection(delta);
				}}
				onPageScroll={(delta) => {
					missionControlController.requestPageScroll(delta);
				}}
				onActivateSelection={() => {
					missionControlController.activateSelectedTarget();
				}}
			/>
		);
	}
	const repositoryFlowPanel = createMemo<JSXElement>(() => {
		const exactCommand = findAvailableCommandByText(commandController.availableActions(), commandController.inputValue().trim());
		return (
			<RepositoryFlowSurface
				controller={flowController}
				focused={focusArea() === 'flow'}
				onCancel={() => {
					commandController.resetCommandFlow();
					setFocusArea('command');
				}}
				{...(exactCommand?.flow && exactCommand.flow.steps.length > 0
					? {
						preview: {
							title: `${exactCommand.flow.targetLabel} > ${exactCommand.flow.actionLabel}`,
							text: exactCommand.flow.steps[0]?.helperText ?? 'Press Enter in the command dock to start this flow.'
						}
					}
					: towerProjection()
						? {
							preview: {
								title: towerProjection()?.title ?? 'TOWER',
								text: towerProjection()?.emptyLabel ?? 'Repository mode is ready.'
							}
						}
						: {})}
			/>
		);
	});
	const repositorySelectionPanel = createMemo<JSXElement>(() => (
		<RepositoryPanel
			items={repositorySelectionItems()}
			selectedItemId={selectedRepositorySelectionItemId()}
			focused={focusArea() === 'flow'}
			onMoveSelection={(delta) => {
				moveRepositorySelection(delta);
			}}
			onActivateSelection={(itemId) => {
				void activateRepositorySelection(itemId);
			}}
			onItemChange={(itemId) => {
				if (isRepositorySelectionNonSelectableId(itemId)) {
					return;
				}
				setSelectedRepositorySelectionItemId(itemId);
			}}
			onFocusCommand={() => {
				setFocusArea('command');
			}}
		/>
	));
	const centerContent = createMemo<JSXElement>(() => {
		switch (towerMode()) {
			case 'mission':
				return renderMissionControlPanel() ?? <box />;
			case 'repository':
			default:
				return currentCommandFlowStep() ? repositoryFlowPanel() : repositorySelectionPanel();
		}
	});
	const overlayContent = createMemo<JSXElement | undefined>(() => {
		if (shellOverlay().kind === 'mission-flow') {
			return (
				<MissionFlowOverlay
					controller={flowController}
					flowFocused={focusArea() === 'flow'}
					commandFocused={focusArea() === 'command'}
					onCancel={() => {
						commandController.resetCommandFlow();
						setFocusArea('command');
					}}
				/>
			);
		}
		return undefined;
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
		if (!currentClient || status().control?.trackingProvider !== 'github') {
			setSystemStatus(undefined);
			return;
		}
		let disposed = false;
		void new DaemonApi(currentClient).system.getStatus()
			.then((nextStatus: SystemStatus) => {
				if (!disposed) {
					setSystemStatus(nextStatus);
				}
			})
			.catch((error: unknown) => {
				if (!disposed) {
					setSystemStatus(undefined);
					appendLog(`Failed to load system status: ${toErrorMessage(error)}`);
				}
			});
		onCleanup(() => {
			disposed = true;
		});
	});

	createEffect(() => {
		const currentClient = client();
		status().control?.availableMissionCount;
		status().control?.currentBranch;
		if (!currentClient) {
			setRepositoryOpenIssues([]);
			return;
		}
		let disposed = false;
		void new DaemonApi(currentClient).control.listOpenIssues(100)
			.then((issues) => {
				if (!disposed) {
					setRepositoryOpenIssues(issues);
				}
			})
			.catch((error: unknown) => {
				if (!disposed) {
					setRepositoryOpenIssues([]);
					appendLog(`Failed to load open issues: ${toErrorMessage(error)}`);
				}
			});
		onCleanup(() => {
			disposed = true;
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
		const subscription = currentClient.onDidEvent((event: any) => {
			if (event.type === 'airport.state') {
				runtimeController.handleAirportState(event.snapshot);
				return;
			}
			if (event.type === 'mission.actions.changed') {
				if (event.missionId === currentMissionId()) {
					commandController.refreshAvailableActions();
				}
				return;
			}
			if ('missionId' in event && event.missionId !== currentMissionId()) {
				return;
			}
			const missionStatusEvent = asMissionStatusNotification(event);
			if (missionStatusEvent) {
				runtimeController.handleMissionStatus(missionStatusEvent.status);
				return;
			}
			if (event.type === 'session.console') {
				const sessionId = event.event.state.sessionId;
				if (event.event.state.awaitingInput && sessionId) {
					missionControlController.selectSessionNode(sessionId);
					setFocusArea('command');
				}
				return;
			}
			if (event.type === 'session.event') {
				if (event.event.type === 'session-started') {
					const sessionId = event.event.state.sessionId;
					if (sessionId) {
						missionControlController.selectSessionNode(sessionId);
					}
				}
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
		const configuredTheme = status().control?.settings?.towerTheme;
		const nextTheme: TowerThemeName = isTowerThemeName(configuredTheme ?? '')
			? configuredTheme as TowerThemeName
			: initialTheme;
		if (selectedThemeName() === nextTheme) {
			return;
		}
		applyTowerTheme(nextTheme);
		setSelectedThemeName(nextTheme);
	});

	createEffect(() => {
		selectedThemeName();
		renderer.setBackgroundColor(towerTheme.background);
	});

	onCleanup(() => {
		runtimeController.dispose();
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
			focusArea() !== 'command' &&
			focusArea() !== 'flow' &&
			key.sequence === '/' &&
			(commandController.activePicker() !== 'command-select' || commandQuery() === '/')
		) {
			commandController.openCommandPickerShortcut();
			return;
		}
		if ((key.name === 'q' || key.sequence === 'q') && focusArea() !== 'command' && !commandController.activePicker()) {
			renderer.destroy();
			return;
		}
	});

	function moveFocus(delta: number): void {
		const order = focusOrder();
		const currentIndex = order.indexOf(focusArea());
		const nextIndex = (currentIndex + delta + order.length) % order.length;
		setFocusArea(order[nextIndex] ?? 'command');
	}

	function previewHeaderTabSelection(delta: number): void {
		headerController.previewSelection(delta);
	}

	function resetMissionContextSelection(): void {
		missionControlController.reset();
		commandController.resetCommandFlow({ clearCommandInput: true });
		commandController.closeCommandPicker({ clearCommandInput: true });
		commandController.setSelectedCommandId(undefined);
	}

	function moveRepositorySelection(delta: number): void {
		const items = repositorySelectionItems();
		const selectableItems = items.filter((item) => !isRepositorySelectionNonSelectableId(item.id));
		if (selectableItems.length === 0) {
			setSelectedRepositorySelectionItemId(undefined);
			return;
		}
		const current = selectedRepositorySelectionItemId();
		const currentIndex = Math.max(0, selectableItems.findIndex((item) => item.id === current));
		const nextIndex = (currentIndex + delta + selectableItems.length) % selectableItems.length;
		setSelectedRepositorySelectionItemId(selectableItems[nextIndex]?.id);
	}

	async function activateRepositorySelection(itemId: string | undefined): Promise<void> {
		if (!itemId) {
			return;
		}
		if (isRepositorySelectionNonSelectableId(itemId)) {
			return;
		}
		const action = repositorySelectionActionsByItemId().get(itemId);
		if (!action) {
			return;
		}
		if (action.kind === 'mission') {
			setFocusArea('header');
			await headerController.activateTab(`mission:${action.missionId}`, { preserveFocus: true });
			return;
		}
		if (action.kind === 'issue') {
			setIsRunningCommand(true);
			try {
				const currentClient = client() ?? (await connectClient({}));
				if (!currentClient) {
					appendLog('Unable to connect to Mission daemon.');
					return;
				}
				const nextStatus = await new DaemonApi(currentClient).mission.fromIssue(action.issueNumber);
				await activateLoadedMissionShell(nextStatus, {});
				commandController.refreshAvailableActions();
				appendLog(`Prepared mission from issue #${String(action.issueNumber)}.`);
			} catch (error) {
				appendLog(toErrorMessage(error));
			} finally {
				setIsRunningCommand(false);
			}
			return;
		}
		const command = commandController.availableCommandById().get(action.actionId);
		if (!command?.flow || !command.enabled) {
			appendLog(command?.reason ?? 'Mission start is not available right now.');
			return;
		}
		const definition = buildCommandFlowFromCommand(command, resolveCommandExecutionSelector(command));
		if (!definition) {
			appendLog('Mission start flow is not available right now.');
			return;
		}
		commandController.startCommandFlow(definition);
	}

	function appendLog(message: string): void {
		const timestamp = new Date().toISOString().slice(11, 19);
		setActivityLog((current) => [...current, `[${timestamp}] ${message}`].slice(-240));
	}


	async function submitCommandFlowTextStep(rawValue: string): Promise<void> {
		flowController.setTextValue(rawValue);
		await flowController.commitCurrentStep();
	}

	function buildCommandFlowFromCommand(
		command: OperatorActionDescriptor | undefined,
		executeSelector: MissionSelector,
		onCompleteLog?: (result: Awaited<ReturnType<typeof executeDaemonActionById>>, flowResult: CommandFlowResult) => string | undefined
	): CommandFlowDefinition | undefined {
		return buildCommandFlowDefinition({
			command,
			executeSelector,
			executeAction: async ({ actionId, steps, selector }) =>
				executeDaemonActionById(actionId, steps, selector),
			loadControlFlowDescriptor: ({ actionId, steps, selector }) =>
				runtimeController.loadControlFlowDescriptor(actionId, steps, selector),
			onComplete: ({ command: completedCommand, executionResult, flowResult }) => {
				if (completedCommand.id === 'control.mission.start' || completedCommand.id === 'control.mission.select') {
					void activateLoadedMissionShell(executionResult.status, executeSelector);
				}
				commandController.refreshAvailableActions();
				const message = onCompleteLog?.(executionResult, flowResult);
				if (message) {
					appendLog(message);
				}
			},
		});
	}

	async function activateLoadedMissionShell(nextStatus: OperatorStatus, nextSelector: MissionSelector = selector()): Promise<void> {
		const missionId = nextStatus.missionId ?? nextSelector.missionId;
		if (!missionId) {
			return;
		}
		await headerController.activateTab(`mission:${missionId}`);
	}

	async function connectClient(nextSelector: MissionSelector = selector(), surfacePath?: string): Promise<DaemonClient | undefined> {
		return runtimeController.connectClient(nextSelector, surfacePath);
	}

	async function executeDaemonActionById(
		actionId: string,
		steps: ReturnType<typeof buildFlowExecutionSteps>,
		nextSelector: MissionSelector = currentMissionSelector() ?? {}
	) {
		return runtimeController.executeActionById(actionId, steps, nextSelector);
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
		const session = missionControlController.promptableSessionRecord();
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

	async function executeAvailableActionByCommandText(commandText: string): Promise<boolean> {
		const actionDescriptor = findAvailableCommandByText(commandController.availableActions(), commandText);
		if (!actionDescriptor) {
			return false;
		}
		return executeAvailableActionById(actionDescriptor.id);
	}

	async function executeAvailableActionById(actionId: string): Promise<boolean> {
		const actionDescriptor = commandController.availableCommandById().get(actionId);
		if (!actionDescriptor) {
			return false;
		}

		if (!actionDescriptor.enabled) {
			appendLog(actionDescriptor.reason ?? `Action ${actionDescriptor.action} is not available for the selected target.`);
			return true;
		}

		if (!actionDescriptor.id.startsWith('control.') && !currentMissionSelector()) {
			appendLog(noMissionSelectedMessage(status()));
			return true;
		}

		const flowSteps = actionDescriptor.flow?.steps ?? [];
		if (flowSteps.length > 0) {
			const definition = buildCommandFlowFromCommand(
				actionDescriptor,
				resolveCommandExecutionSelector(actionDescriptor),
				(result) => describeCommandFlowCompletionMessage(actionDescriptor, result.status)
			);
			if (!definition) {
				appendLog(`Mission action ${actionDescriptor.action} is not available right now.`);
				return true;
			}
			commandController.startCommandFlow(definition);
			return true;
		}

		const result = await executeDaemonActionById(
			actionDescriptor.id,
			[],
			resolveCommandExecutionSelector(actionDescriptor)
		);

		commandController.refreshAvailableActions();
		appendLog(describeExecutedActionMessage(actionDescriptor, result.status));
		return true;
	}

	async function executeOperatorInput(rawCommand: string): Promise<void> {
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

			switch (trimmed.toLowerCase()) {
				case '/quit':
					renderer.destroy();
					return;
				default:
					if (await executeAvailableActionByCommandText(trimmed)) {
						return;
					}
					appendLog(`Unknown command '${trimmed}'.`);
					return;
			}
		} catch (error) {
			appendLog(toErrorMessage(error));
		} finally {
			setIsRunningCommand(false);
		}
	}

	return (
		<Show when={selectedThemeName()} keyed>
			<Show when={!showIntroSplash()} fallback={<IntroSplash onComplete={() => setShowIntroSplash(false)} />}>
				<TowerPanel
					headerPanelTitle={headerPanelTitle()}
					showHeader={true}
					title={screenTitle()}
					headerTabs={headerTabs().map((tab) => ({ id: tab.id, label: tab.label }))}
					headerSelectedTabId={headerController.currentTabId()}
					headerTabsFocusable={headerTabsFocusable()}
					headerStatusLines={headerStatusLines()}
					headerFooterBadges={headerFooterBadges()}
					stageItems={stageItems()}
					focusArea={focusArea()}
					onHeaderMoveSelection={(delta) => {
						previewHeaderTabSelection(delta);
					}}
					onHeaderMoveFocus={(delta) => {
						moveFocus(delta);
					}}
					onHeaderSelect={() => {
						void headerController.activateSelected();
					}}
					centerContent={centerContent()}
					overlayContent={overlayContent()}
					showCommandPanel={true}
					commandPanelTitle={commandController.commandPanelDescriptor().title}
					commandPanelPlaceholder={commandController.commandPanelDescriptor().placeholder}
					{...(commandController.commandPanelPrefix() ? { commandPanelPrefix: commandController.commandPanelPrefix() } : {})}
					showCommandPicker={commandController.showCommandPicker()}
					commandPickerItems={commandController.commandPickerItems()}
					selectedCommandPickerItemId={commandController.selectedCommandPickerItemId()}
					isRunningCommand={commandController.isCommandInteractionRunning()}
					inputValue={commandController.commandPanelInputValue()}
					commandHelp={commandHelp()}
					keyHintsText={keyHintsText()}
					onInputChange={(value) => {
						commandController.handlePanelInputChange(value);
					}}
					onInputSubmit={(submittedValue?: string) => {
						commandController.handlePanelInputSubmit(submittedValue);
					}}
					onInputKeyDown={(event) => {
						commandController.handlePanelKeyDown(event);
					}}
					onCommandPickerHighlight={(itemId) => {
						commandController.highlightCommandPickerItem(itemId);
					}}
					onCommandPickerSelect={(itemId) => {
						commandController.selectCommandById(itemId, { fromPicker: true });
					}}
					onCommandPickerKeyDown={(event) => {
						commandController.handleCommandPickerKeyDown(event);
					}}
				/>
			</Show>
		</Show>
	);

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

function resolveTreeSelectionContext(
	target: {
		kind: TreeTargetKind;
		label: string;
		stageId?: string;
		taskId?: string;
		sessionId?: string;
	} | undefined,
	domain: ContextGraph | undefined
): {
	stageId?: MissionStageId;
	taskId?: string;
	sessionId?: string;
	targetLabel?: string;
	targetKind?: TreeTargetKind;
} | undefined {
	if (!target) {
		return undefined;
	}

	const base = {
		targetLabel: target.label,
		targetKind: target.kind
	};

	if (target.kind === 'session' && target.sessionId) {
		const taskId = domain?.agentSessions[target.sessionId]?.taskId;
		const stageId = taskId ? domain?.tasks[taskId]?.stageId : undefined;
		return {
			...base,
			sessionId: target.sessionId,
			...(taskId ? { taskId } : {}),
			...(stageId ? { stageId } : {})
		};
	}

	return {
		...base,
		...(target.taskId ? { taskId: target.taskId } : {}),
		...(target.stageId ? { stageId: target.stageId as MissionStageId } : {})
	};
}

function computeSelectionBindingUpdates(
	desiredBindings: TreeSelectionPaneBindings,
	currentPanes: MissionSystemSnapshot['state']['airport']['panes'] | undefined
): Array<['briefingRoom' | 'runway', PaneBinding]> {
	const updates: Array<['briefingRoom' | 'runway', PaneBinding]> = [];
	for (const paneId of ['briefingRoom', 'runway'] as const) {
		const desiredBinding = desiredBindings[paneId];
		if (!desiredBinding) {
			continue;
		}
		const currentBinding = currentPanes?.[paneId];
		if (JSON.stringify(desiredBinding) === JSON.stringify(currentBinding)) {
			continue;
		}
		updates.push([paneId, desiredBinding as PaneBinding]);
	}
	return updates;
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

function noMissionSelectedMessage(status: OperatorStatus): string {
	if (status.operationalMode === 'setup') {
		return 'Mission setup is incomplete. Run /setup first.';
	}
	return 'No mission is selected. Use /start to create one or /select to open an existing mission.';
}

function isRepositorySelectionNonSelectableId(itemId: string): boolean {
	return itemId.startsWith('separator:') || itemId.startsWith('section:');
}
