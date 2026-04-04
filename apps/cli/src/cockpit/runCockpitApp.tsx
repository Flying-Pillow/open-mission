/** @jsxImportSource @opentui/solid */

import { createCliRenderer } from '@opentui/core';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
	CommandExecuteStep,
	DaemonClient,
	GateIntent,
	MissionAgentConsoleEvent,
	MissionAgentConsoleState,
	MissionCommandDescriptor,
	MissionCommandFlowDescriptor,
	MissionCommandFlowStep,
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
	bootstrapMissionFromIssue,
	executeCommand as executeDaemonOperation,
	evaluateMissionGate,
	getMissionStatus,
	getSessionConsoleState,
	launchTaskSession,
	listOpenGitHubIssues,
	sendSessionInput,
	selectorFromStatus,
} from '@flying-pillow/mission-core';
import { render, useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/solid';
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSXElement, untrack } from 'solid-js';
import { CockpitScreen } from './components/CockpitScreen.js';
import {
	applyCockpitTheme,
	cockpitThemes,
	type CockpitThemeName,
	isCockpitThemeName
} from './components/cockpitTheme.js';
import type { ConsolePanelContent, ConsolePanelTab } from './components/ConsolePanel.js';
import { cockpitTheme } from './components/cockpitTheme.js';
import type { ProgressRailItem, ProgressRailItemState } from './components/ProgressRail.js';
import { ExpandedCommandComposer, type ComposerTab } from './components/ExpandedCommandComposer.js';
import { FlowSummaryPanel } from './components/FlowSummaryPanel.js';
import { SelectPanel } from './components/SelectPanel.js';
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
type CenterPanelMode = 'console' | 'command-select' | 'command-flow' | 'command-flow-editor';
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
	  }
	| {
		id: string;
		label: string;
		kind: 'daemon';
	  };

