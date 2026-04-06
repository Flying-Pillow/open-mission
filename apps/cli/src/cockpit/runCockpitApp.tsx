/** @jsxImportSource @opentui/solid */

import { createCliRenderer } from '@opentui/core';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
	DaemonClient,
	GateIntent,
	MissionAgentConsoleEvent,
	MissionAgentConsoleState,
	MissionActionDescriptor,
	MissionActionExecutionStep,
	MissionActionFlowDescriptor,
	MissionActionFlowStep,
	MissionAgentSessionRecord,
	MissionProductKey,
	MissionSelector,
	MissionStageId,
	MissionStageStatus,
	MissionStatus,
	MissionTaskState,
	TrackedIssueSummary,
	MissionWorkspaceContext
} from '@flying-pillow/mission-core';
import {
	DaemonApi,
	DaemonMissionApi,
	getDaemonLogPath,
} from '@flying-pillow/mission-core';
import { render, useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/solid';
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSXElement, untrack } from 'solid-js';
import { CockpitScreen } from './components/CockpitScreen.js';
import type { CommandToolbarItem } from './components/CommandDock.js';
import {
	applyCockpitTheme,
	cockpitThemes,
	type CockpitThemeName,
	isCockpitThemeName
} from './components/cockpitTheme.js';
import { type ConsolePanelContent, type ConsolePanelTab } from './components/ConsolePanel.js';
import { cockpitTheme } from './components/cockpitTheme.js';
import type { ProgressRailItem, ProgressRailItemState } from './components/progressModels.js';
import { ExpandedCommandComposer, type ComposerTab } from './components/ExpandedCommandComposer.js';
import { FlowSummaryPanel } from './components/FlowSummaryPanel.js';
import { SelectPanel } from './components/SelectPanel.js';
import {
	MissionTreePanel,
	type MissionTreeStageNode,
	type MissionTreeTaskNode,
	type MissionTreeSessionNode
} from './components/MissionTreePanel.js';
import { IntroSplash } from './components/IntroSplash.js';
import type { CommandItem, FocusArea, SelectItem } from './components/types.js';

type CockpitConnection = {
	client: DaemonClient;
	status: MissionStatus;
	dispose: () => void;
};

type RunCockpitAppOptions = {
	workspaceContext: MissionWorkspaceContext;
	initialSelector: MissionSelector;
	initialTheme: CockpitThemeName;
	initialConnection?: CockpitConnection;
	initialConnectionError?: string;
	connect: (selector: MissionSelector) => Promise<CockpitConnection>;
};

type CockpitShellProps = RunCockpitAppOptions;

type DaemonState = 'connected' | 'degraded' | 'booting';
type CockpitMode = 'setup' | 'root' | 'mission';
type PickerMode = 'command-select' | 'command-flow';
type CenterPanelMode = 'console' | 'console-fullscreen' | 'command-select' | 'command-flow' | 'command-flow-editor';
type CockpitLayoutRoute = {
	layout: 'split' | 'overlay';
	centerPanelMode: CenterPanelMode;
};

function resolveCockpitLayoutRoute(options: {
	showCommandPicker: boolean;
	showCommandFlow: boolean;
	isExpandedCommandFlowTextStep: boolean;
	consoleFullscreen: boolean;
}): CockpitLayoutRoute {
	if (options.isExpandedCommandFlowTextStep) {
		return {
			layout: 'overlay',
			centerPanelMode: 'command-flow-editor'
		};
	}
	if (options.showCommandFlow) {
		return {
			layout: 'split',
			centerPanelMode: 'command-flow'
		};
	}
	if (options.showCommandPicker) {
		return {
			layout: 'split',
			centerPanelMode: 'command-select'
		};
	}
	if (options.consoleFullscreen) {
		return {
			layout: 'overlay',
			centerPanelMode: 'console-fullscreen'
		};
	}
	return {
		layout: 'split',
		centerPanelMode: 'console'
	};
}

type CommandFlowSelectionValue = {
	kind: 'selection';
	stepId: string;
	label: string;
	optionIds: string[];
	optionLabels: string[];
};

type ConfiguredControlAgentSettings = {
	agentRunner?: string;
	defaultAgentMode?: string;
	defaultModel?: string;
	cockpitTheme?: string;
	instructionsPath?: string;
	skillsPath?: string;
};
type CommandFlowTextValue = {
	kind: 'text';
	stepId: string;
	label: string;
	value: string;
};
type CommandFlowStepValue = CommandFlowSelectionValue | CommandFlowTextValue;
type CommandFlowResult = {
	flowId: string;
	steps: CommandFlowStepValue[];
};
type CommandFlowSelectionStep = {
	kind: 'selection';
	id: string;
	label: string;
	title: string;
	emptyLabel: string;
	helperText: string;
	selectionMode: 'single' | 'multiple';
	items: (steps: CommandFlowStepValue[]) => SelectItem[];
};
type CommandFlowTextStep = {
	kind: 'text';
	id: string;
	label: string;
	title: string;
	helperText: string;
	placeholder: string;
	initialValue: string;
	inputMode: 'compact' | 'expanded';
	format: 'plain' | 'markdown';
};
type CommandFlowStep = CommandFlowSelectionStep | CommandFlowTextStep;
type CommandFlowDefinition = {
	id: string;
	targetLabel: string;
	actionLabel: string;
	steps: CommandFlowStep[];
	onComplete: (result: CommandFlowResult) => Promise<CommandFlowCompletion | void>;
};
type CommandFlowCompletion = {
	kind: 'close';
} | {
	kind: 'restart';
	definition: CommandFlowDefinition;
	selectedItemId?: string;
};
type CommandFlowState = {
	definition: CommandFlowDefinition;
	stepIndex: number;
	steps: CommandFlowStepValue[];
};
type CommandDockDescriptor = {
	title: string;
	placeholder: string;
};
type HeaderTab = {
	id: string;
	label: string;
	target: { kind: 'control' } | { kind: 'mission'; missionId: string };
};
type MarkdownDocumentState =
	| { status: 'loading' }
	| { status: 'ready'; content: string }
	| { status: 'error'; error: string };
type ConsoleTabDescriptor =
	| {
		id: string;
		label: string;
		kind: 'artifact' | 'task';
		sourcePath: string;
	  }
	| {
		id: string;
		label: string;
		kind: 'session';
		sessionId: string;
	  }
	| {
		id: string;
		label: string;
		kind: 'control';
	  };

type TreeTargetDescriptor = {
	id: string;
	title: string;
	kind: 'stage' | 'stage-artifact' | 'task' | 'task-artifact' | 'session';
	collapsible: boolean;
	tabId?: string;
	stageId?: MissionStageId;
	taskId?: string;
	sessionId?: string;
};

type TreeTargetKind = TreeTargetDescriptor['kind'];

type CommandTargetContext = {
	stageId: MissionStageId | undefined;
	taskId: string | undefined;
	sessionId: string | undefined;
};

const missionFocusOrder: FocusArea[] = ['header', 'tree', 'sessions', 'command'];
const controlFocusOrder: FocusArea[] = ['header', 'command'];

export async function runCockpitApp(options: RunCockpitAppOptions): Promise<void> {
	const renderer = await createCliRenderer({
		exitOnCtrlC: false,
		targetFps: 30
	});
	await render(() => <MissionCockpitApp {...options} />, renderer);
	await new Promise<void>((resolve) => {
		renderer.once('destroy', () => {
			resolve();
		});
	});
}