const missionFocusOrder: FocusArea[] = ['header', 'stages', 'tasks', 'sessions', 'command'];
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
	const [consoleReloadNonce, setConsoleReloadNonce] = createSignal<number>(0);
	const [selectedThemeName, setSelectedThemeName] = createSignal<CockpitThemeName>(initialTheme);
	const [commandFlow, setCommandFlow] = createSignal<CommandFlowState | undefined>();
	const [commandFlowSelectionDraft, setCommandFlowSelectionDraft] = createSignal<string[]>([]);
	const [commandFlowTextValue, setCommandFlowTextValue] = createSignal<string>('');
	const [expandedComposerTab, setExpandedComposerTab] = createSignal<ComposerTab>('write');
	const [lastEvent, setLastEvent] = createSignal<string>('none');
	const [fallbackGitHubUser, setFallbackGitHubUser] = createSignal<string | undefined>();
	const [isGitHubUserProbeInFlight, setIsGitHubUserProbeInFlight] = createSignal<boolean>(false);
	const [fallbackControlBranch, setFallbackControlBranch] = createSignal<string | undefined>();
	const [isControlBranchProbeInFlight, setIsControlBranchProbeInFlight] = createSignal<boolean>(false);
	const [knownAvailableMissions, setKnownAvailableMissions] = createSignal<MissionStatus['availableMissions']>([]);
	const [selectedHeaderTabId, setSelectedHeaderTabId] = createSignal<string | undefined>();
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
	const currentTask = createMemo(() =>
		selectedTask() ?? status().activeTasks?.[0] ?? status().readyTasks?.[0]
	);
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
	const taskItems = createMemo<ProgressRailItem[]>(() =>
		stageTasks().map((task) => ({
			id: task.taskId,
			label: `${String(task.sequence)} ${task.subject}`,
			state: mapTaskState(task.status),
			selected: task.taskId === selectedTaskId(),
			subtitle: task.relativePath
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
		const repoLabel = resolveHeaderRepoLabel(status().control, workspaceContext.repoRoot);
		if (cockpitMode() === 'setup') {
			return `SETUP ${repoLabel}`;
		}
		if (cockpitMode() === 'root') {
			return repoLabel;
		}
		return repoLabel;
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
		buildHeaderStatusLines({
			mode: cockpitMode(),
			status: status(),
			lastEvent: lastEvent(),
			fallbackControlBranch: fallbackControlBranch(),
			workspaceContext,
			selectedTaskLabel: selectedTask()?.subject
		})
	);
	const headerFooterBadges = createMemo(() =>
		buildHeaderFooterBadges({
			mode: cockpitMode(),
			status: status(),
			daemonState: daemonState(),
			fallbackGitHubUser: fallbackGitHubUser(),
			workspaceContext,
			selectedStageLabel: selectedStage()?.stage ?? status().stage,
			selectedTaskLabel: selectedTask()?.subject
		})
	);
	const availableCommands = createMemo<MissionCommandDescriptor[]>(() => {
		const filtered = (status().availableCommands ?? [])
			.filter((command) => {
			if (command.scope === 'mission') {
				return true;
			}
			if (command.scope === 'stage') {
				return command.targetId === selectedStageId();
			}
			if (command.scope === 'task') {
				return command.targetId === selectedTaskId();
			}
			if (command.scope === 'session') {
				return command.targetId === selectedSessionId();
			}
			return false;
			})
			.filter((command) => isCommandVisible(command, cockpitMode(), workspaceContext.kind));
		return [
			...filtered,
			...(workspaceContext.kind === 'control-root' && cockpitMode() === 'mission'
				? [rootCommandDescriptor]
				: []),
			themeCommandDescriptor
		];
	});
	const availableCommandByCommand = createMemo(() => {
		const entries = new Map<string, MissionCommandDescriptor>();
		for (const command of availableCommands()) {
			if (!entries.has(command.command)) {
				entries.set(command.command, command);
			}
		}
		return entries;
	});
	const commandPickerItems = createMemo<CommandItem[]>(() =>
		buildCommandPickerItems(availableCommands(), commandQuery())
	);
	const showCommandPicker = createMemo(
		() => activePicker() === 'command-select' && commandQuery().length > 0
	);
	const selectedCommandPickerItemId = createMemo(() =>
		pickSelectItemId(commandPickerItems(), selectedPickerItemId())
	);
	const centerPanelMode = createMemo<CenterPanelMode>(() => {
		if (isExpandedCommandFlowTextStep()) {
			return 'command-flow-editor';
		}
		if (showCommandFlow()) {
			return 'command-flow';
		}
		if (showCommandPicker()) {
			return 'command-select';
		}
		return 'console';
	});
	const focusOrder = createMemo<FocusArea[]>(() =>
		buildFocusOrder({
			baseOrder: cockpitMode() === 'mission' ? missionFocusOrder : controlFocusOrder,
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
		const enabledCommands = availableCommands()
			.filter((command) => command.enabled)
			.map((command) => command.command);
		const uniqueCommands = [...new Set(enabledCommands)];
		if (uniqueCommands.length === 0) {
			return 'No commands available for the current selection.';
		}
		return `Available: ${uniqueCommands.join(', ')}`;
	});
	const commandDockDescriptor = createMemo<CommandDockDescriptor>(() =>
		buildCommandDockDescriptor({
			commandFlow: currentCommandFlow(),
			currentCommandFlowStep: currentCommandFlowStep(),
			showCommandPicker: showCommandPicker(),
			selectedCommandId: showCommandPicker() ? selectedCommandPickerItemId() : undefined,
			availableCommands: availableCommands(),
			inputValue: inputValue(),
			status: status(),
			selectedConsoleTabKind: inferConsoleTabKindFromId(selectedConsoleTabId()),
			selectedSessionId: selectedSessionId(),
			selectedStageId: selectedStageId(),
			currentTaskLabel: currentTask()?.subject
		})
	);
	const screenTitle = createMemo(() => {
		if (cockpitMode() === 'setup') {
			return resolveHeaderRepoLabel(status().control, workspaceContext.repoRoot);
		}
		if (cockpitMode() === 'root') {
			return resolveHeaderRepoLabel(status().control, workspaceContext.repoRoot);
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
		const stage = selectedStageId();
		const stageArtifact = stage ? stageArtifactProductKey(stage) : undefined;
		const stageArtifactPath = stageArtifact ? status().productFiles?.[stageArtifact] : undefined;

		if (stageArtifact && stageArtifactPath) {
			tabs.push({
				id: createArtifactTabId(stageArtifact),
				label: path.basename(stageArtifactPath),
				kind: 'artifact',
				sourcePath: stageArtifactPath
			});
		}

		const task = selectedTask();
		if (task?.filePath) {
			tabs.push({
				id: createTaskTabId(task.taskId),
				label: task.fileName,
				kind: 'task',
				sourcePath: task.filePath
			});
		}

		for (const session of visibleSessions()) {
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

		tabs.push({
			id: daemonTabId,
			label: 'DAEMON',
			kind: 'daemon'
		});

		return tabs;
	});
	const renderedConsoleTabs = createMemo<ConsolePanelTab[]>(() =>
		consoleTabs().map((tab) => ({ id: tab.id, label: tab.label, kind: tab.kind }))
	);
	const selectedConsoleTab = createMemo(() => {
		const preferredId = pickPreferredConsoleTabId(consoleTabs(), selectedConsoleTabId(), selectedSessionId());
		return consoleTabs().find((tab) => tab.id === preferredId) ?? consoleTabs()[0];
	});
	const consoleContent = createMemo<ConsolePanelContent>(() => {
		const selectedTab = selectedConsoleTab();
		const reloadNonce = consoleReloadNonce();
		void reloadNonce;
		if (!selectedTab || selectedTab.kind === 'daemon') {
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
				lines: buildControlStatusLines(status(), workspaceContext),
				emptyLabel: 'Control status is unavailable.'
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
	const mainPanel = createMemo<JSXElement | undefined>(() => {
		switch (centerPanelMode()) {
			case 'command-flow-editor': {
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
							selectCommandById(itemId, { execute: shouldExecuteCommandSelection(itemId) });
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
	});

	createEffect(() => {
		const nextMissionId = currentMissionId();
		setMarkdownDocumentByPath((current) => (Object.keys(current).length === 0 ? current : {}));
		setConsoleStateBySessionId((current) => (Object.keys(current).length === 0 ? current : {}));
		setSelectedConsoleTabId(undefined);
		setSelectedSessionId(undefined);
		setSelectedTaskId('');
		setSelectedStageId(undefined);
		setLastEvent(nextMissionId ? 'bound' : 'root');
	});

	createEffect(() => {
		setSelectedStageId((current) => pickPreferredStageId(stages(), current, status().stage));
	});

	createEffect(() => {
		setSelectedTaskId((current) => pickPreferredTaskId(stageTasks(), current));
	});

	createEffect(() => {
		setSelectedSessionId((current) => pickPreferredSessionId(visibleSessions(), current));
	});

	createEffect(() => {
		setSelectedConsoleTabId((current) => pickPreferredConsoleTabId(consoleTabs(), current, selectedSessionId()));
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
		void resolveGitHubCliUser(workspaceContext.repoRoot)
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
		void resolveGitBranchName(workspaceContext.repoRoot)
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

	createEffect(() => {
		const currentClient = client();
		if (!currentClient) {
			return;
		}
		const subscription = currentClient.onDidEvent((event) => {
			setLastEvent(event.type);
			if (event.missionId !== currentMissionId()) {
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
			void getSessionConsoleState(currentClient, sessionSelector, session.sessionId)
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

	createEffect(() => {
		const tab = selectedConsoleTab();
		if (!tab) {
			return;
		}
		void reloadConsoleTab(tab);
	});

	onMount(() => {
		renderer.setBackgroundColor(cockpitTheme.background);
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
		if (key.ctrl && key.name === 'p' && canToggleExpandedPreview()) {
			setExpandedComposerTab((current) => (current === 'write' ? 'preview' : 'write'));
			return;
		}
		if (key.name === 'tab' && focusArea() === 'flow' && canToggleExpandedPreview()) {
			setExpandedComposerTab((current) => (current === 'write' ? 'preview' : 'write'));
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
			moveFocus(-1);
			return;
		}
		if (key.name === 'down') {
			if (focusArea() === 'command' && showCommandPicker()) {
				previewCommandPickerSelection(1);
				return;
			}
			moveFocus(1);
			return;
		}
		if (key.name === 'escape' && focusArea() === 'command') {
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
			return;
		}
		if (key.name === 'left') {
			moveSelection(-1);
			return;
		}
		if (key.name === 'right') {
			moveSelection(1);
		}
	});

	function moveFocus(delta: number): void {
		const order = focusOrder();
		const currentIndex = order.indexOf(focusArea());
		const nextIndex = (currentIndex + delta + order.length) % order.length;
		setFocusArea(order[nextIndex] ?? 'command');
	}

	function moveSelection(delta: number): void {
		switch (focusArea()) {
			case 'header': {
				previewHeaderTabSelection(delta);
				break;
			}
			case 'stages': {
				const nextStageId = moveStageSelection(stages(), selectedStageId(), delta);
				selectStage(nextStageId);
				break;
			}
			case 'tasks': {
				const nextTaskId = moveTaskSelection(stageTasks(), selectedTaskId(), delta);
				selectTask(nextTaskId);
				break;
			}
			case 'sessions':
				selectConsoleTab(moveConsoleTabSelection(consoleTabs(), selectedConsoleTabId(), delta));
				break;
			default:
				break;
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
			if (workspaceContext.kind !== 'control-root') {
				appendLog('This cockpit is locked to the current mission worktree. Relaunch from the repository root to browse missions.');
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
			const nextConsole = await getSessionConsoleState(currentClient, missionSelector, tab.sessionId);
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

	function selectStage(stageId: MissionStageId | undefined): void {
		if (!stageId) {
			return;
		}
		setSelectedStageId(stageId);
		const nextStage = stages().find((stage) => stage.stage === stageId);
		const hasTaskFollowUp = (nextStage?.tasks.length ?? 0) > 1;
		setFocusArea(hasTaskFollowUp ? 'tasks' : 'command');
	}

	function selectTask(taskId: string): void {
		if (!taskId) {
			return;
		}
		setSelectedTaskId(taskId);
		const hasSessionFollowUp = sessions().filter((session) => session.taskId === taskId).length > 1;
		setFocusArea(hasSessionFollowUp ? 'sessions' : 'command');
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

	function resolveInputTargetSessionId(): string | undefined {
		return selectedSessionId();
	}

	function openMissionPicker(): void {
		if (workspaceContext.kind !== 'control-root') {
			appendLog('Mission selection is only available from the repository root.');
			return;
		}
		openDaemonCommandFlow('/select', {}, (result) => {
			const missionId = result.status?.missionId;
			return missionId ? `Selected mission ${missionId}.` : 'Selected mission.';
		});
	}

	function openStartFlow(): void {
		openDaemonCommandFlow('/start', {}, (result) => {
			const nextStatus = result.status;
			if (!nextStatus) {
				return 'Mission started.';
			}
			return `Mission ${nextStatus.missionId ?? 'unknown'} started on ${nextStatus.branchRef ?? 'its mission branch'}.`;
		});
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
		const items = buildCommandPickerItems(availableCommands(), query);
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

	function selectCommandById(
		commandId: string,
		options?: { execute?: boolean; items?: CommandItem[] }
	): void {
		const nextCommand = options?.items?.find((item) => item.id === commandId)
			?? commandPickerItems().find((item) => item.id === commandId)
			?? (() => {
				const command = availableCommandByCommand().get(commandId);
				return command
					? {
						id: command.command,
						command: command.command,
						label: command.command,
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

	function openSetupWizard(): void {
		if (!controlStatus()?.settings) {
			appendLog('Mission control status is still loading. Try /status and then /setup again.');
			return;
		}
		openDaemonCommandFlow('/setup', {}, (_result, flowResult) => {
			const fieldStep = flowResult.steps.find(
				(step): step is CommandFlowSelectionValue => step.kind === 'selection' && step.stepId === 'field'
			);
			const label = fieldStep?.optionLabels[0];
			return label ? `${label} saved.` : 'Setting saved.';
		});
	}

	function openDaemonCommandFlow(
		commandText: string,
		executeSelector: MissionSelector = currentMissionSelector() ?? {},
		onCompleteLog?: (result: Awaited<ReturnType<typeof executeDaemonCommandById>>, flowResult: CommandFlowResult) => string | undefined
	): void {
		const command = availableCommandByCommand().get(commandText);
		const definition = buildCommandFlowFromCommand(command, executeSelector, onCompleteLog);
		if (!definition) {
			appendLog(`Mission command ${commandText} is not available right now.`);
			return;
		}
		startCommandFlow(definition);
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
		command: MissionCommandDescriptor | undefined,
		executeSelector: MissionSelector,
		onCompleteLog?: (result: Awaited<ReturnType<typeof executeDaemonCommandById>>, flowResult: CommandFlowResult) => string | undefined
	): CommandFlowDefinition | undefined {
		if (!command?.flow) {
			return undefined;
		}
		const flow = command.flow as MissionCommandFlowDescriptor & {
			actionLabel: string;
			steps: MissionCommandFlowStep[];
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
						availableCommandByCommand().get(command.command),
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
		const nextSelector = selectorFromStatus(nextStatus, fallbackSelector);
		setStatus(nextStatus);
		setSelector(nextSelector);
		return nextSelector;
	}

	function updateMissionSessionRecord(record: MissionAgentSessionRecord): void {
		setStatus((currentStatus) => ({
			...currentStatus,
			agentSessions: upsertSessionRecord(currentStatus.agentSessions, record)
		}));
	}

	async function selectThemeById(themeId: string): Promise<void> {
		if (!isCockpitThemeName(themeId)) {
			appendLog(`Unknown theme '${themeId}'.`);
			return;
		}
		applyCockpitTheme(themeId);
		setSelectedThemeName(themeId);
		setSelectedPickerItemId(themeId);
		appendLog(`Theme set to ${themeId} for this cockpit session.`);
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

	async function refreshMissionStatus(): Promise<void> {
		if (!selector().missionId && !status().missionId) {
			await connectClient({});
			return;
		}
		const currentClient = client() ?? (await connectClient(selector()));
		const missionSelector = currentMissionSelector();
		if (!currentClient || !missionSelector) {
			await connectClient(selector());
			return;
		}
		try {
			const next = await getMissionStatus(currentClient, missionSelector);
			applyMissionStatus(next);
			setDaemonState('connected');
		} catch (error) {
			setDaemonState('degraded');
			appendLog(toErrorMessage(error));
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
		const nextIssues = await listOpenGitHubIssues(currentClient, 20);
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
			const next = await bootstrapMissionFromIssue(currentClient, issueNumber);
			applyMissionStatus(next);
			appendLog(
				`Mission ${next.missionId ?? 'unknown'} bootstrapped from issue ${String(issueNumber)}.`
			);
			return true;
		} catch (error) {
			appendLog(toErrorMessage(error));
			return false;
		}
	}

	async function executeDaemonCommandById(
		commandId: string,
		steps: CommandExecuteStep[],
		nextSelector: MissionSelector = currentMissionSelector() ?? {}
	) {
		const currentClient = client() ?? (await connectClient(nextSelector));
		if (!currentClient) {
			throw new Error('Unable to connect to execute the Mission command.');
		}
		const result = await executeDaemonOperation(currentClient, {
			commandId,
			...(Object.keys(nextSelector).length > 0 ? { selector: nextSelector } : {}),
			steps
		});
		if (result.status) {
			applyMissionStatus(result.status, nextSelector);
			setDaemonState('connected');
		}
		if (result.session) {
			setSelectedSessionId(result.session.sessionId);
			setSelectedConsoleTabId(createSessionTabId(result.session.sessionId));
		}
		return result;
	}

	function currentMissionSelector(): MissionSelector | undefined {
		const missionId = selector().missionId ?? status().missionId;
		return missionId ? { missionId } : undefined;
	}

	async function executeCommand(rawCommand: string): Promise<void> {
		const trimmed = rawCommand.trim();
		if (!trimmed) {
			return;
		}
		setIsRunningCommand(true);
		try {
			if (!trimmed.startsWith('/')) {
				const sessionId = resolveInputTargetSessionId();
				const missionSelector = currentMissionSelector();
				const currentClient = client() ?? (await connectClient(missionSelector ?? selector()));
				if (!sessionId || !currentClient) {
					appendLog('No selected session is available. Use /launch first.');
					return;
				}
				const updatedSession = await sendSessionInput(currentClient, missionSelector, sessionId, trimmed);
				updateMissionSessionRecord(updatedSession);
				appendLog(`Sent input to ${sessionId}.`);
				return;
			}

			const [instruction, ...args] = trimmed.split(/\s+/u);
			if (!instruction) {
				return;
			}
			switch (instruction.toLowerCase()) {
				case '/help':
					appendLogLines([
						'/status',
						'/setup',
						'/theme [ocean|sand]',
						...(workspaceContext.kind === 'control-root' ? ['/root'] : []),
						'/issues',
						'/issue <number>',
						'/start',
						'/select',
						...(status().found ? ['/launch [runtimeId]'] : []),
						'/gate [implement|verify|audit|deliver]',
						'/transition <stage>',
						'/cancel [sessionId]',
						'/terminate [sessionId]',
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
				case '/status':
					await refreshMissionStatus();
					appendLog(describeStatusRefresh(status()));
					return;
					case '/setup':
					case '/init': {
						if (status().found) {
							appendLog('Setup is only available in Mission control. Use /root first.');
							return;
						}
						openSetupWizard();
						return;
					}
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
				case '/start': {
					if (workspaceContext.kind !== 'control-root') {
						appendLog('Mission creation is only available from the repository root.');
						return;
					}
					if (status().found) {
						appendLog('Mission creation is only available in Mission control. Use /root first.');
						return;
					}
						if (cockpitMode() === 'setup') {
							appendLog('Mission setup is incomplete. Run /setup before creating a mission.');
							openSetupWizard();
							return;
						}
					if (controlStatus()?.isGitRepository === false) {
						appendLog('Mission requires a Git repository before creating missions.');
						return;
					}
						if (args.length > 0) {
							appendLog('Usage: /start');
							return;
						}
						openStartFlow();
					return;
				}
				case '/select': {
					if (workspaceContext.kind !== 'control-root') {
						appendLog('Mission selection is only available from the repository root.');
						return;
					}
					if (status().found) {
						appendLog('A mission is already active. Use /root before selecting another mission.');
						return;
					}
						if (args.length > 0) {
							appendLog('Usage: /select');
							return;
						}
						openMissionPicker();
					return;
				}
				case '/launch': {
					const missionSelector = currentMissionSelector();
					const runtimeId = args[0] || undefined;
					const currentClient = client() ?? (await connectClient(missionSelector ?? selector()));
					if (!currentClient) {
						appendLog('Unable to connect to launch an agent session.');
						return;
					}
					if (!missionSelector) {
						appendLog(noMissionSelectedMessage(status()));
						return;
					}
					const task = currentTask();
					if (!task) {
						appendLog('Select a task before launching a session.');
						return;
					}
					const session = runtimeId
						? await launchTaskSession(currentClient, missionSelector, task.taskId, { runtimeId })
						: (await executeDaemonCommandById(`task.launch.${task.taskId}`, [], missionSelector)).session;
					if (!session) {
						appendLog(`Task ${task.taskId} did not produce a launchable session.`);
						return;
					}
					if (runtimeId) {
						setSelectedSessionId(session.sessionId);
						setSelectedConsoleTabId(createSessionTabId(session.sessionId));
						const next = await getMissionStatus(currentClient, missionSelector);
						applyMissionStatus(next);
					}
					appendLog(`Launched ${session.runtimeId} for ${task.subject}.`);
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
					const gate = await evaluateMissionGate(currentClient, missionSelector, intent);
					appendLog(gate.allowed ? `Gate ${intent} passed.` : `Gate ${intent} blocked: ${gate.errors.join(' | ')}`);
					return;
				}
				case '/transition': {
					const nextStage = (args[0] as MissionStageId | undefined) ?? selectedStageId();
					if (!status().found) {
						appendLog(noMissionSelectedMessage(status()));
						return;
					}
					if (!nextStage) {
						appendLog('Usage: /transition <prd|spec|plan|implementation|verification|audit>');
						return;
					}
					const next = (await executeDaemonCommandById(`stage.transition.${nextStage}`, [])).status;
					if (!next) {
						appendLog(`Stage ${nextStage} did not return an updated mission status.`);
						return;
					}
					appendLog(`Transitioned mission to ${next.stage ?? nextStage}.`);
					return;
				}
				case '/cancel': {
					const sessionId = args[0] ?? selectedSessionId();
					if (!sessionId) {
						appendLog('Usage: /cancel <sessionId>');
						return;
					}
					await executeDaemonCommandById(`session.cancel.${sessionId}`, []);
					appendLog(`Cancellation requested for ${sessionId}.`);
					return;
				}
				case '/terminate': {
					const sessionId = args[0] ?? selectedSessionId();
					if (!sessionId) {
						appendLog('Usage: /terminate <sessionId>');
						return;
					}
					await executeDaemonCommandById(`session.terminate.${sessionId}`, []);
					appendLog(`Termination requested for ${sessionId}.`);
					return;
				}
				case '/deliver': {
					if (!status().found) {
						appendLog(noMissionSelectedMessage(status()));
						return;
					}
					const next = (await executeDaemonCommandById('mission.deliver', [])).status;
					if (!next) {
						appendLog('Mission delivery did not return an updated mission status.');
						return;
					}
					appendLog(`Mission delivered at ${next.deliveredAt ?? 'unknown time'}.`);
					return;
				}
				default:
					appendLog(`Unknown command '${trimmed}'. Type /help.`);
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
			<CockpitScreen
				headerPanelTitle={headerPanelTitle()}
				title={screenTitle()}
				headerTabs={headerTabs().map((tab) => ({ id: tab.id, label: tab.label }))}
				headerSelectedTabId={selectedHeaderTabId()}
				headerTabsFocusable={headerTabsFocusable()}
				headerStatusLines={headerStatusLines()}
				headerFooterBadges={headerFooterBadges()}
				showProgressRails={cockpitMode() === 'mission'}
				stageItems={stageItems()}
				taskItems={taskItems()}
				focusArea={focusArea()}
				consoleTabs={renderedConsoleTabs()}
				selectedConsoleTabId={selectedConsoleTab()?.id}
				consoleContent={consoleContent()}
				onConsoleTabSelect={selectConsoleTab}
				mainPanel={mainPanel()}
				commandDockTitle={commandDockDescriptor().title}
				commandDockPlaceholder={commandDockDescriptor().placeholder}
				isRunningCommand={isRunningCommand()}
				inputValue={inputValue()}
				commandHelp={commandHelp()}
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
					const submittedQuery = parseCommandQuery(value);
					const submittedCommandItems = submittedQuery
						? buildCommandPickerItems(availableCommands(), submittedQuery)
						: [];
					const exactCommand = findAvailableCommandByText(availableCommands(), value.trim());
					if (exactCommand) {
						selectCommandById(exactCommand.command, {
							execute: shouldExecuteCommandSelection(exactCommand.command),
							items: submittedCommandItems
						});
						return;
					}
					if (submittedQuery && submittedCommandItems.length > 0) {
						const selectedCommandId = pickSelectItemId(
							submittedCommandItems,
							selectedCommandPickerItemId()
						) ?? submittedCommandItems[0]?.id;
						if (selectedCommandId) {
							selectCommandById(selectedCommandId, {
								execute: shouldExecuteCommandSelection(selectedCommandId),
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
					void executeCommand(value);
				}}
			/>
		</Show>
	);

}

function buildAdaptiveSetupCommandFlowSteps(
	steps: MissionCommandFlowStep[],
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

function moveStageSelection(
	stages: MissionStageStatus[],
	current: MissionStageId | undefined,
	delta: number
): MissionStageId | undefined {
	if (stages.length === 0) {
		return undefined;
	}
	const currentIndex = Math.max(0, stages.findIndex((stage) => stage.stage === current));
	const nextIndex = clampIndex(currentIndex + delta, stages.length);
	return stages[nextIndex]?.stage;
}

function moveTaskSelection(tasks: MissionTaskState[], current: string, delta: number): string {
	if (tasks.length === 0) {
		return '';
	}
	const currentIndex = Math.max(0, tasks.findIndex((task) => task.taskId === current));
	const nextIndex = clampIndex(currentIndex + delta, tasks.length);
	return tasks[nextIndex]?.taskId ?? '';
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

function mapTaskState(state: MissionTaskState['status']): ProgressRailItemState {
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
	if (stage === 'verification') {
		return 'VERIFY';
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
const daemonTabId = 'daemon';

function stageArtifactProductKey(stage: MissionStageId): MissionProductKey | undefined {
	if (stage === 'prd' || stage === 'spec' || stage === 'plan' || stage === 'verification' || stage === 'audit') {
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
	if (tabId === daemonTabId) {
		return 'daemon';
	}
	return undefined;
}

function formatSessionTabLabel(session: MissionAgentSessionRecord): string {
	return `${session.runtimeId} ${session.sessionId.slice(-4)}`;
}

function isPrintableCommandFilterKey(sequence: string | undefined): boolean {
	return typeof sequence === 'string' && /^[ -~]$/u.test(sequence);
}

function buildCommandPickerItems(
	commands: MissionCommandDescriptor[],
	query: string
): CommandItem[] {
	const normalizedQuery = query.toLowerCase();
	const seenCommands = new Set<string>();
	return commands
		.filter((command) => command.enabled)
		.filter((command) => {
			if (seenCommands.has(command.command)) {
				return false;
			}
			seenCommands.add(command.command);
			return true;
		})
		.map((command) => ({
			id: command.command,
			command: command.command,
			label: command.command,
			description: command.label
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
	const seenMissionIds = new Set<string>();
	const activeMissionId = status.missionId?.trim();
	if (activeMissionId) {
		tabs.push({
			id: `mission:${activeMissionId}`,
			label: formatHeaderMissionLabel(activeMissionId, status.title),
			target: { kind: 'mission', missionId: activeMissionId }
		});
		seenMissionIds.add(activeMissionId);
	}
	for (const candidate of status.availableMissions ?? fallbackMissions ?? []) {
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
	return normalized.length <= 22 ? normalized : `${normalized.slice(0, 19)}...`;
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

const themeCommandDescriptor: MissionCommandDescriptor = {
	id: 'builtin:theme',
	label: 'Select cockpit session theme',
	command: '/theme',
	scope: 'mission',
	enabled: true
};

const rootCommandDescriptor: MissionCommandDescriptor = {
	id: 'builtin:root',
	label: 'Return to Mission control',
	command: '/root',
	scope: 'mission',
	enabled: true
};

function isCommandVisible(
	command: MissionCommandDescriptor,
	mode: CockpitMode,
	workspaceKind: MissionWorkspaceContext['kind']
): boolean {
	if (mode === 'setup') {
		return command.command === '/setup' || command.command === '/select';
	}
	if (workspaceKind === 'mission-worktree') {
		return command.command !== '/start' && command.command !== '/select' && command.command !== '/issues';
	}
	if (mode === 'mission') {
		return command.command !== '/start' && command.command !== '/select' && command.command !== '/issues';
	}
	return true;
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

function describeStatusRefresh(status: MissionStatus): string {
	if (status.found) {
		return `Mission ${status.missionId ?? 'unknown'} refreshed.`;
	}
	if (status.operationalMode === 'setup') {
		return 'Mission setup refreshed.';
	}
	return 'Mission control refreshed.';
}

function noMissionSelectedMessage(status: MissionStatus): string {
	if (status.operationalMode === 'setup') {
		return 'Mission setup is incomplete. Run /setup first.';
	}
	return 'No mission is selected. Use /start to create one or /select to open an existing mission.';
}

function describeWorkspaceContext(workspaceContext: MissionWorkspaceContext): string {
	return workspaceContext.kind === 'mission-worktree'
		? `mission worktree ${workspaceContext.missionId}`
		: 'the repository root';
}

function buildControlStatusLines(
	status: MissionStatus,
	workspaceContext: MissionWorkspaceContext
): string[] {
	const control = status.control;
	if (!control) {
		return ['Waiting for daemon control status...'];
	}
	const lines = [
		status.operationalMode === 'setup'
			? 'Finish setup before starting your first mission.'
			: 'Mission control is ready.',
		`Opened from ${describeWorkspaceContext(workspaceContext)}.`,
		'',
		`Files: ${control.initialized ? 'ready' : 'missing'} | Settings: ${control.settingsComplete ? 'ready' : 'needs attention'} | Issue intake: ${controlIssueStatusLabel(control)}`,
		`GitHub auth: ${controlGithubStatusLabel(control)} | Active missions: ${String(control.availableMissionCount)}`
	];
	if (control.githubRepository) {
		lines.push(`GitHub repository: ${control.githubRepository}`);
	}
	for (const notice of [...control.problems, ...control.warnings].slice(0, 4)) {
		lines.push(`* ${notice}`);
	}
	const missions = status.availableMissions ?? [];
	if (missions.length === 0) {
		lines.push(
			status.operationalMode === 'setup'
				? 'No mission worktrees yet. Finish setup, then create your first mission with /start.'
				: 'No mission worktrees yet. Use /start from the repository root to create your first mission.'
		);
		return lines;
	}
	lines.push('Missions:');
	for (const mission of missions.slice(0, 10)) {
		const issueLabel = mission.issueId !== undefined ? `#${String(mission.issueId)} ` : '';
		lines.push(`${issueLabel}${mission.missionId} | ${mission.branchRef}`);
	}
	return lines;
}

function controlIssueStatusLabel(control: MissionStatus['control']): string {
	if (!control?.issuesConfigured) {
		return 'not ready';
	}
	if (control.githubAuthenticated === false) {
		return 'waiting for GitHub auth';
	}
	if (control.githubAuthenticated === true) {
		return 'ready';
	}
	return 'preparing';
}

function controlGithubStatusLabel(control: MissionStatus['control']): string {
	if (control?.githubAuthenticated === true) {
		return 'ok';
	}
	if (control?.githubAuthenticated === false) {
		return 'required';
	}
	return 'n/a';
}

function shouldExecuteCommandSelection(command: string): boolean {
	return command === '/setup'
		|| command === '/init'
		|| command === '/status'
		|| command === '/issues'
		|| command === '/start'
		|| command === '/select'
		|| command === '/root'
		|| command === '/theme'
		|| command === '/sessions'
		|| command === '/clear'
		|| command === '/quit';
}

function buildCommandDockDescriptor(input: {
	commandFlow: CommandFlowState | undefined;
	currentCommandFlowStep: CommandFlowStep | undefined;
	showCommandPicker: boolean;
	selectedCommandId: string | undefined;
	availableCommands: MissionCommandDescriptor[];
	inputValue: string;
	status: MissionStatus;
	selectedConsoleTabKind: ConsoleTabDescriptor['kind'] | undefined;
	selectedSessionId: string | undefined;
	selectedStageId: MissionStageId | undefined;
	currentTaskLabel: string | undefined;
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
	const exactCommand = findAvailableCommandByText(input.availableCommands, input.selectedCommandId ?? input.inputValue.trim());
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
		return describeCommandDockIntent(input.selectedCommandId, input.status, input.selectedStageId, input.currentTaskLabel);
	}
	const trimmed = input.inputValue.trim();
	if (!trimmed) {
		if (input.selectedConsoleTabKind === 'session' && input.selectedSessionId) {
			return {
				title: 'AGENT > SEND',
				placeholder: 'Type a reply for the selected agent session or start a command with /'
			};
		}
		const scope = commandScopeLabel(input.status);
		return {
			title: `${scope} > COMMAND`,
			placeholder: scope === 'MISSION'
				? 'Enter a mission command or agent reply'
				: 'Enter a Mission control command'
		};
	}
	if (!trimmed.startsWith('/')) {
		return {
			title: 'AGENT > SEND',
			placeholder: 'Type a reply for the selected agent session'
		};
	}
	return describeCommandDockIntent(trimmed, input.status, input.selectedStageId, input.currentTaskLabel);
}

function findAvailableCommandByText(
	commands: MissionCommandDescriptor[],
	commandText: string | undefined
): MissionCommandDescriptor | undefined {
	const trimmed = commandText?.trim();
	if (!trimmed) {
		return undefined;
	}
	return commands.find((command) => command.command === trimmed);
}

function buildCommandFlowStep(step: MissionCommandFlowDescriptor['steps'][number]): CommandFlowStep {
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

function buildExecuteCommandSteps(steps: CommandFlowStepValue[]): CommandExecuteStep[] {
	return steps.map((step) =>
		step.kind === 'selection'
			? {
				kind: 'selection',
				stepId: step.stepId,
				optionIds: [...step.optionIds]
			} as unknown as CommandExecuteStep
			: {
				kind: 'text',
				stepId: step.stepId,
				value: step.value
			} as unknown as CommandExecuteStep
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
	selectedStageId: MissionStageId | undefined,
	currentTaskLabel: string | undefined
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
		case '/status':
			return {
				title: `${commandScopeLabel(status)} > REFRESH`,
				placeholder: 'Press Enter to refresh the current daemon snapshot.'
			};
		case '/root':
			return {
				title: 'MISSION > SWITCH',
				placeholder: 'Press Enter to return to Mission control.'
			};
			case '/start':
				return {
					title: 'MISSION > TYPE > START',
					placeholder: 'Press Enter to open the guided mission start flow.'
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
		case '/launch':
			return {
				title: 'AGENT > LAUNCH',
				placeholder: currentTaskLabel
					? `Launch an agent for ${currentTaskLabel}.`
					: 'Launch an agent for the selected task.'
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

function buildHeaderStatusLines(input: {
	mode: CockpitMode;
	status: MissionStatus;
	lastEvent: string;
	fallbackControlBranch: string | undefined;
	workspaceContext: MissionWorkspaceContext;
	selectedTaskLabel: string | undefined;
}): string[] {
	if (input.mode === 'mission') {
		return [
			`mission=${input.status.missionId ?? 'unknown'} | branch=${input.status.branchRef ?? 'unknown'}`,
			`repo=${input.workspaceContext.repoRoot} | task=${input.selectedTaskLabel ?? 'none'}`
		];
	}
	if (input.mode === 'root') {
		return [
			`repo=${input.workspaceContext.repoRoot}`,
			formatControlBranchLabel(input.status.control, input.fallbackControlBranch)
		];
	}
	const control = input.status.control;
	if (!control) {
		return ['Mission control status is loading.'];
	}
	return [
		`repo=${input.workspaceContext.repoRoot}`,
		formatControlBranchLabel(control, input.fallbackControlBranch)
	];
}

function resolvedControlGitHubRepository(control: MissionStatus['control']): string | undefined {
	if (!control || !("githubRepository" in control)) {
		return undefined;
	}
	const repository = control['githubRepository'];
	return typeof repository === 'string' && repository.trim().length > 0 ? repository : undefined;
}

function resolveHeaderRepoLabel(control: MissionStatus['control'], repoRoot: string): string {
	const githubRepository = resolvedControlGitHubRepository(control);
	if (githubRepository) {
		return githubRepository;
	}
	const normalizedRoot = repoRoot.trim();
	return normalizedRoot.length > 0 ? normalizedRoot : 'repo';
}

function buildHeaderFooterBadges(input: {
	mode: CockpitMode;
	status: MissionStatus;
	daemonState: DaemonState;
	fallbackGitHubUser: string | undefined;
	workspaceContext: MissionWorkspaceContext;
	selectedStageLabel: MissionStageId | undefined;
	selectedTaskLabel: string | undefined;
}): Array<{ text: string; tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'; framed?: boolean }> {
	const contextBadge = {
		text: input.workspaceContext.kind === 'mission-worktree' ? 'worktree' : 'repo-root'
	} as const;
	if (input.mode === 'mission') {
		return [
			{ text: `stage ${input.selectedStageLabel ?? input.status.stage ?? 'none'}`, tone: 'accent' },
			{ text: `task ${input.selectedTaskLabel ?? 'none'}` },
			{ text: `branch ${input.status.branchRef ?? 'unknown'}` },
			contextBadge,
			{ text: '●', tone: daemonStateTone(input.daemonState), framed: false }
		];
	}
	const control = input.status.control;
	if (input.mode === 'root') {
		return [
			...buildControlHeaderAgentConnectionBadges(input.status),
			...buildControlHeaderGitHubBadges(control, input.fallbackGitHubUser),
			{ text: '●', tone: daemonStateTone(input.daemonState), framed: false }
		];
	}
	return [
		...buildControlHeaderAgentConnectionBadges(input.status),
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

function formatControlBranchLabel(
	control: MissionStatus['control'],
	fallbackBranch?: string
): string {
	const daemonBranch = control?.currentBranch?.trim();
	const branch = daemonBranch && daemonBranch.length > 0 && daemonBranch !== 'HEAD' && daemonBranch.toLowerCase() !== 'unknown'
		? daemonBranch
		: fallbackBranch?.trim();
	return `branch=${branch && branch.length > 0 ? branch : 'unknown'}`;
}

function buildControlHeaderGitHubBadges(
	control: MissionStatus['control'],
	fallbackGitHubUser?: string
): Array<{ text: string; tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'; framed?: boolean }> {
	if (control?.githubAuthenticated === false) {
		return [];
	}
	const githubUser =
		control?.githubUser?.trim()
			|| parseGitHubUserFromAuthDetail(control?.githubAuthMessage)?.trim()
			|| fallbackGitHubUser?.trim();
	if (githubUser && githubUser.length > 0) {
		return [{ text: githubUser, tone: 'success' }];
	}
	return [];
}

function buildControlHeaderAgentConnectionBadges(
	_status: MissionStatus
): Array<{ text: string; tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'; framed?: boolean }> {
	return [];
}

function upsertSessionRecord(
	sessions: MissionAgentSessionRecord[] | undefined,
	record: MissionAgentSessionRecord
): MissionAgentSessionRecord[] {
	if (!sessions || sessions.length === 0) {
		return [record];
	}
	const next = sessions.slice();
	const existingIndex = next.findIndex((session) => session.sessionId === record.sessionId);
	if (existingIndex >= 0) {
		next[existingIndex] = record;
		return next;
	}
	next.push(record);
	return next;
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
	if (stage === 'prd' || stage === 'spec' || stage === 'plan') {
		return 'implement';
	}
	if (stage === 'implementation') {
		return 'verify';
	}
	if (stage === 'verification') {
		return 'audit';
	}
	return 'deliver';
}