function MissionCockpitApp({
	workspaceContext,
	initialSelector,
	initialTheme,
	initialConnection,
	initialConnectionError,
	connect
}: CockpitShellProps) {
	const renderer = useRenderer();
	const terminal = useTerminalDimensions();
	const [selector, setSelector] = createSignal<MissionSelector>(initialSelector);
	const [connection, setConnection] = createSignal<CockpitConnection | undefined>(initialConnection);
	const [status, setStatus] = createSignal<MissionStatus>(initialConnection?.status ?? { found: false });
	const [daemonState, setDaemonState] = createSignal<DaemonState>(
		initialConnection ? 'connected' : initialConnectionError ? 'degraded' : 'booting'
	);
	const [activityLog, setActivityLog] = createSignal<string[]>([
		createInitialStatusMessage(initialConnectionError)
	]);
	const [daemonOutputLines, setDaemonOutputLines] = createSignal<string[]>([]);
	const [markdownDocumentByPath, setMarkdownDocumentByPath] = createSignal<Record<string, MarkdownDocumentState>>({});
	const [consoleStateBySessionId, setConsoleStateBySessionId] = createSignal<
		Record<string, MissionAgentConsoleState>
	>({});
	const [inputValue, setInputValue] = createSignal<string>('');
	const [isRunningCommand, setIsRunningCommand] = createSignal<boolean>(false);
	const [focusArea, setFocusArea] = createSignal<FocusArea>('command');
	const [activePicker, setActivePicker] = createSignal<PickerMode | undefined>();
	const [commandPickerQuery, setCommandPickerQuery] = createSignal<string>('');
	const [selectedPickerItemId, setSelectedPickerItemId] = createSignal<string | undefined>();
	const [openIssues, setOpenIssues] = createSignal<TrackedIssueSummary[]>([]);
	const [selectedStageId, setSelectedStageId] = createSignal<MissionStageId | undefined>(initialConnection?.status.stage);
	const [selectedTaskId, setSelectedTaskId] = createSignal<string>('');
	const [selectedSessionId, setSelectedSessionId] = createSignal<string | undefined>(
		pickPreferredSessionId(initialConnection?.status.agentSessions ?? [], undefined)
	);
	const [selectedConsoleTabId, setSelectedConsoleTabId] = createSignal<string | undefined>();
	const [selectedTreeTargetId, setSelectedTreeTargetId] = createSignal<string | undefined>();
	const [collapsedTreeNodeIds, setCollapsedTreeNodeIds] = createSignal<Set<string>>(new Set<string>());
	const [collapseDefaultsMissionId, setCollapseDefaultsMissionId] = createSignal<string | undefined>();
	const [consoleReloadNonce, setConsoleReloadNonce] = createSignal<number>(0);
	const [selectedThemeName, setSelectedThemeName] = createSignal<CockpitThemeName>(initialTheme);
	const [commandFlow, setCommandFlow] = createSignal<CommandFlowState | undefined>();
	const [commandFlowSelectionDraft, setCommandFlowSelectionDraft] = createSignal<string[]>([]);
	const [commandFlowTextValue, setCommandFlowTextValue] = createSignal<string>('');
	const [expandedComposerTab, setExpandedComposerTab] = createSignal<ComposerTab>('write');
	const [fallbackGitHubUser, setFallbackGitHubUser] = createSignal<string | undefined>();
	const [isGitHubUserProbeInFlight, setIsGitHubUserProbeInFlight] = createSignal<boolean>(false);
	const [fallbackControlBranch, setFallbackControlBranch] = createSignal<string | undefined>();
	const [isControlBranchProbeInFlight, setIsControlBranchProbeInFlight] = createSignal<boolean>(false);
	const [knownAvailableMissions, setKnownAvailableMissions] = createSignal<MissionStatus['availableMissions']>([]);
	const [selectedHeaderTabId, setSelectedHeaderTabId] = createSignal<string | undefined>();
	const [isConsoleFullscreen, setIsConsoleFullscreen] = createSignal<boolean>(false);
	const [showIntroSplash, setShowIntroSplash] = createSignal<boolean>(true);
	const [selectedToolbarCommandId, setSelectedToolbarCommandId] = createSignal<string | undefined>();
	const [confirmingToolbarCommandId, setConfirmingToolbarCommandId] = createSignal<string | undefined>();
	const [toolbarConfirmationChoice, setToolbarConfirmationChoice] = createSignal<'confirm' | 'cancel'>('confirm');
	const client = createMemo(() => connection()?.client);
	const currentMissionId = createMemo(() => selector().missionId ?? status().missionId);
	const controlStatus = createMemo(() => status().control);
	const stages = createMemo(() => status().stages ?? []);
	const sessions = createMemo(() => status().agentSessions ?? []);
	const selectedStage = createMemo(() => {
		const currentId = selectedStageId();
		return stages().find((stage) => stage.stage === currentId);
	});
	const stageTasks = createMemo(() => selectedStage()?.tasks ?? []);
	const selectedTask = createMemo(() => {
		const currentId = selectedTaskId();
		return stageTasks().find((task) => task.taskId === currentId);
	});
	const sessionsForTask = createMemo(() => {
		const taskId = selectedTask()?.taskId;
		if (!taskId) {
			return [];
		}
		return sessions()
			.filter((session) => session.taskId === taskId)
			.slice()
			.sort((left, right) => {
				const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
				if (createdAtOrder !== 0) {
					return createdAtOrder;
				}
				return left.sessionId.localeCompare(right.sessionId);
			});
	});
	const visibleSessions = createMemo(() => sessionsForTask());
	const availableConsoleHeight = createMemo(() => Math.max(terminal().height - 26, 8));
	const stageItems = createMemo<ProgressRailItem[]>(() =>
		stages().map((stage) => ({
			id: stage.stage,
			label: formatStageLabel(stage.stage),
			state: mapStageState(stage.status),
			selected: stage.stage === selectedStageId(),
			subtitle: `${String(stage.completedTaskCount)}/${String(stage.taskCount)}`
		}))
	);
	const cockpitMode = createMemo<CockpitMode>(() =>
		status().operationalMode ?? (status().found ? 'mission' : 'root')
	);
	const themePickerItems = createMemo<SelectItem[]>(() =>
		buildThemePickerItems(selectedThemeName())
	);
	const issuePickerItems = createMemo<SelectItem[]>(() =>
		buildIssuePickerItems(openIssues())
	);
	const commandQuery = createMemo(() => commandPickerQuery());
	const currentCommandFlow = createMemo(() => commandFlow());
	const currentCommandFlowStep = createMemo<CommandFlowStep | undefined>(() => {
		const flow = currentCommandFlow();
		return flow ? resolveCommandFlowStep(flow.definition, flow.stepIndex, flow.steps) : undefined;
	});
	const commandFlowItems = createMemo<SelectItem[]>(() => {
		const step = currentCommandFlowStep();
		const flow = currentCommandFlow();
		if (!step || step.kind !== 'selection') {
			return [];
		}
		const selectedIds = new Set(commandFlowSelectionDraft());
		return step.items(flow?.steps ?? []).map((item) => ({
			...item,
			...(step.selectionMode === 'multiple'
				? { label: `${selectedIds.has(item.id) ? '[x]' : '[ ]'} ${item.label}` }
				: {})
		}));
	});
	const showCommandFlow = createMemo(() => {
		const step = currentCommandFlowStep();
		return activePicker() === 'command-flow' && step?.kind === 'selection';
	});
	const isCompactCommandFlowTextStep = createMemo(() => {
		const step = currentCommandFlowStep();
		return activePicker() === 'command-flow' && step?.kind === 'text' && step.inputMode === 'compact';
	});
	const isExpandedCommandFlowTextStep = createMemo(() => {
		const step = currentCommandFlowStep();
		return activePicker() === 'command-flow' && step?.kind === 'text' && step.inputMode === 'expanded';
	});
	const canToggleExpandedPreview = createMemo(() => {
		const step = currentCommandFlowStep();
		return (
			activePicker() === 'command-flow'
			&& step?.kind === 'text'
			&& step.inputMode === 'expanded'
			&& step.format === 'markdown'
		);
	});
	const selectedCommandFlowItemId = createMemo(() =>
		pickSelectItemId(commandFlowItems(), selectedPickerItemId())
	);
	const commandFlowSummaryItems = createMemo(() => {
		const flow = currentCommandFlow();
		if (!flow) {
			return [];
		}
		return buildCommandFlowSummaryItems(flow.steps);
	});
	const headerPanelTitle = createMemo(() => {
		const workspaceLabel = resolveHeaderWorkspaceLabel(status().control, workspaceContext.workspaceRoot);
		if (cockpitMode() === 'setup') {
			return `SETUP ${workspaceLabel}`;
		}
		if (cockpitMode() === 'root') {
			return workspaceLabel;
		}
		return workspaceLabel;
	});
	const headerTabs = createMemo<HeaderTab[]>(() =>
		buildHeaderTabs(status(), knownAvailableMissions())
	);
	const headerTabsFocusable = createMemo(() => headerTabs().length > 1);
	const activeHeaderTabId = createMemo(() => {
		const missionId = currentMissionId();
		return missionId ? `mission:${missionId}` : 'control';
	});
	const headerStatusLines = createMemo(() =>
		buildHeaderStatusLines(status(), workspaceContext.workspaceRoot)
	);
	const headerFooterBadges = createMemo(() =>
		buildHeaderFooterBadges({
			mode: cockpitMode(),
			status: status(),
			daemonState: daemonState(),
			fallbackGitHubUser: fallbackGitHubUser()
		})
	);
	const commandTargetContext = createMemo<CommandTargetContext>(() => {
		return {
			stageId: selectedStageId(),
			taskId: selectedTaskId() || undefined,
			sessionId: selectedSessionId()
		};
	});
	const availableActions = createMemo<MissionActionDescriptor[]>(() =>
		resolveAvailableCommandsForContext(status().availableActions ?? [], commandTargetContext())
	);
	const availableCommandById = createMemo(() => {
		const entries = new Map<string, MissionActionDescriptor>();
		for (const command of availableActions()) {
			entries.set(command.id, command);
		}
		return entries;
	});
	const toolbarCommandDescriptors = createMemo<MissionActionDescriptor[]>(() =>
		resolveToolbarCommandsForContext(availableActions(), commandTargetContext())
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
	const commandPickerItems = createMemo<CommandItem[]>(() =>
		buildCommandPickerItems(availableActions(), commandQuery())
	);
	const commandCycleItems = createMemo<CommandItem[]>(() =>
		buildCommandPickerItems(availableActions(), '')
	);
	const showCommandPicker = createMemo(
		() => activePicker() === 'command-select' && commandQuery().length > 0
	);
	const selectedCommandPickerItemId = createMemo(() =>
		pickSelectItemId(commandPickerItems(), selectedPickerItemId())
	);
	const layoutRoute = createMemo<CockpitLayoutRoute>(() =>
		resolveCockpitLayoutRoute({
			showCommandPicker: showCommandPicker(),
			showCommandFlow: showCommandFlow(),
			isExpandedCommandFlowTextStep: isExpandedCommandFlowTextStep(),
			consoleFullscreen: isConsoleFullscreen()
		})
	);
	const centerPanelMode = createMemo<CenterPanelMode>(() => layoutRoute().centerPanelMode);
	const focusOrder = createMemo<FocusArea[]>(() =>
		buildFocusOrder({
			baseOrder: layoutRoute().centerPanelMode === 'console-fullscreen'
				? ['sessions', 'command']
				: cockpitMode() === 'mission'
					? missionFocusOrder
					: controlFocusOrder,
			headerTabsFocusable: headerTabsFocusable(),
			showCommandFlow: showCommandFlow(),
			showCommandPicker: showCommandPicker(),
			expandedComposer: isExpandedCommandFlowTextStep()
		})
	);
	const commandHelp = createMemo(() => {
		const step = currentCommandFlowStep();
		if (step) {
			return step.helperText;
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
			inputValue: inputValue()
		})
	);
	const screenTitle = createMemo(() => {
		if (cockpitMode() === 'setup') {
			return resolveHeaderWorkspaceLabel(status().control, workspaceContext.workspaceRoot);
		}
		if (cockpitMode() === 'root') {
			return resolveHeaderWorkspaceLabel(status().control, workspaceContext.workspaceRoot);
		}
		return status().title ?? status().missionId ?? 'Mission';
	});
	const consoleEmptyLabel = createMemo(() => {
		if (cockpitMode() === 'setup') {
			return 'Mission setup is incomplete. Use /setup to configure the repository before creating missions.';
		}
		if (cockpitMode() !== 'mission') {
			return 'Mission control is active. Use /start to create a mission or /select to open an existing one from the repository root.';
		}
		return selectedTask()
			? 'No sessions for the selected task. Daemon output is shown below.'
			: 'Select a task to inspect its sessions. Daemon output is shown below.';
	});
	const consoleTabs = createMemo<ConsoleTabDescriptor[]>(() => {
		const tabs: ConsoleTabDescriptor[] = [];
		for (const stage of stages()) {
			const stageArtifact = stageArtifactProductKey(stage.stage);
			const stageArtifactPath = stageArtifact ? status().productFiles?.[stageArtifact] : undefined;
			if (stageArtifact && stageArtifactPath) {
				tabs.push({
					id: createArtifactTabId(stageArtifact),
					label: path.basename(stageArtifactPath),
					kind: 'artifact',
					sourcePath: stageArtifactPath
				});
			}
			for (const task of stage.tasks) {
				if (task.filePath) {
					tabs.push({
						id: createTaskTabId(task.taskId),
						label: task.fileName,
						kind: 'task',
						sourcePath: task.filePath
					});
				}
			}
		}

		for (const session of sessions()) {
			tabs.push({
				id: createSessionTabId(session.sessionId),
				label: formatSessionTabLabel(session),
				kind: 'session',
				sessionId: session.sessionId
			});
		}

		if (!status().found) {
			tabs.push({
				id: controlTabId,
				label: 'CONTROL',
				kind: 'control'
			});
		}

		return tabs;
	});
	const treeTargets = createMemo<TreeTargetDescriptor[]>(() =>
		buildMissionTreeTargets({
			stages: stages(),
			sessions: sessions(),
			productFiles: status().productFiles
		})
	);
	const visibleTreeTargets = createMemo<TreeTargetDescriptor[]>(() =>
		buildVisibleTreeTargets(treeTargets(), collapsedTreeNodeIds())
	);
	const renderedConsoleTabs = createMemo<ConsolePanelTab[]>(() =>
		consoleTabs().map((tab) => ({ id: tab.id, label: tab.label, kind: tab.kind }))
	);
	const selectedTreeTarget = createMemo(() => {
		const preferredId = pickPreferredTreeTargetId(visibleTreeTargets(), selectedTreeTargetId(), {
			selectedStageId: selectedStageId(),
			selectedTaskId: selectedTaskId(),
			selectedSessionId: selectedSessionId()
		});
		return visibleTreeTargets().find((target) => target.id === preferredId);
	});
	const commandDockDescriptor = createMemo<CommandDockDescriptor>(() =>
		buildCommandDockDescriptor({
			commandFlow: currentCommandFlow(),
			currentCommandFlowStep: currentCommandFlowStep(),
			showCommandPicker: showCommandPicker(),
			selectedCommandId: showCommandPicker() ? selectedCommandPickerItemId() : undefined,
			availableActions: availableActions(),
			inputValue: inputValue(),
			status: status(),
			selectedConsoleTabKind: inferConsoleTabKindFromId(selectedConsoleTabId()),
			selectedSessionId: selectedSessionId(),
			selectedStageId: selectedStageId(),
			selectedTreeTargetTitle: selectedTreeTarget()?.title,
			selectedTreeTargetKind: selectedTreeTarget()?.kind
		})
	);
	const selectedConsoleTab = createMemo(() => {
		const selectedTarget = selectedTreeTarget();
		if (selectedTarget?.tabId) {
			return consoleTabs().find((tab) => tab.id === selectedTarget.tabId);
		}
		if (!status().found) {
			const preferredId = pickPreferredConsoleTabId(consoleTabs(), selectedConsoleTabId(), selectedSessionId());
			return consoleTabs().find((tab) => tab.id === preferredId) ?? consoleTabs()[0];
		}
		return undefined;
	});
	const selectedSessionRecord = createMemo(() => {
		const sessionId = selectedSessionId();
		if (!sessionId) {
			return undefined;
		}
		return sessions().find((session) => session.sessionId === sessionId);
	});
	const canSendSessionText = createMemo(() => {
		const tab = selectedConsoleTab();
		if (tab?.kind !== 'session') {
			return false;
		}
		const session = selectedSessionRecord();
		if (!session) {
			return false;
		}
		return session.lifecycleState !== 'completed'
			&& session.lifecycleState !== 'failed'
			&& session.lifecycleState !== 'cancelled';
	});
	const commandDockMode = createMemo<'input' | 'toolbar'>(() => {
		if (isCompactCommandFlowTextStep() || isExpandedCommandFlowTextStep()) {
			return 'input';
		}
		if (canSendSessionText()) {
			return 'input';
		}
		return 'toolbar';
	});
	const consoleContent = createMemo<ConsolePanelContent>(() => {
		const selectedTab = selectedConsoleTab();
		const reloadNonce = consoleReloadNonce();
		void reloadNonce;
		if (!selectedTab) {
			return {
				kind: 'output',
				lines: activityLog().slice(-availableConsoleHeight()),
				emptyLabel: consoleEmptyLabel()
			};
		}
		if (selectedTab.kind === 'session') {
			const lines = consoleStateBySessionId()[selectedTab.sessionId]?.lines ?? [];
			return {
				kind: 'output',
				lines: lines.slice(-availableConsoleHeight()),
				emptyLabel: 'No output has been recorded for this session yet.'
			};
		}
		if (selectedTab.kind === 'control') {
			return {
				kind: 'output',
				lines: daemonOutputLines().slice(-availableConsoleHeight()),
				emptyLabel: 'Daemon stdout will appear here when the Mission daemon writes output.'
			};
		}
		const documentState = markdownDocumentByPath()[selectedTab.sourcePath];
		if (!documentState || documentState.status === 'loading') {
			return {
				kind: 'markdown',
				status: 'loading',
				emptyLabel: 'Loading markdown...'
			};
		}
		if (documentState.status === 'error') {
			return {
				kind: 'markdown',
				status: 'error',
				emptyLabel: 'Unable to load markdown.',
				error: documentState.error
			};
		}
		return {
			kind: 'markdown',
			status: 'ready',
			markdown: documentState.content,
			emptyLabel: 'The markdown file is empty.'
		};
	});
	const missionTreeStages = createMemo<MissionTreeStageNode[]>(() =>
		buildMissionTreeStages({
			stages: stages(),
			sessions: sessions(),
			productFiles: status().productFiles,
			collapsedTreeNodeIds: collapsedTreeNodeIds(),
			selectedTreeTargetId: selectedTreeTarget()?.id
		})
	);
	function renderMissionTreePanel(): JSXElement | undefined {
		if (cockpitMode() !== 'mission') {
			return undefined;
		}
		return (
			<MissionTreePanel
				focused={focusArea() === 'tree'}
				stages={missionTreeStages()}
				emptyLabel="No mission structure is available yet."
			/>
		);
	}
	const rightPanelTitle = createMemo(() => selectedTreeTarget()?.title ?? 'TARGET');
	function renderSplitPanel(): JSXElement | undefined {
		switch (centerPanelMode()) {
			case 'command-flow': {
				const step = currentCommandFlowStep();
				if (!step || step.kind !== 'selection') {
					return undefined;
				}
				return (
					<SelectPanel
						title={step.title}
						items={commandFlowItems()}
						selectedItemId={selectedCommandFlowItemId()}
						focused={focusArea() === 'flow'}
						emptyLabel={step.emptyLabel}
						helperText={commandHelp()}
						onItemChange={(itemId) => {
							setSelectedPickerItemId(itemId);
						}}
						onItemSelect={(itemId) => {
							void selectCommandFlowItem(itemId);
						}}
					/>
				);
			}
			case 'command-select':
				return (
					<SelectPanel
						title="COMMANDS"
						items={commandPickerItems()}
						selectedItemId={selectedCommandPickerItemId()}
						focused={focusArea() === 'flow' || focusArea() === 'command'}
						showFooterBadges={false}
						emptyLabel={
							commandQuery() === '/'
								? 'No commands are available for the current selection.'
								: `No commands match ${commandQuery()}.`
						}
						helperText="Keep typing to filter. Use arrow keys to highlight a command. Enter inserts it. Esc closes the list."
						onItemChange={(itemId) => {
							setSelectedPickerItemId(itemId);
						}}
						onItemSelect={(itemId) => {
							selectCommandById(itemId);
						}}
					/>
				);
			case 'console':
			default:
				if (isCompactCommandFlowTextStep()) {
					const step = currentCommandFlowStep();
					if (step?.kind === 'text') {
						return (
							<FlowSummaryPanel
								title={step.title}
								stepLabel={step.label}
								helperText={step.helperText}
								items={commandFlowSummaryItems()}
								focused={focusArea() === 'command'}
							/>
						);
					}
				}
				return undefined;
		}
	}
	createEffect(() => {
		setMarkdownDocumentByPath((current) => (Object.keys(current).length === 0 ? current : {}));
		setConsoleStateBySessionId((current) => (Object.keys(current).length === 0 ? current : {}));
		setSelectedConsoleTabId(undefined);
		setSelectedTreeTargetId(undefined);
		setCollapsedTreeNodeIds(new Set<string>());
		setCollapseDefaultsMissionId(undefined);
		setSelectedSessionId(undefined);
		setSelectedTaskId('');
		setSelectedStageId(undefined);
	});

	createEffect(() => {
		if (cockpitMode() !== 'mission') {
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
		setSelectedStageId((current) => pickPreferredStageId(stages(), current, status().stage));
	});

	createEffect(() => {
		if (cockpitMode() === 'mission') {
			const target = selectedTreeTarget();
			if (target && !target.taskId) {
				setSelectedTaskId('');
				return;
			}
		}
		setSelectedTaskId((current) => pickPreferredTaskId(stageTasks(), current));
	});

	createEffect(() => {
		setSelectedSessionId((current) => pickPreferredSessionId(visibleSessions(), current));
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
		if (cockpitMode() === 'mission') {
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
			if (target.tabId !== selectedConsoleTabId()) {
				setSelectedConsoleTabId(target.tabId);
			}
			return;
		}
		setSelectedConsoleTabId((current) => pickPreferredConsoleTabId(consoleTabs(), current, selectedSessionId()));
	});

	createEffect(() => {
		setSelectedToolbarCommandId((current) =>
			pickPreferredToolbarCommandId(toolbarCommands(), current)
		);
	});

	createEffect(() => {
		if (commandDockMode() !== 'toolbar') {
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
		if (activePicker() !== 'command-flow') {
			return;
		}
		const flow = currentCommandFlow();
		const step = currentCommandFlowStep();
		if (!flow || !step) {
			closePicker();
			return;
		}
		if (step.kind === 'selection') {
			const items = commandFlowItems();
			setCommandFlowSelectionDraft([]);
			if (items.length === 0) {
				appendLog(step.emptyLabel);
				closePicker();
				return;
			}
			setSelectedPickerItemId(() =>
				pickSelectItemId(
					items,
					resolveCommandFlowSelectionInitialItemId(
						step,
						flow.steps,
						() => status().control?.settings as ConfiguredControlAgentSettings | undefined
					)
				)
			);
			setFocusArea('flow');
			return;
		}
		const initialValue = resolveCommandFlowTextInitialValue(flow, step);
		setCommandFlowTextValue(initialValue);
		if (step.inputMode === 'expanded') {
			setExpandedComposerTab('write');
			setInputValue('');
			setFocusArea('flow');
			return;
		}
		setInputValue(initialValue);
		setFocusArea('command');
	});

	function resolveCommandFlowTextInitialValue(
		flow: CommandFlowState,
		step: CommandFlowTextStep
	): string {
		const configuredInitialValue = step.initialValue ?? '';
		if (flow.definition.id !== 'control.setup.edit' || step.id !== 'value') {
			return configuredInitialValue;
		}
		const fieldSelection = flow.steps.find(
			(candidate): candidate is CommandFlowSelectionValue =>
				candidate.kind === 'selection' && candidate.stepId === 'field'
		);
		const selectedField = fieldSelection?.optionIds[0];
		const settings = status().control?.settings as ConfiguredControlAgentSettings | undefined;
		if (!settings || !selectedField) {
			return configuredInitialValue;
		}
		if (selectedField === 'instructionsPath') {
			return settings.instructionsPath ?? configuredInitialValue;
		}
		if (selectedField === 'skillsPath') {
			return settings.skillsPath ?? configuredInitialValue;
		}
		if (selectedField === 'defaultModel') {
			return settings.defaultModel ?? configuredInitialValue;
		}
		if (selectedField === 'cockpitTheme') {
			return settings.cockpitTheme ?? configuredInitialValue;
		}
		return configuredInitialValue;
	}

	createEffect(() => {
		const available = status().availableMissions;
		if (available !== undefined) {
			setKnownAvailableMissions(available);
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
		void resolveGitHubCliUser(workspaceContext.workspaceRoot)
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
		if (cockpitMode() !== 'root') {
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
		void resolveGitBranchName(workspaceContext.workspaceRoot)
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
		if (activePicker() !== 'command-select') {
			return;
		}
		if (commandQuery().length === 0) {
			closePicker();
			return;
		}
		setSelectedPickerItemId((current) => pickSelectItemId(commandPickerItems(), current));
	});

	createEffect(() => {
		setSelectedHeaderTabId((current) =>
			pickPreferredHeaderTabId(headerTabs(), current, activeHeaderTabId())
		);
	});

	createEffect(() => {
		const order = focusOrder();
		if (!order.includes(focusArea())) {
			setFocusArea(order[0] ?? 'command');
		}
	});

	onMount(() => {
		void refreshDaemonOutput();
		const intervalHandle = setInterval(() => {
			void refreshDaemonOutput();
		}, 750);
		onCleanup(() => {
			clearInterval(intervalHandle);
		});
	});

	createEffect(() => {
		const currentClient = client();
		if (!currentClient) {
			return;
		}
		const subscription = currentClient.onDidEvent((event) => {
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
				const nextConsole = applyConsoleEvent(event.event);
				const sessionId = nextConsole.sessionId;
				if (sessionId) {
					setConsoleStateBySessionId((current) => ({
						...current,
						[sessionId]: nextConsole
					}));
					if (nextConsole.awaitingInput) {
						setSelectedSessionId(sessionId);
						setSelectedConsoleTabId(createSessionTabId(sessionId));
						setFocusArea('command');
					}
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

	createEffect(() => {
		const currentClient = client();
		const missionSelector = currentMissionSelector();
		const targetSessions = visibleSessions();
		if (!currentClient || targetSessions.length === 0) {
			return;
		}
		if (status().found && !missionSelector) {
			return;
		}
		const sessionSelector = status().found ? missionSelector : undefined;
		for (const session of targetSessions) {
			if (consoleStateBySessionId()[session.sessionId]) {
				continue;
			}
			void new DaemonApi(currentClient).mission.getSessionConsoleState(sessionSelector, session.sessionId)
				.then((nextConsole: MissionAgentConsoleState | null) => {
					const nextSessionId = nextConsole?.sessionId;
					if (nextSessionId) {
						setConsoleStateBySessionId((current) => ({
							...current,
							[nextSessionId]: nextConsole
						}));
					}
				})
				.catch(() => undefined);
		}
	});

	createEffect(() => {
		for (const tab of consoleTabs()) {
			if (tab.kind === 'artifact' || tab.kind === 'task') {
				void ensureMarkdownLoaded(tab.sourcePath);
			}
		}
	});
	function renderExpandedCommandPanel(): JSXElement | undefined {
		if (layoutRoute().layout !== 'overlay' || centerPanelMode() !== 'command-flow-editor') {
			return undefined;
		}
		const flow = currentCommandFlow();
		const step = currentCommandFlowStep();
		if (!flow || !step || step.kind !== 'text' || step.inputMode !== 'expanded') {
			return undefined;
		}
		return (
			<ExpandedCommandComposer
				title={buildFlowStepTitle(flow.definition.targetLabel, step.label, flow.definition.actionLabel)}
				stepLabel={step.label}
				helperText={step.helperText}
				initialValue={commandFlowTextValue()}
				placeholder={step.placeholder}
				focused={focusArea() === 'flow'}
				format={step.format}
				activeTab={expandedComposerTab()}
				onTabChange={setExpandedComposerTab}
				onValueChange={setCommandFlowTextValue}
				onSubmit={(value) => {
					void submitCommandFlowTextStep(value);
				}}
			/>
		);
	}
	createEffect(() => {
		const tab = selectedConsoleTab();
		if (!tab) {
			return;
		}
		void reloadConsoleTab(tab);
	});

	onMount(() => {
		renderer.setBackgroundColor(cockpitTheme.background);
		if (!initialConnection) {
			void connectClient(initialSelector);
		}
	});

	createEffect(() => {
		selectedThemeName();
		renderer.setBackgroundColor(cockpitTheme.background);
	});

	onCleanup(() => {
		connection()?.dispose();
	});

	useKeyboard((key) => {
		if (key.ctrl && key.name === 'c') {
			renderer.destroy();
			return;
		}
		if (isConsoleFullscreenToggleKey(key)) {
			toggleConsoleFullscreen();
			return;
		}
		if (key.name === 'escape' && layoutRoute().centerPanelMode === 'console-fullscreen' && activePicker() === undefined) {
			setIsConsoleFullscreen(false);
			setFocusArea('command');
			return;
		}
		if (key.ctrl && key.name === 'p' && canToggleExpandedPreview()) {
			setExpandedComposerTab((current) => (current === 'write' ? 'preview' : 'write'));
			return;
		}
		if (key.name === 'tab') {
			moveFocus(key.shift ? -1 : 1);
			return;
		}
		if (
			!isCompactCommandFlowTextStep() &&
			!isExpandedCommandFlowTextStep() &&
			focusArea() !== 'flow' &&
			key.sequence === '/' &&
			(focusArea() !== 'command' ||
				inputValue().length === 0 ||
				inputValue() === '/' ||
				(activePicker() === 'command-select' && commandQuery() === '/'))
		) {
			setInputValue('/');
			updateCommandPicker('/');
			setFocusArea('command');
			return;
		}
		if (focusArea() === 'flow') {
			if (activePicker() === 'command-select') {
				if (key.name === 'backspace') {
					const nextValue = inputValue().slice(0, -1);
					setInputValue(nextValue);
					updateCommandPicker(nextValue);
					if (!parseCommandQuery(nextValue)) {
						closePicker({ clearCommandInput: true });
					}
					return;
				}
				if (isPrintableCommandFilterKey(key.sequence)) {
					const nextValue = normalizeCommandInputValue(`${inputValue()}${key.sequence}`);
					setInputValue(nextValue);
					updateCommandPicker(nextValue);
					return;
				}
			}
			if (showCommandFlow() && key.sequence === ' ' && isCurrentCommandFlowStepMultiSelect()) {
				toggleCurrentCommandFlowSelection();
				return;
			}
			if (isExpandedCommandFlowTextStep() && (key.name === 'enter' || key.name === 'return')) {
				if (expandedComposerTab() === 'preview' || !key.shift) {
					void submitCommandFlowTextStep(commandFlowTextValue());
					return;
				}
			}
			if (key.name === 'escape') {
				closePicker({ clearCommandInput: activePicker() === 'command-select' && commandQuery() === '/' });
				return;
			}
			return;
		}
		if (focusArea() === 'header') {
			if (key.name === 'left') {
				moveSelection(-1);
				return;
			}
			if (key.name === 'right') {
				moveSelection(1);
				return;
			}
			if (key.name === 'enter' || key.name === 'return') {
				void activateHeaderTab(selectedHeaderTabId());
				return;
			}
		}
		if (key.name === 'up') {
			if (focusArea() === 'command' && showCommandPicker()) {
				previewCommandPickerSelection(-1);
				return;
			}
			if (moveSelection(-1)) {
				return;
			}
		}
		if (key.name === 'down') {
			if (focusArea() === 'command' && showCommandPicker()) {
				previewCommandPickerSelection(1);
				return;
			}
			if (moveSelection(1)) {
				return;
			}
		}
		if (key.name === 'escape' && focusArea() === 'command') {
			if (commandDockMode() === 'toolbar') {
				if (confirmingToolbarCommandId()) {
					setConfirmingToolbarCommandId(undefined);
					setToolbarConfirmationChoice('confirm');
				}
				return;
			}
			if (activePicker() === 'command-select') {
				closePicker({ clearCommandInput: commandQuery() === '/' });
				return;
			}
			if (activePicker() === 'command-flow' && isCompactCommandFlowTextStep()) {
				closePicker({ clearCommandInput: true });
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
			if (commandDockMode() === 'toolbar') {
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
		if ((key.name === 'enter' || key.name === 'return') && focusArea() === 'tree' && cockpitMode() === 'mission') {
			activateTreeTarget(selectedTreeTargetId());
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
			case 'header': {
				previewHeaderTabSelection(delta);
				return true;
			}
			case 'tree':
				if (cockpitMode() === 'mission') {
					selectTreeTarget(moveTreeTargetSelection(visibleTreeTargets(), selectedTreeTargetId(), delta));
					return true;
				}
				return false;
			case 'sessions':
				if (cockpitMode() !== 'mission' || centerPanelMode() === 'console-fullscreen') {
					selectConsoleTab(moveConsoleTabSelection(consoleTabs(), selectedConsoleTabId(), delta));
					return true;
				}
				return false;
			default:
				return false;
		}
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
		setSelectedHeaderTabId(nextTabId);
	}

	async function activateHeaderTab(tabId: string | undefined): Promise<void> {
		if (!tabId) {
			return;
		}
		const selectedTab = headerTabs().find((tab) => tab.id === tabId);
		if (!selectedTab) {
			return;
		}
		if (selectedTab.target.kind === 'control') {
			if (!currentMissionId()) {
				setSelectedHeaderTabId('control');
				return;
			}
			await connectClient({});
			setSelectedHeaderTabId('control');
			setFocusArea('command');
			return;
		}

		if (selectedTab.target.missionId === currentMissionId()) {
			setSelectedHeaderTabId(tabId);
			return;
		}

		await connectClient({ missionId: selectedTab.target.missionId });
		setSelectedHeaderTabId(tabId);
		setFocusArea('command');
	}

	async function ensureMarkdownLoaded(sourcePath: string, forceReload = false): Promise<void> {
		const existing = untrack(markdownDocumentByPath)[sourcePath];
		if (!forceReload && (existing?.status === 'loading' || existing?.status === 'ready')) {
			return;
		}
		setMarkdownDocumentByPath((current) => ({
			...current,
			[sourcePath]: { status: 'loading' }
		}));
		try {
			const content = await readFile(sourcePath, 'utf8');
			setMarkdownDocumentByPath((current) => ({
				...current,
				[sourcePath]: { status: 'ready', content }
			}));
		} catch (error) {
			setMarkdownDocumentByPath((current) => ({
				...current,
				[sourcePath]: { status: 'error', error: toErrorMessage(error) }
			}));
		}
	}

	async function reloadConsoleTab(tab: ConsoleTabDescriptor): Promise<void> {
		setConsoleReloadNonce((current) => current + 1);
		if (tab.kind === 'artifact' || tab.kind === 'task') {
			await ensureMarkdownLoaded(tab.sourcePath, true);
			return;
		}
		if (tab.kind !== 'session') {
			return;
		}
		const currentClient = client();
		const missionSelector = currentMissionSelector();
		if (!currentClient) {
			return;
		}
		try {
			const nextConsole = await new DaemonApi(currentClient).mission.getSessionConsoleState(missionSelector, tab.sessionId);
			const nextSessionId = nextConsole?.sessionId;
			if (!nextSessionId) {
				return;
			}
			setConsoleStateBySessionId((current) => ({
				...current,
				[nextSessionId]: nextConsole
			}));
		} catch {
			return;
		}
	}

	function selectConsoleTab(tabId: string | undefined): void {
		if (!tabId) {
			return;
		}
		if (cockpitMode() === 'mission') {
			const target = treeTargets().find((candidate) => candidate.tabId === tabId);
			if (target) {
				selectTreeTarget(target.id);
			}
			return;
		}
		setSelectedConsoleTabId(tabId);
		const nextTab = consoleTabs().find((tab) => tab.id === tabId);
		if (nextTab?.kind === 'session') {
			setSelectedSessionId(nextTab.sessionId);
		} else {
			setSelectedSessionId(undefined);
		}
		if (nextTab) {
			void reloadConsoleTab(nextTab);
		}
		setFocusArea('command');
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
		setSelectedConsoleTabId(target.tabId);
		if (target.tabId) {
			const nextTab = consoleTabs().find((tab) => tab.id === target.tabId);
			if (nextTab) {
				void reloadConsoleTab(nextTab);
			}
		}
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

	function previewCommandPickerSelection(delta: number): void {
		const nextId = movePickerSelection(commandPickerItems(), selectedPickerItemId(), delta);
		if (!nextId) {
			return;
		}
		setSelectedPickerItemId(nextId);
		const nextCommand = commandPickerItems().find((item) => item.id === nextId);
		if (nextCommand) {
			setInputValue(nextCommand.command);
		}
	}

	async function replaceConnection(next: CockpitConnection | undefined): Promise<void> {
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

	async function refreshDaemonOutput(): Promise<void> {
		try {
			const content = await readFile(getDaemonLogPath(), 'utf8');
			const nextLines = normalizeDaemonOutputLines(content);
			setDaemonOutputLines((current) =>
				areStringArraysEqual(current, nextLines) ? current : nextLines
			);
		} catch (error) {
			if (isMissingFileError(error)) {
				setDaemonOutputLines((current) => (current.length === 0 ? current : []));
				return;
			}
			const fallbackLine = `Unable to read daemon stdout: ${toErrorMessage(error)}`;
			setDaemonOutputLines((current) =>
				current.length === 1 && current[0] === fallbackLine ? current : [fallbackLine]
			);
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

	function updateCommandPicker(value: string): void {
		if (activePicker() === 'command-flow') {
			return;
		}
		const query = parseCommandQuery(value);
		setCommandPickerQuery(query);

		if (!query) {
			if (activePicker() === 'command-select') {
				closePicker();
			}
			return;
		}
		const items = buildCommandPickerItems(availableActions(), query);
		setActivePicker('command-select');
		setSelectedPickerItemId((current) => pickSelectItemId(items, current));
	}

	function closePicker(options?: { clearCommandInput?: boolean }): void {
		setActivePicker(undefined);
		setCommandPickerQuery('');
		setCommandFlow(undefined);
		setCommandFlowSelectionDraft([]);
		setCommandFlowTextValue('');
		setExpandedComposerTab('write');
		if (options?.clearCommandInput) {
			setInputValue('');
		}
		if (focusArea() === 'flow') {
			setFocusArea('command');
		}
	}

	function cycleCommandInput(delta: number): void {
		if (isCompactCommandFlowTextStep() || isExpandedCommandFlowTextStep()) {
			return;
		}
		if (activePicker() === 'command-flow') {
			return;
		}
		const items = commandCycleItems();
		if (items.length === 0) {
			return;
		}
		const currentText = inputValue().trim();
		const currentIndex = items.findIndex((item) => item.command === currentText);
		const seedIndex = currentIndex >= 0 ? currentIndex : 0;
		const nextIndex = (seedIndex + delta + items.length) % items.length;
		const nextCommand = items[nextIndex];
		if (!nextCommand) {
			return;
		}
		setInputValue(nextCommand.command);
		updateCommandPicker(nextCommand.command);
		setSelectedPickerItemId(nextCommand.id);
		setFocusArea('command');
	}

	function selectCommandById(
		commandId: string,
		options?: { execute?: boolean; items?: CommandItem[] }
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
		setSelectedPickerItemId(commandId);
		if (options?.execute) {
			setInputValue('');
			closePicker({ clearCommandInput: true });
			void executeCommand(nextCommand.command);
			return;
		}
		setInputValue(nextCommand.command);
		closePicker();
	}

	function startCommandFlow(definition: CommandFlowDefinition, options?: { selectedItemId?: string }): void {
		const firstStep = definition.steps[0];
		if (!firstStep) {
			return;
		}
		setCommandPickerQuery('');
		setCommandFlow({
			definition,
			stepIndex: 0,
			steps: []
		});
		setActivePicker('command-flow');
		setSelectedPickerItemId(
			firstStep.kind === 'selection'
				? pickSelectItemId(
					firstStep.items([]),
					options?.selectedItemId ?? resolveCommandFlowSelectionInitialItemId(
						firstStep,
						[],
						() => status().control?.settings as ConfiguredControlAgentSettings | undefined
					)
				)
				: undefined
		);
		setInputValue('');
		setFocusArea(firstStep.kind === 'selection' || firstStep.inputMode === 'expanded' ? 'flow' : 'command');
	}

	async function selectCommandFlowItem(itemId: string): Promise<void> {
		const flow = commandFlow();
		const step = currentCommandFlowStep();
		if (!flow || !step || step.kind !== 'selection') {
			return;
		}
		const item = commandFlowItems().find((candidate) => candidate.id === itemId);
		if (!item) {
			return;
		}
		const optionIds = step.selectionMode === 'multiple' ? commandFlowSelectionDraft() : [item.id];
		if (optionIds.length === 0) {
			appendLog(`Select at least one ${step.label.toLowerCase()}.`);
			return;
		}
		const optionLabels = step.items(flow.steps)
			.filter((candidate) => optionIds.includes(candidate.id))
			.map((candidate) => candidate.label);
		await advanceCommandFlow([
			...flow.steps,
			{
				kind: 'selection',
				stepId: step.id,
				label: step.label,
				optionIds,
				optionLabels
			}
		]);
	}

	async function submitCommandFlowTextStep(rawValue: string): Promise<void> {
		const flow = commandFlow();
		const step = currentCommandFlowStep();
		if (!flow || !step || step.kind !== 'text') {
			return;
		}
		setCommandFlowTextValue(rawValue);
		await advanceCommandFlow([
			...flow.steps,
			{
				kind: 'text',
				stepId: step.id,
				label: step.label,
				value: rawValue
			}
		]);
	}

	async function advanceCommandFlow(nextSteps: CommandFlowStepValue[]): Promise<void> {
		const flow = commandFlow();
		if (!flow) {
			return;
		}
		const nextStep = flow.definition.steps[flow.stepIndex + 1];
		if (nextStep) {
			setCommandFlow({
				definition: flow.definition,
				stepIndex: flow.stepIndex + 1,
				steps: nextSteps
			});
			setSelectedPickerItemId(
				nextStep.kind === 'selection'
					? pickSelectItemId(
						nextStep.items(nextSteps),
						resolveCommandFlowSelectionInitialItemId(
							nextStep,
							nextSteps,
							() => status().control?.settings as ConfiguredControlAgentSettings | undefined
						)
					)
					: undefined
			);
			return;
		}
		await completeCommandFlow({
			flowId: flow.definition.id,
			steps: nextSteps
		});
	}

	async function completeCommandFlow(result: CommandFlowResult): Promise<void> {
		const flow = commandFlow();
		if (!flow) {
			return;
		}
		setIsRunningCommand(true);
		try {
			const completion = await flow.definition.onComplete(result);
			if (completion?.kind === 'restart') {
				startCommandFlow(completion.definition, {
					...(completion.selectedItemId ? { selectedItemId: completion.selectedItemId } : {})
				});
				setFocusArea('flow');
				return;
			}
			closePicker({ clearCommandInput: true });
			setFocusArea('command');
		} catch (error) {
			appendLog(toErrorMessage(error));
		} finally {
			setIsRunningCommand(false);
		}
	}

	function toggleCurrentCommandFlowSelection(): void {
		const step = currentCommandFlowStep();
		const itemId = selectedPickerItemId();
		if (!step || step.kind !== 'selection' || step.selectionMode !== 'multiple' || !itemId) {
			return;
		}
		setCommandFlowSelectionDraft((current) =>
			current.includes(itemId)
				? current.filter((candidate) => candidate !== itemId)
				: [...current, itemId]
		);
	}

	function isCurrentCommandFlowStepMultiSelect(): boolean {
		const step = currentCommandFlowStep();
		return step?.kind === 'selection' && step.selectionMode === 'multiple';
	}

	function buildIssueBootstrapFlow(): CommandFlowDefinition {
		return {
			id: 'issue-bootstrap',
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
		command: MissionActionDescriptor | undefined,
		executeSelector: MissionSelector,
		onCompleteLog?: (result: Awaited<ReturnType<typeof executeDaemonCommandById>>, flowResult: CommandFlowResult) => string | undefined
	): CommandFlowDefinition | undefined {
		if (!command?.flow) {
			return undefined;
		}
		const flow = command.flow as MissionActionFlowDescriptor & {
			actionLabel: string;
			steps: MissionActionFlowStep[];
		};
		return {
			id: command.id,
			targetLabel: flow.targetLabel,
			actionLabel: flow.actionLabel,
			steps: command.id === 'control.setup.edit'
				? buildAdaptiveSetupCommandFlowSteps(
					flow.steps,
					() => status().control?.settings as ConfiguredControlAgentSettings | undefined
				)
				: flow.steps.map((step) => buildCommandFlowStep(step)),
			onComplete: async (result) => {
				const executionResult = await executeDaemonCommandById(
					command.id,
					buildExecuteCommandSteps(result.steps),
					executeSelector
				);
				const message = onCompleteLog?.(executionResult, result);
				if (message) {
					appendLog(message);
				}
				if (command.id === 'control.setup.edit') {
					const nextDefinition = buildCommandFlowFromCommand(
							availableCommandById().get(command.id),
						executeSelector,
						onCompleteLog
					);
					if (nextDefinition) {
						const fieldStep = result.steps.find(
							(step): step is CommandFlowSelectionValue => step.kind === 'selection' && step.stepId === 'field'
						);
						return {
							kind: 'restart',
							definition: nextDefinition,
							...(fieldStep?.optionIds[0] ? { selectedItemId: fieldStep.optionIds[0] } : {})
						} satisfies CommandFlowCompletion;
					}
				}
				return { kind: 'close' } satisfies CommandFlowCompletion;
			}
		};
	}

	function applyMissionStatus(
		nextStatus: MissionStatus,
		fallbackSelector: MissionSelector = selector()
	): MissionSelector {
		const nextSelector = DaemonMissionApi.selectorFromStatus(nextStatus, fallbackSelector);
		setStatus(nextStatus);
		setSelector(nextSelector);
		return nextSelector;
	}

	async function selectThemeById(themeId: string): Promise<void> {
		if (!isCockpitThemeName(themeId)) {
			appendLog(`Unknown theme '${themeId}'.`);
			return;
		}
		const currentClient = client() ?? (await connectClient({}));
		if (currentClient) {
			try {
				const nextStatus = await new DaemonApi(currentClient).control.updateSetting('cockpitTheme', themeId);
				applyMissionStatus(nextStatus, selector());
			} catch (error) {
				appendLog(`Unable to persist theme '${themeId}': ${toErrorMessage(error)}`);
				return;
			}
		}
		applyCockpitTheme(themeId);
		setSelectedThemeName(themeId);
		setSelectedPickerItemId(themeId);
		appendLog(`Theme set to ${themeId}.`);
		closePicker();
		setFocusArea('command');
	}

	async function selectIssueByNumber(issueNumber: number): Promise<void> {
		const started = await startIssueMission(issueNumber);
		if (!started) {
			return;
		}
		setSelectedPickerItemId(String(issueNumber));
		closePicker();
	}

	async function connectClient(nextSelector: MissionSelector = selector()): Promise<DaemonClient | undefined> {
		setDaemonState('booting');
		try {
			const nextConnection = await connect(nextSelector);
			await replaceConnection(nextConnection);
			applyMissionStatus(nextConnection.status, nextSelector);
			setDaemonState('connected');
			appendLog(
				nextConnection.status.found
					? `Connected to ${nextConnection.status.missionId ?? 'the selected mission'}.`
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

	async function loadIssues(): Promise<void> {
		if (workspaceContext.kind !== 'control-root') {
			appendLog('Issue intake is only available from the repository root.');
			return;
		}
		if (!canUseIssueIntake(controlStatus())) {
			appendLog(describeIssueIntakeStatus(controlStatus()));
			return;
		}
		if (status().found) {
			appendLog('Issue intake is only available in Mission control. Use /root first.');
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
			applyMissionStatus(next);
			if (next.preparation?.kind === 'repository-bootstrap') {
				appendLog(
					`Repository bootstrap prepared on ${next.preparation.branchRef}. PR: ${next.preparation.pullRequestUrl}`
				);
			} else if (next.preparation?.kind === 'mission') {
				appendLog(
					`Mission ${next.preparation.missionId} prepared from issue ${String(issueNumber)} on ${next.preparation.branchRef}. PR: ${next.preparation.pullRequestUrl}`
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
		steps: MissionActionExecutionStep[],
		nextSelector: MissionSelector = currentMissionSelector() ?? {}
	) {
		const currentClient = client() ?? (await connectClient(nextSelector));
		if (!currentClient) {
			throw new Error('Unable to connect to execute the Mission command.');
		}
		const api = new DaemonApi(currentClient);
		const status = Object.keys(nextSelector).length > 0
			? await api.mission.executeAction(nextSelector, commandId, steps)
			: await api.control.executeAction(commandId, steps);
		applyMissionStatus(status, nextSelector);
		setDaemonState('connected');
		return { status };
	}

	function currentMissionSelector(): MissionSelector | undefined {
		const missionId = selector().missionId ?? status().missionId;
		return missionId ? { missionId } : undefined;
	}

	function resolveCommandExecutionSelector(command: MissionActionDescriptor): MissionSelector {
		if (command.id.startsWith('control.')) {
			return {};
		}
		return currentMissionSelector() ?? {};
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
							return `Mission ${nextStatus.preparation.missionId} prepared on ${nextStatus.preparation.branchRef}. PR: ${nextStatus.preparation.pullRequestUrl}`;
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

		if (command.id.startsWith('task.launch.')) {
			appendLog(`Launch requested for ${command.targetId ?? 'task'}.`);
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
				appendLog('Direct session input is no longer supported in autonomous runtime mode. Use slash commands to launch or control sessions.');
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
						'/console',
						'/setup',
						'/theme [ocean|sand]',
						...(workspaceContext.kind === 'control-root' ? ['/root'] : []),
						'/issues',
						'/issue <number>',
						'/start',
						'/select',
						...(status().found ? ['/launch', '/task <active|done|blocked>'] : []),
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
				case '/console':
					toggleConsoleFullscreen();
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
				case '/launch':
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
						appendLog('This cockpit is locked to the current mission worktree. Relaunch from the repository root to browse missions.');
						return;
					}
					await connectClient({});
					closePicker();
					appendLog('Returned to Mission control.');
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
					if (status().found) {
						appendLog('Issue intake is only available in Mission control. Use /root first.');
						return;
					}
					await selectIssueByNumber(Number(issueNumber));
					return;
				}
				case '/sessions':
					if (!status().found) {
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
								`${session.sessionId} | ${session.runtimeId} | ${session.lifecycleState}${session.assignmentLabel ? ` | ${session.assignmentLabel}` : ''}`
						)
					);
					return;
				case '/gate': {
					const missionSelector = currentMissionSelector();
					const currentClient = client() ?? (await connectClient(missionSelector ?? selector()));
					if (!status().found || !currentClient || !missionSelector) {
						appendLog(noMissionSelectedMessage(status()));
						return;
					}
					const intent = (args[0] as GateIntent | undefined) ?? gateIntentForStage(status().stage);
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

	function toggleConsoleFullscreen(): void {
		setIsConsoleFullscreen((current) => !current);
		if (layoutRoute().centerPanelMode !== 'console-fullscreen' && focusArea() !== 'command') {
			setFocusArea('sessions');
		}
	}

	return (
		<Show when={selectedThemeName()} keyed>
			<Show when={!showIntroSplash()} fallback={<IntroSplash onComplete={() => setShowIntroSplash(false)} />}>
				<CockpitScreen
					headerPanelTitle={headerPanelTitle()}
					showHeader={centerPanelMode() !== 'console-fullscreen'}
					title={screenTitle()}
					headerTabs={headerTabs().map((tab) => ({ id: tab.id, label: tab.label }))}
					headerSelectedTabId={selectedHeaderTabId()}
					headerTabsFocusable={headerTabsFocusable()}
					headerStatusLines={headerStatusLines()}
					headerFooterBadges={headerFooterBadges()}
					expandedCommandPanel={renderExpandedCommandPanel()}
					stageItems={stageItems()}
					focusArea={focusArea()}
					consoleTabs={renderedConsoleTabs()}
					selectedConsoleTabId={selectedConsoleTab()?.id}
					consoleContent={consoleContent()}
					rightPanelTitle={rightPanelTitle()}
					onConsoleTabSelect={selectConsoleTab}
					missionTreePanel={renderMissionTreePanel()}
					hideMissionTreePanel={centerPanelMode() === 'console-fullscreen'}
					mainPanel={renderSplitPanel()}
					commandDockTitle={commandDockDescriptor().title}
					commandDockPlaceholder={commandDockDescriptor().placeholder}
					commandDockMode={commandDockMode()}
					toolbarItems={toolbarCommands()}
					selectedToolbarItemId={selectedToolbarCommandId()}
					confirmingToolbarItemId={confirmingToolbarCommandId()}
					confirmationChoice={toolbarConfirmationChoice()}
					isRunningCommand={isRunningCommand()}
					inputValue={inputValue()}
					commandHelp={commandHelp()}
					keyHintsText={keyHintsText()}
					onInputChange={(value) => {
						const nextValue = isCompactCommandFlowTextStep()
							? value
							: normalizeCommandInputValue(value);
						setInputValue(nextValue);
						if (isCompactCommandFlowTextStep()) {
							setCommandFlowTextValue(nextValue);
							return;
						}
						updateCommandPicker(nextValue);
						if (parseCommandQuery(nextValue) === '/') {
							setFocusArea('command');
						}
					}}
					onInputSubmit={(submittedValue?: string) => {
						const value = typeof submittedValue === 'string' ? submittedValue : inputValue();
						if (isCompactCommandFlowTextStep()) {
							void submitCommandFlowTextStep(value);
							return;
						}
						const trimmedValue = value.trim();
						const submittedQuery = parseCommandQuery(value);
						const submittedCommandItems = submittedQuery
							? buildCommandPickerItems(availableActions(), submittedQuery)
							: [];
						const exactCommand = findAvailableCommandByText(availableActions(), trimmedValue);
						if (exactCommand) {
							setInputValue('');
							void executeCommand(trimmedValue);
							return;
						}
						if (submittedQuery && submittedCommandItems.length > 0) {
							const selectedCommandId = pickSelectItemId(
								submittedCommandItems,
								selectedCommandPickerItemId()
							) ?? submittedCommandItems[0]?.id;
							if (selectedCommandId) {
								selectCommandById(selectedCommandId, {
									execute: true,
									items: submittedCommandItems
								});
							}
							return;
						}
						if (value.trim() === '/') {
							updateCommandPicker(value);
							if (commandPickerItems().length > 0) {
								setFocusArea('command');
							} else {
								appendLog('No commands are available for the current selection.');
							}
							return;
						}
						setInputValue('');
						void executeCommand(trimmedValue);
					}}
				onInputKeyDown={(event) => {
					if (event.name === 'escape') {
						if (focusArea() !== 'command') {
							return;
						}
						event.preventDefault();
						event.stopPropagation();
						if (activePicker() === 'command-select') {
							closePicker({ clearCommandInput: commandQuery() === '/' });
							return;
						}
						if (activePicker() === 'command-flow' && isCompactCommandFlowTextStep()) {
							closePicker({ clearCommandInput: true });
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
					if (focusArea() !== 'command') {
						return;
					}
					const trimmed = inputValue().trim();
					if (trimmed.length > 0 && !trimmed.startsWith('/')) {
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

function buildAdaptiveSetupCommandFlowSteps(
	steps: MissionActionFlowStep[],
	getSettings: () => ConfiguredControlAgentSettings | undefined
): CommandFlowStep[] {
	return steps.map((step) => {
		if (step.id !== 'value') {
			return buildCommandFlowStep(step);
		}

		return {
			kind: 'selection',
			id: step.id,
			label: step.label,
			title: step.title,
			emptyLabel: 'No values are available for the selected setting.',
			helperText: 'Choose the value for the selected setting.',
			selectionMode: 'single',
			items: (stepValues) => {
				const selectedField = getSetupFieldSelection(stepValues);
				if (selectedField === 'agentRunner') {
					return [{
						id: 'copilot',
						label: 'Copilot',
						description: 'GitHub Copilot CLI runner'
					}];
				}
				if (selectedField === 'defaultAgentMode') {
					return buildAgentModeItems(resolveConfiguredAgentRunner(stepValues, getSettings));
				}
				if (selectedField === 'cockpitTheme') {
					const configuredTheme = getSettings()?.cockpitTheme;
					return buildThemePickerItems(
						isCockpitThemeName(configuredTheme) ? configuredTheme : 'ocean'
					);
				}
				return [];
			}
		};
	});
}

function resolveCommandFlowStep(
	definition: CommandFlowDefinition,
	stepIndex: number,
	stepValues: CommandFlowStepValue[]
): CommandFlowStep | undefined {
	const step = definition.steps[stepIndex];
	if (!step) {
		return undefined;
	}
	if (definition.id !== 'control.setup.edit' || step.id !== 'value') {
		return step;
	}

	const selectedField = getSetupFieldSelection(stepValues);
	if (
		selectedField === 'agentRunner'
		|| selectedField === 'cockpitTheme'
		|| selectedField === 'defaultAgentMode'
	) {
		return step;
	}

	return {
		kind: 'text',
		id: 'value',
		label: 'VALUE',
		title: selectedField === 'defaultModel' ? 'MODEL' : 'SETTING VALUE',
		helperText: selectedField === 'defaultModel'
			? 'Enter the default model id for the selected runner.'
			: 'Enter the new value for the selected setting.',
		placeholder: selectedField === 'defaultModel' ? 'Enter the model id' : 'Enter the updated value',
		initialValue: '',
		inputMode: 'compact',
		format: 'plain'
	};
}

function resolveCommandFlowSelectionInitialItemId(
	step: CommandFlowSelectionStep,
	stepValues: CommandFlowStepValue[],
	getSettings: () => ConfiguredControlAgentSettings | undefined
): string | undefined {
	if (step.id !== 'value') {
		return undefined;
	}
	const settings = getSettings();
	const selectedField = getSetupFieldSelection(stepValues);
	if (!settings || !selectedField) {
		return undefined;
	}
	if (selectedField === 'agentRunner') {
		return settings.agentRunner;
	}
	if (selectedField === 'defaultAgentMode') {
		return settings.defaultAgentMode;
	}
	if (selectedField === 'cockpitTheme' && isCockpitThemeName(settings.cockpitTheme)) {
		return settings.cockpitTheme;
	}
	if (selectedField === 'defaultModel') {
		return settings.defaultModel;
	}
	return undefined;
}

function getSetupFieldSelection(stepValues: CommandFlowStepValue[]): string | undefined {
	const fieldSelection = stepValues.find(
		(step): step is CommandFlowSelectionValue => step.kind === 'selection' && step.stepId === 'field'
	);
	return fieldSelection?.optionIds[0];
}

function resolveConfiguredAgentRunner(
	stepValues: CommandFlowStepValue[],
	getSettings: () => ConfiguredControlAgentSettings | undefined
): string | undefined {
	const selectedField = getSetupFieldSelection(stepValues);
	if (selectedField === 'agentRunner') {
		const pendingValue = stepValues.find(
			(step): step is CommandFlowSelectionValue => step.kind === 'selection' && step.stepId === 'value'
		);
		return pendingValue?.optionIds[0] ?? getSettings()?.agentRunner;
	}
	return getSettings()?.agentRunner;
}

function buildAgentModeItems(agentRunner: string | undefined): SelectItem[] {
	if (agentRunner === 'copilot') {
		return [
			{
				id: 'interactive',
				label: 'Interactive',
				description: 'Operator-guided Copilot session'
			},
			{
				id: 'autonomous',
				label: 'Autonomous',
				description: 'Copilot runs with autopilot continuation'
			}
		];
	}
	return [];
}

function applyConsoleEvent(event: MissionAgentConsoleEvent): MissionAgentConsoleState {
	return event.state;
}

function asMissionStatusNotification(
	event: unknown
): { type: 'mission.status'; missionId: string; status: MissionStatus } | undefined {
	if (!event || typeof event !== 'object') {
		return undefined;
	}
	const candidate = event as { type?: unknown; missionId?: unknown; status?: unknown };
	if (candidate.type !== 'mission.status') {
		return undefined;
	}
	if (typeof candidate.missionId !== 'string' || candidate.missionId.length === 0) {
		return undefined;
	}
	if (!candidate.status || typeof candidate.status !== 'object') {
		return undefined;
	}
	return candidate as { type: 'mission.status'; missionId: string; status: MissionStatus };
}

function pickPreferredStageId(
	stages: MissionStageStatus[],
	current: MissionStageId | undefined,
	preferred: MissionStageId | undefined
): MissionStageId | undefined {
	if (stages.length === 0) {
		return undefined;
	}
	if (current && stages.some((stage) => stage.stage === current)) {
		return current;
	}
	if (preferred && stages.some((stage) => stage.stage === preferred)) {
		return preferred;
	}
	return stages[0]?.stage;
}

function pickPreferredTaskId(tasks: MissionTaskState[], current: string): string {
	if (tasks.length === 0) {
		return '';
	}
	if (current && tasks.some((task) => task.taskId === current)) {
		return current;
	}
	const preferred =
		tasks.find((task) => task.status === 'active') ??
		tasks.find((task) => task.status === 'todo' && task.blockedBy.length === 0) ??
		tasks[0];
	return preferred?.taskId ?? '';
}

function pickPreferredSessionId(
	sessions: MissionAgentSessionRecord[],
	current: string | undefined
): string | undefined {
	if (sessions.length === 0) {
		return undefined;
	}
	if (current && sessions.some((session) => session.sessionId === current)) {
		return current;
	}
	const preferred =
		sessions.find((session) => session.lifecycleState === 'awaiting-input') ??
		sessions.find((session) => session.lifecycleState === 'running' || session.lifecycleState === 'starting') ??
		sessions[0];
	return preferred?.sessionId;
}

function pickPreferredConsoleTabId(
	tabs: ConsoleTabDescriptor[],
	current: string | undefined,
	preferredSessionId: string | undefined
): string | undefined {
	if (tabs.length === 0) {
		return undefined;
	}
	if (current && tabs.some((tab) => tab.id === current)) {
		return current;
	}
	if (preferredSessionId) {
		const sessionTabId = createSessionTabId(preferredSessionId);
		if (tabs.some((tab) => tab.id === sessionTabId)) {
			return sessionTabId;
		}
	}
	return tabs[0]?.id;
}

function moveConsoleTabSelection(
	tabs: ConsoleTabDescriptor[],
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

function moveTreeTargetSelection(
	targets: TreeTargetDescriptor[],
	current: string | undefined,
	delta: number
): string | undefined {
	if (targets.length === 0) {
		return undefined;
	}
	const currentId = current && targets.some((target) => target.id === current) ? current : targets[0]?.id;
	const currentIndex = Math.max(0, targets.findIndex((target) => target.id === currentId));
	const nextIndex = clampIndex(currentIndex + delta, targets.length);
	return targets[nextIndex]?.id;
}

function clampIndex(index: number, length: number): number {
	return Math.max(0, Math.min(length - 1, index));
}

function mapStageState(state: string): ProgressRailItemState {
	if (state === 'done') {
		return 'done';
	}
	if (state === 'active') {
		return 'active';
	}
	if (state === 'blocked') {
		return 'blocked';
	}
	return 'pending';
}

function formatStageLabel(stage: MissionStageId): string {
	if (stage === 'implementation') {
		return 'IMPLEMENT';
	}
	if (stage === 'delivery') {
		return 'DELIVER';
	}
	return stage.toUpperCase();
}

function describeAgentEvent(event: { type: string; state: { sessionId: string } }): string {
	return `${event.type} · ${event.state.sessionId}`;
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function createInitialStatusMessage(initialConnectionError?: string): string {
	if (initialConnectionError) {
		return `Cockpit could not connect immediately: ${initialConnectionError}`;
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

const controlTabId = 'control';

function stageArtifactProductKey(stage: MissionStageId): MissionProductKey | undefined {
	if (stage === 'implementation') {
		return 'verify';
	}
	if (stage === 'prd' || stage === 'spec' || stage === 'audit' || stage === 'delivery') {
		return stage;
	}
	return undefined;
}

function createArtifactTabId(product: MissionProductKey): string {
	return `artifact:${product}`;
}

function createTaskTabId(taskId: string): string {
	return `task:${taskId}`;
}

function createSessionTabId(sessionId: string): string {
	return `session:${sessionId}`;
}

function createStageNodeId(stage: MissionStageId): string {
	return `tree:stage:${stage}`;
}

function createStageArtifactNodeId(stage: MissionStageId): string {
	return `tree:stage-artifact:${stage}`;
}

function createTaskNodeId(taskId: string): string {
	return `tree:task:${taskId}`;
}

function createTaskArtifactNodeId(taskId: string): string {
	return `tree:task-artifact:${taskId}`;
}

function createSessionNodeId(sessionId: string): string {
	return `tree:session:${sessionId}`;
}

function buildMissionTreeTargets(input: {
	stages: MissionStageStatus[];
	sessions: MissionAgentSessionRecord[];
	productFiles: MissionStatus['productFiles'];
}): TreeTargetDescriptor[] {
	const targets: TreeTargetDescriptor[] = [];
	for (const stage of input.stages) {
		const stageArtifact = stageArtifactProductKey(stage.stage);
		const stageArtifactPath = stageArtifact ? input.productFiles?.[stageArtifact] : undefined;
		const stageArtifactTabId = stageArtifact && stageArtifactPath ? createArtifactTabId(stageArtifact) : undefined;
		const stageTarget: TreeTargetDescriptor = {
			id: createStageNodeId(stage.stage),
			title: formatStageLabel(stage.stage),
			kind: 'stage',
			collapsible: Boolean(stageArtifactTabId) || stage.tasks.length > 0,
			stageId: stage.stage,
			...(stageArtifactTabId ? { tabId: stageArtifactTabId } : {})
		};
		targets.push(stageTarget);
		if (stageArtifactTabId) {
			targets.push({
				id: createStageArtifactNodeId(stage.stage),
				title: path.basename(stageArtifactPath ?? ''),
				kind: 'stage-artifact',
				collapsible: false,
				tabId: stageArtifactTabId,
				stageId: stage.stage
			});
		}

		for (const task of stage.tasks) {
			const taskTabId = task.filePath ? createTaskTabId(task.taskId) : undefined;
			const taskTarget: TreeTargetDescriptor = {
				id: createTaskNodeId(task.taskId),
				title: `${String(task.sequence)} ${task.subject}`,
				kind: 'task',
				collapsible: Boolean(taskTabId) || input.sessions.some((session) => session.taskId === task.taskId),
				stageId: stage.stage,
				taskId: task.taskId,
				...(taskTabId ? { tabId: taskTabId } : {})
			};
			targets.push(taskTarget);
			if (taskTabId) {
				targets.push({
					id: createTaskArtifactNodeId(task.taskId),
					title: task.fileName,
					kind: 'task-artifact',
					collapsible: false,
					tabId: taskTabId,
					stageId: stage.stage,
					taskId: task.taskId
				});
			}

			const taskSessions = input.sessions
				.filter((session) => session.taskId === task.taskId)
				.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
			for (const session of taskSessions) {
				targets.push({
					id: createSessionNodeId(session.sessionId),
					title: formatSessionTabLabel(session),
					kind: 'session',
					collapsible: false,
					tabId: createSessionTabId(session.sessionId),
					stageId: stage.stage,
					taskId: task.taskId,
					sessionId: session.sessionId
				});
			}
		}
	}
	return targets;
}

function buildVisibleTreeTargets(
	targets: TreeTargetDescriptor[],
	collapsedTreeNodeIds: ReadonlySet<string>
): TreeTargetDescriptor[] {
	const visible: TreeTargetDescriptor[] = [];
	const hiddenBranches = new Set<string>();
	for (const target of targets) {
		if (target.kind === 'stage') {
			visible.push(target);
			if (collapsedTreeNodeIds.has(target.id) && target.stageId) {
				hiddenBranches.add(`stage:${target.stageId}`);
			} else if (target.stageId) {
				hiddenBranches.delete(`stage:${target.stageId}`);
			}
			continue;
		}

		if (target.stageId && hiddenBranches.has(`stage:${target.stageId}`)) {
			continue;
		}

		if (target.kind === 'task') {
			visible.push(target);
			if (collapsedTreeNodeIds.has(target.id) && target.taskId) {
				hiddenBranches.add(`task:${target.taskId}`);
			} else if (target.taskId) {
				hiddenBranches.delete(`task:${target.taskId}`);
			}
			continue;
		}

		if (target.taskId && hiddenBranches.has(`task:${target.taskId}`)) {
			continue;
		}

		visible.push(target);
	}
	return visible;
}

function buildDefaultCollapsedTreeNodeIds(
	stages: MissionStageStatus[],
	sessions: MissionAgentSessionRecord[]
): Set<string> {
	const collapsed = new Set<string>();
	const runningSessionTaskIds = new Set(
		sessions
			.filter((session) =>
				session.lifecycleState === 'running'
				|| session.lifecycleState === 'starting'
				|| session.lifecycleState === 'awaiting-input'
			)
			.map((session) => session.taskId)
			.filter((taskId): taskId is string => typeof taskId === 'string' && taskId.length > 0)
	);

	for (const stage of stages) {
		const stageNodeId = createStageNodeId(stage.stage);
		const hasExpandedTask = stage.tasks.some(
			(task) => task.status === 'active' || runningSessionTaskIds.has(task.taskId)
		);
		if (stage.status !== 'active' && !hasExpandedTask) {
			collapsed.add(stageNodeId);
		}

		for (const task of stage.tasks) {
			const taskNodeId = createTaskNodeId(task.taskId);
			if (task.status !== 'active' && !runningSessionTaskIds.has(task.taskId)) {
				collapsed.add(taskNodeId);
			}
		}
	}

	return collapsed;
}

function pickPreferredTreeTargetId(
	targets: TreeTargetDescriptor[],
	current: string | undefined,
	selected: {
		selectedStageId: MissionStageId | undefined;
		selectedTaskId: string;
		selectedSessionId: string | undefined;
	}
): string | undefined {
	if (targets.length === 0) {
		return undefined;
	}
	if (current && targets.some((target) => target.id === current)) {
		return current;
	}
	if (selected.selectedSessionId) {
		const sessionNodeId = createSessionNodeId(selected.selectedSessionId);
		if (targets.some((target) => target.id === sessionNodeId)) {
			return sessionNodeId;
		}
	}
	if (selected.selectedTaskId) {
		const taskArtifactId = createTaskArtifactNodeId(selected.selectedTaskId);
		if (targets.some((target) => target.id === taskArtifactId)) {
			return taskArtifactId;
		}
		const taskNodeId = createTaskNodeId(selected.selectedTaskId);
		if (targets.some((target) => target.id === taskNodeId)) {
			return taskNodeId;
		}
	}
	if (selected.selectedStageId) {
		const stageArtifactId = createStageArtifactNodeId(selected.selectedStageId);
		if (targets.some((target) => target.id === stageArtifactId)) {
			return stageArtifactId;
		}
		const stageNodeId = createStageNodeId(selected.selectedStageId);
		if (targets.some((target) => target.id === stageNodeId)) {
			return stageNodeId;
		}
	}
	return targets[0]?.id;
}

function buildMissionTreeStages(input: {
	stages: MissionStageStatus[];
	sessions: MissionAgentSessionRecord[];
	productFiles: MissionStatus['productFiles'];
	collapsedTreeNodeIds: ReadonlySet<string>;
	selectedTreeTargetId: string | undefined;
}): MissionTreeStageNode[] {
	return input.stages.map((stage) => {
		const stageArtifact = stageArtifactProductKey(stage.stage);
		const stageArtifactPath = stageArtifact ? input.productFiles?.[stageArtifact] : undefined;
		const stageNodeId = createStageNodeId(stage.stage);
		const tasks: MissionTreeTaskNode[] = stage.tasks.map((task) => {
			const taskSessions = input.sessions
				.filter((session) => session.taskId === task.taskId)
				.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
			const taskNodeId = createTaskNodeId(task.taskId);
			const sessionNodes: MissionTreeSessionNode[] = taskSessions.map((session) => ({
				id: createSessionNodeId(session.sessionId),
				label: formatSessionTabLabel(session),
				selected: input.selectedTreeTargetId === createSessionNodeId(session.sessionId),
				lifecycleState: session.lifecycleState
			}));
			const taskNode: MissionTreeTaskNode = {
				id: taskNodeId,
				label: `${String(task.sequence)} ${task.subject}`,
				selected: input.selectedTreeTargetId === taskNodeId,
				collapsed: input.collapsedTreeNodeIds.has(taskNodeId),
				status: task.status,
				sessions: sessionNodes
			};
			if (task.filePath) {
				taskNode.artifact = {
					id: createTaskArtifactNodeId(task.taskId),
					label: path.basename(task.filePath),
					selected: input.selectedTreeTargetId === createTaskArtifactNodeId(task.taskId)
				};
			}
			return taskNode;
		});

		const stageNode: MissionTreeStageNode = {
			id: stageNodeId,
			label: formatStageLabel(stage.stage),
			selected: input.selectedTreeTargetId === stageNodeId,
			collapsed: input.collapsedTreeNodeIds.has(stageNodeId),
			status: stage.status,
			tasks
		};
		if (stageArtifactPath) {
			stageNode.artifact = {
				id: createStageArtifactNodeId(stage.stage),
				label: path.basename(stageArtifactPath),
				selected: input.selectedTreeTargetId === createStageArtifactNodeId(stage.stage)
			};
		}
		return stageNode;
	});
}

function inferConsoleTabKindFromId(tabId: string | undefined): ConsoleTabDescriptor['kind'] | undefined {
	if (!tabId) {
		return undefined;
	}
	if (tabId.startsWith('artifact:')) {
		return 'artifact';
	}
	if (tabId.startsWith('task:')) {
		return 'task';
	}
	if (tabId.startsWith('session:')) {
		return 'session';
	}
	if (tabId === controlTabId) {
		return 'control';
	}
	return undefined;
}

function formatSessionTabLabel(session: MissionAgentSessionRecord): string {
	return `${session.runtimeId} ${session.sessionId.slice(-4)}`;
}

function isPrintableCommandFilterKey(sequence: string | undefined): boolean {
	return typeof sequence === 'string' && /^[ -~]$/u.test(sequence);
}

function isConsoleFullscreenToggleKey(key: {
	ctrl?: boolean;
	name?: string;
	sequence?: string;
}): boolean {
	if (key.ctrl === true && (key.name === 'space' || key.sequence === ' ')) {
		return true;
	}
	// Many terminals encode Ctrl+Space as NUL instead of setting ctrl/name flags.
	return key.sequence === '\u0000';
}

function buildCommandPickerItems(
	commands: MissionActionDescriptor[],
	query: string
): CommandItem[] {
	const normalizedQuery = query.toLowerCase();
	return commands
		.filter((command) => command.enabled)
		.map((command) => ({
			id: command.id,
			command: command.action,
			label: command.action,
			description: command.targetId ? `${command.label} [${command.targetId}]` : command.label
		}))
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

function resolveAvailableCommandsForContext(
	commands: MissionActionDescriptor[],
	context: CommandTargetContext
): MissionActionDescriptor[] {
	return commands.filter((command) => matchesCommandTargetContext(command, context));
}

function buildThemePickerItems(selectedTheme: CockpitThemeName): SelectItem[] {
	return Object.keys(cockpitThemes).map((themeName) => {
		const isSelected = themeName === selectedTheme;
		return {
			id: themeName,
			label: themeName.toUpperCase(),
			description: isSelected ? 'Current session theme' : 'Apply for this cockpit session'
		};
	});
}

function buildIssuePickerItems(issues: TrackedIssueSummary[]): SelectItem[] {
	return issues.map((issue) => ({
		id: String(issue.number),
		label: `#${String(issue.number)} ${issue.title}`,
		description: formatIssueDescription(issue)
	}));
}

function buildHeaderTabs(
	status: MissionStatus,
	fallbackMissions: MissionStatus['availableMissions'] = []
): HeaderTab[] {
	const tabs: HeaderTab[] = [
		{
			id: 'control',
			label: 'CONTROL',
			target: { kind: 'control' }
		}
	];
	const missionCandidates = status.availableMissions ?? fallbackMissions ?? [];
	const seenMissionIds = new Set<string>();
	const activeMissionId = status.missionId?.trim();
	if (activeMissionId) {
		const activeMissionTitle = status.title?.trim() || missionCandidates.find(
			(candidate) => candidate.missionId === activeMissionId
		)?.title;
		tabs.push({
			id: `mission:${activeMissionId}`,
			label: formatHeaderMissionLabel(activeMissionId, activeMissionTitle),
			target: { kind: 'mission', missionId: activeMissionId }
		});
		seenMissionIds.add(activeMissionId);
	}
	for (const candidate of missionCandidates) {
		if (activeMissionId) {
			break;
		}
		if (!candidate.missionId || seenMissionIds.has(candidate.missionId)) {
			continue;
		}
		tabs.push({
			id: `mission:${candidate.missionId}`,
			label: formatHeaderMissionLabel(candidate.missionId, candidate.title),
			target: { kind: 'mission', missionId: candidate.missionId }
		});
		seenMissionIds.add(candidate.missionId);
	}
	return tabs;
}

function formatHeaderMissionLabel(missionId: string, title?: string): string {
	const trimmedTitle = title?.trim();
	if (!trimmedTitle) {
		return missionId;
	}
	const normalized = trimmedTitle.replace(/\s+/gu, ' ').trim();
	return normalized.length <= 40 ? normalized : `${normalized.slice(0, 37)}...`;
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

function formatToolbarCommandLabel(command: MissionActionDescriptor): string {
	if (command.ui?.toolbarLabel) {
		return command.ui.toolbarLabel.trim().toUpperCase();
	}
	const normalized = command.action.trim().replace(/^\/+/u, '').replace(/\s+/gu, ' ');
	return normalized.toUpperCase();
}

function resolveToolbarCommandsForContext(
	commands: MissionActionDescriptor[],
	context: CommandTargetContext
): MissionActionDescriptor[] {
	return commands.filter((command) => matchesCommandTargetContext(command, context));
}

function matchesCommandTargetContext(
	command: MissionActionDescriptor,
	context: CommandTargetContext
): boolean {
	const presentationTargets = command.presentationTargets ?? [];
	if (presentationTargets.length > 0) {
		if (context.sessionId) {
			return presentationTargets.some(
				(target) => target.scope === 'session' && target.targetId === context.sessionId
			);
		}

		if (context.taskId) {
			return presentationTargets.some(
				(target) => target.scope === 'task' && target.targetId === context.taskId
			);
		}

		if (context.stageId) {
			return presentationTargets.some(
				(target) => target.scope === 'stage' && target.targetId === context.stageId
			);
		}

		return presentationTargets.some((target) => target.scope === 'mission');
	}

	if (context.sessionId) {
		return command.scope === 'session' && command.targetId === context.sessionId;
	}

	if (context.taskId) {
		return command.scope === 'task' && command.targetId === context.taskId;
	}

	if (context.stageId) {
		return command.scope === 'generation' && command.targetId === context.stageId;
	}

	return command.scope === 'mission';
}

function movePickerSelection(items: SelectItem[], current: string | undefined, delta: number): string | undefined {
	if (items.length === 0) {
		return undefined;
	}
	const currentId = pickSelectItemId(items, current);
	const currentIndex = Math.max(0, items.findIndex((item) => item.id === currentId));
	const nextIndex = (currentIndex + delta + items.length) % items.length;
	return items[nextIndex]?.id;
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
}): string {
	if (input.focusArea === 'command') {
		if (input.activePicker === 'command-flow') {
			return 'Tab/Shift+Tab focus | Ctrl+Space console | Enter continue | Esc close flow | q quit';
		}
		const commandHint = buildCommandCycleHint(input.commandItems, input.inputValue);
		return `Tab/Shift+Tab focus | Ctrl+Space console | Esc collapse console | ${commandHint} | Enter submit | q quit`;
	}
	return 'Tab/Shift+Tab focus | Ctrl+Space console | Esc collapse console | ↑↓ navigate | Enter select | / commands | q quit';
}

function buildCommandCycleHint(commands: CommandItem[], inputValue: string): string {
	if (commands.length === 0) {
		return '←→ command (none available)';
	}
	const trimmed = inputValue.trim();
	const currentIndex = commands.findIndex((command) => command.command === trimmed);
	const activeIndex = currentIndex >= 0 ? currentIndex : 0;
	const activeCommand = commands[activeIndex]?.command ?? commands[0]?.command ?? '/';
	return `←→ command ${String(activeIndex + 1)}/${String(commands.length)} ${activeCommand}`;
}

function canUseIssueIntake(control: MissionStatus['control']): boolean {
	return Boolean(control?.issuesConfigured && control.githubAuthenticated === true);
}

function describeIssueIntakeStatus(control: MissionStatus['control']): string {
	if (!control) {
		return 'Mission control status is still loading.';
	}
	if (!control.issuesConfigured) {
		return 'Mission could not resolve a GitHub repository from the current workspace.';
	}
	if (control.githubAuthenticated === false) {
		return control.githubAuthMessage ?? 'GitHub CLI authentication is required for issue intake.';
	}
	return 'GitHub issue intake is not ready yet.';
}

function describeControlConnection(status: MissionStatus): string {
	const control = status.control;
	if (!control) {
		return 'Connected to Mission control.';
	}
	return control.problems.length > 0
		? 'Connected to Mission setup. Run /setup to finish configuration.'
		: 'Connected to Mission control.';
}

function noMissionSelectedMessage(status: MissionStatus): string {
	if (status.operationalMode === 'setup') {
		return 'Mission setup is incomplete. Run /setup first.';
	}
	return 'No mission is selected. Use /start to create one or /select to open an existing mission.';
}

function normalizeDaemonOutputLines(content: string): string[] {
	return content
		.split(/\r?\n/u)
		.filter((line, index, lines) => line.length > 0 || index < lines.length - 1)
		.slice(-400);
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}

function isMissingFileError(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function buildCommandDockDescriptor(input: {
	commandFlow: CommandFlowState | undefined;
	currentCommandFlowStep: CommandFlowStep | undefined;
	showCommandPicker: boolean;
	selectedCommandId: string | undefined;
	availableActions: MissionActionDescriptor[];
	inputValue: string;
	status: MissionStatus;
	selectedConsoleTabKind: ConsoleTabDescriptor['kind'] | undefined;
	selectedSessionId: string | undefined;
	selectedStageId: MissionStageId | undefined;
	selectedTreeTargetTitle: string | undefined;
	selectedTreeTargetKind: TreeTargetKind | undefined;
}): CommandDockDescriptor {
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
	const exactCommand = findAvailableCommandByText(input.availableActions, input.selectedCommandId ?? input.inputValue.trim());
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
	if (input.showCommandPicker && input.selectedCommandId) {
		return describeCommandDockIntent(input.selectedCommandId, input.status, input.selectedStageId);
	}
	const trimmed = input.inputValue.trim();
	if (!trimmed) {
		if (input.selectedConsoleTabKind === 'session' && input.selectedSessionId) {
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
				: 'Enter a Mission control action'
		};
	}
	if (!trimmed.startsWith('/')) {
		return {
			title: 'AGENT > SEND',
			placeholder: 'Type a reply for the selected agent session'
		};
	}
	return describeCommandDockIntent(trimmed, input.status, input.selectedStageId);
}

function findAvailableCommandByText(
	commands: MissionActionDescriptor[],
	commandText: string | undefined
): MissionActionDescriptor | undefined {
	const trimmed = commandText?.trim();
	if (!trimmed) {
		return undefined;
	}
	return commands.find((command) => command.action === trimmed);
}

function buildCommandFlowStep(step: MissionActionFlowDescriptor['steps'][number]): CommandFlowStep {
	if (step.kind === 'selection') {
		return {
			kind: 'selection',
			id: step.id,
			label: step.label,
			title: step.title,
			emptyLabel: step.emptyLabel,
			helperText: step.helperText,
			selectionMode: step.selectionMode,
			items: () => step.options.map((option) => ({
				id: option.id,
				label: option.label,
				description: option.description
			}))
		};
	}
	return {
		kind: 'text',
		id: step.id,
		label: step.label,
		title: step.title,
		helperText: step.helperText,
		placeholder: step.placeholder,
		initialValue: step.initialValue ?? '',
		inputMode: step.inputMode,
		format: step.format
	};
}

function buildExecuteCommandSteps(steps: CommandFlowStepValue[]): MissionActionExecutionStep[] {
	return steps.map((step) =>
		step.kind === 'selection'
			? {
				kind: 'selection',
				stepId: step.stepId,
				optionIds: [...step.optionIds]
			}
			: {
				kind: 'text',
				stepId: step.stepId,
				value: step.value
			}
	);
}

function buildCommandFlowSummaryItems(
	steps: CommandFlowStepValue[]
): Array<{ label: string; value: string }> {
	return steps.map((step) => ({
		label: step.label,
		value: step.kind === 'selection'
			? step.optionLabels.join(', ')
			: formatCommandFlowTextSummary(step.value)
	}));
}

function formatCommandFlowTextSummary(value: string): string {
	const normalized = value.trim();
	if (!normalized) {
		return '(empty)';
	}
	const firstLine = normalized.split(/\r?\n/u)[0] ?? normalized;
	return normalized.includes('\n') ? `${firstLine}...` : firstLine;
}

function buildFlowStepTitle(
	targetLabel: string | undefined,
	stepLabel: string | undefined,
	actionLabel: string | undefined
): string {
	return [targetLabel, stepLabel, actionLabel]
		.map((segment) => (typeof segment === 'string' ? segment.trim() : ''))
		.filter((segment) => segment.length > 0)
		.map((segment) => segment.toUpperCase())
		.join(' > ');
}

function describeCommandDockIntent(
	commandLine: string,
	status: MissionStatus,
	selectedStageId: MissionStageId | undefined
): CommandDockDescriptor {
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
		case '/root':
			return {
				title: 'MISSION > SWITCH',
				placeholder: 'Press Enter to return to Mission control.'
			};
			case '/start':
				return {
						title: 'MISSION > TYPE > PREPARE',
						placeholder: 'Press Enter to open the guided mission preparation flow.'
				};
			case '/select':
				return {
					title: 'MISSION > MISSION > SWITCH',
					placeholder: 'Press Enter to choose a mission from Mission control.'
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
				title: 'LOG > CLEAR',
				placeholder: 'Press Enter to clear the activity log.'
			};
		case '/quit':
			return {
				title: 'COCKPIT > EXIT',
				placeholder: 'Press Enter to close the cockpit.'
			};
		default:
			return {
				title: 'COMMAND > RUN',
				placeholder: 'Press Enter to run the current command.'
			};
	}
}

function commandScopeLabel(status: MissionStatus): 'SETUP' | 'CONTROL' | 'MISSION' {
	if (status.found) {
		return 'MISSION';
	}
	return status.operationalMode === 'setup' ? 'SETUP' : 'CONTROL';
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
	status: MissionStatus,
	workspaceRoot: string
): Array<{ segments: Array<{ text: string; fg: string }> }> {
	const workspaceBaseName = path.basename(workspaceRoot.trim());
	const repository = resolvedControlGitHubRepository(status.control)
		?? (workspaceBaseName.length > 0 ? workspaceBaseName : 'workspace');
	const normalizedWorkspaceRoot = workspaceRoot.trim() || 'workspace';
	return [
		{
			segments: [
				{ text: ` ${repository}`, fg: cockpitTheme.accent },
				{ text: ' | ', fg: cockpitTheme.metaText },
				{ text: normalizedWorkspaceRoot, fg: cockpitTheme.metaText }
			]
		}
	];
}

function resolvedControlGitHubRepository(control: MissionStatus['control']): string | undefined {
	if (!control || !("githubRepository" in control)) {
		return undefined;
	}
	const repository = control['githubRepository'];
	return typeof repository === 'string' && repository.trim().length > 0 ? repository : undefined;
}

function resolveHeaderWorkspaceLabel(control: MissionStatus['control'], workspaceRoot: string): string {
	const githubRepository = resolvedControlGitHubRepository(control);
	if (githubRepository) {
		return githubRepository;
	}
	const normalizedRoot = workspaceRoot.trim();
	return normalizedRoot.length > 0 ? normalizedRoot : 'workspace';
}

function buildHeaderFooterBadges(input: {
	mode: CockpitMode;
	status: MissionStatus;
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
	control: MissionStatus['control'],
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
	control: MissionStatus['control'],
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

function isMissionDelivered(status: MissionStatus): boolean {
	return Boolean(status.stages?.some((stage) => stage.stage === 'delivery' && stage.status === 'done'));
}
