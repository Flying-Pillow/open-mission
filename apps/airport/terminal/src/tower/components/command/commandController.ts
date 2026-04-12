import {
	DaemonApi,
	type DaemonClient,
	type MissionStageId,
	type OperatorActionDescriptor,
	type OperatorActionQueryContext,
	type OperatorStatus,
} from '@flying-pillow/mission-core';
import { createEffect, createMemo, createSignal, type Accessor } from 'solid-js';
import type { CommandItem, FocusArea, TowerKeyEvent } from '../types.js';
import type { TreeTargetKind } from '../mission-control/missionControlDomain.js';
import type { FlowController } from '../flow/flowController.js';
import type { CommandFlowDefinition } from '../flow/flowDomain.js';
import {
	buildCommandPanelDescriptor,
	buildCommandPickerItems,
	buildToolbarCommandItems,
	findAvailableCommandByText,
	isPrintableCommandFilterKey,
	normalizeCommandInputValue,
	parseCommandQuery,
	pickPreferredToolbarCommandId,
	pickSelectItemId,
	resolveToolbarCommandSubmitIntent,
	type CommandPanelDescriptor,
	type CommandToolbarItem,
} from './commandDomain.js';

type TowerMode = 'repository' | 'mission';
type PickerMode = 'command-select';

type CommandTargetDescriptor = {
	sessionId?: string;
	stageId?: MissionStageId;
	targetLabel?: string;
	targetKind?: TreeTargetKind;
};

type CommandControllerOptions = {
	client: Accessor<DaemonClient | undefined>;
	towerMode: Accessor<TowerMode>;
	currentMissionId: Accessor<string | undefined>;
	selectedMissionMatchesLoaded: Accessor<boolean>;
	commandTargetContext: Accessor<OperatorActionQueryContext>;
	status: Accessor<OperatorStatus>;
	canSendSessionText: Accessor<boolean>;
	selectedCommandTargetDescriptor: Accessor<CommandTargetDescriptor>;
	focusArea: Accessor<FocusArea>;
	onFocusAreaChange: (area: FocusArea) => void;
	flowController: FlowController;
	isRunningCommand: Accessor<boolean>;
	buildCommandFlowFromCommand: (command: OperatorActionDescriptor) => CommandFlowDefinition | undefined;
	onInvokeAction: (actionId: string, commandTextOverride?: string) => void;
	onExecuteOperatorInput: (commandText: string) => Promise<void> | void;
	onSubmitFlowTextStep: (value: string) => Promise<void> | void;
	onNoCommandsAvailable: () => void;
	onNotify: (message: string) => void;
	onExecuteToolbarAction: (actionId: string) => Promise<void> | void;
};

export function useCommandController(options: CommandControllerOptions) {
	const [inputValue, setInputValue] = createSignal<string>('');
	const [activePicker, setActivePicker] = createSignal<PickerMode | undefined>();
	const [commandPickerQuery, setCommandPickerQuery] = createSignal<string>('');
	const [selectedPickerItemId, setSelectedPickerItemId] = createSignal<string | undefined>();
	const [selectedCommandId, setSelectedCommandId] = createSignal<string | undefined>();
	const [selectedToolbarCommandId, setSelectedToolbarCommandId] = createSignal<string | undefined>();
	const [confirmingToolbarCommandId, setConfirmingToolbarCommandId] = createSignal<string | undefined>();
	const [toolbarConfirmationChoice, setToolbarConfirmationChoice] = createSignal<'confirm' | 'cancel'>('confirm');
	const [availableActions, setAvailableActions] = createSignal<OperatorActionDescriptor[]>([]);
	let availableActionsQueryVersion = 0;
	let lastActionsQueryKey: string | undefined;

	const currentCommandFlow = options.flowController.flow;
	const currentCommandFlowStep = options.flowController.currentStep;
	const isMissionFlowTextStep = options.flowController.isMissionTextStep;
    const availableCommandById = createMemo(() => {
		const entries = new Map<string, OperatorActionDescriptor>();
		for (const command of availableActions()) {
			entries.set(command.id, command);
		}
		return entries;
	});
	const toolbarCommands = createMemo<CommandToolbarItem[]>(() =>
		buildToolbarCommandItems(availableActions())
	);
	const selectedToolbarCommand = createMemo(() =>
		availableCommandById().get(selectedToolbarCommandId() ?? '')
	);
	const selectedCommand = createMemo(() =>
		availableCommandById().get(selectedCommandId() ?? '')
	);
	const commandInputQuery = createMemo(() => commandPickerQuery());
	const commandPickerItems = createMemo<CommandItem[]>(() =>
		buildCommandPickerItems(availableActions(), commandInputQuery())
	);
	const showCommandPicker = createMemo(() => commandInputQuery().length > 0);
	const selectedCommandPickerItemId = createMemo(() =>
		pickSelectItemId(commandPickerItems(), selectedPickerItemId())
	);
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
			status: options.status(),
			canSendSessionText: options.canSendSessionText(),
			selectedSessionId: options.selectedCommandTargetDescriptor().sessionId,
			selectedStageId: options.selectedCommandTargetDescriptor().stageId,
			selectedTreeTargetTitle: options.selectedCommandTargetDescriptor().targetLabel,
			selectedTreeTargetKind: options.selectedCommandTargetDescriptor().targetKind
		})
	);
	const commandPanelMode = createMemo<'input' | 'toolbar'>(() => {
		if (isMissionFlowTextStep()) {
			return 'input';
		}
		if (options.canSendSessionText()) {
			return 'input';
		}
		return 'toolbar';
	});
	const commandPanelInputValue = createMemo(() =>
		isMissionFlowTextStep() ? options.flowController.textValue() : inputValue()
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
		options.isRunningCommand() || options.flowController.isRunning()
	);

	createEffect(() => {
		const currentClient = options.client();
		const mode = options.towerMode();
		const missionId = options.currentMissionId();
		const context = options.commandTargetContext();
		const shouldQueryActions =
			options.focusArea() === 'command'
			|| activePicker() === 'command-select'
			|| currentCommandFlow() !== undefined;
		if (!currentClient) {
			setAvailableActions([]);
			lastActionsQueryKey = undefined;
			return;
		}
		if (!shouldQueryActions) {
			return;
		}
		if (mode === 'mission' && (!missionId || !options.selectedMissionMatchesLoaded())) {
			setAvailableActions([]);
			lastActionsQueryKey = undefined;
			return;
		}
		const queryKey = JSON.stringify({
			mode,
			missionId: mode === 'mission' ? missionId : undefined,
			context: mode === 'mission' ? context : undefined
		});
		if (queryKey === lastActionsQueryKey) {
			return;
		}
		lastActionsQueryKey = queryKey;
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
					if (lastActionsQueryKey === queryKey) {
						lastActionsQueryKey = undefined;
					}
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
		const owner = options.flowController.owner();
		if (!owner) {
			return;
		}
		if (owner === 'repository' && options.towerMode() !== 'repository') {
			resetCommandFlow({ clearCommandInput: true });
			closeCommandPicker({ clearCommandInput: true });
			return;
		}
		if (owner === 'mission' && options.towerMode() !== 'mission') {
			resetCommandFlow({ clearCommandInput: true });
			closeCommandPicker({ clearCommandInput: true });
		}
	});

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
		const items = buildCommandPickerItems(availableActions(), query);
		setActivePicker('command-select');
		setSelectedPickerItemId((current) => pickSelectItemId(items, current));
		options.onFocusAreaChange('command');
	}

	function closeCommandPicker(config?: { clearCommandInput?: boolean }): void {
		setActivePicker(undefined);
		setCommandPickerQuery('');
		if (config?.clearCommandInput) {
			setInputValue('');
		}
	}

	function resetCommandFlow(config?: { clearCommandInput?: boolean }): void {
		options.flowController.reset();
		if (config?.clearCommandInput) {
			setInputValue('');
		}
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
		options.flowController.start(definition);
		if (options.towerMode() === 'repository') {
			options.onFocusAreaChange('flow');
			return;
		}
		options.onFocusAreaChange(firstStep.kind === 'selection' ? 'flow' : 'command');
	}

	function invokeSelectedActionById(actionId: string, commandTextOverride?: string): void {
		setInputValue('');
		setSelectedCommandId(actionId);
		closeCommandPicker({ clearCommandInput: true });
		options.onInvokeAction(actionId, commandTextOverride);
	}

	function selectCommandById(
		commandId: string,
		config?: { execute?: boolean; fromPicker?: boolean; items?: CommandItem[] }
	): void {
		const nextCommand = config?.items?.find((item) => item.id === commandId)
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
		if (descriptor && !descriptor.enabled) {
			options.onNotify(descriptor.reason ?? `Action ${descriptor.action} is not available for the selected target.`);
			return;
		}
		setSelectedPickerItemId(commandId);
		if (config?.execute) {
			invokeSelectedActionById(commandId, nextCommand.command);
			return;
		}
		resetCommandFlow();
		if (descriptor?.flow && descriptor.flow.steps.length > 0) {
			const definition = options.buildCommandFlowFromCommand(descriptor);
			if (definition) {
				closeCommandPicker({ clearCommandInput: true });
				startCommandFlow(definition);
				return;
			}
		}
		if (config?.fromPicker) {
			invokeSelectedActionById(commandId, nextCommand.command);
			return;
		}
		setSelectedCommandId(commandId);
		setInputValue('');
		closeCommandPicker();
	}

	function highlightCommandPickerItem(commandId: string): void {
		setSelectedPickerItemId(commandId);
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

	function moveCommandPickerSelection(delta: number): void {
		const items = commandPickerItems();
		if (items.length === 0) {
			setSelectedPickerItemId(undefined);
			return;
		}
		const currentId = pickSelectItemId(items, selectedCommandPickerItemId()) ?? items[0]?.id;
		const currentIndex = Math.max(0, items.findIndex((item) => item.id === currentId));
		const nextIndex = (currentIndex + delta + items.length) % items.length;
		setSelectedPickerItemId(items[nextIndex]?.id);
	}

	function moveToolbarConfirmationSelection(delta: number): void {
		if (delta === 0) {
			return;
		}
		setToolbarConfirmationChoice((current) => (current === 'confirm' ? 'cancel' : 'confirm'));
	}

	function openToolbarConfirmation(): void {
		const command = selectedToolbarCommand();
		if (!command || !command.enabled) {
			return;
		}
		setConfirmingToolbarCommandId(command.id);
		setToolbarConfirmationChoice('confirm');
	}

	function clearToolbarConfirmation(): void {
		setConfirmingToolbarCommandId(undefined);
		setToolbarConfirmationChoice('confirm');
	}

	function submitToolbarConfirmation(): void {
		const confirmingCommandId = confirmingToolbarCommandId();
		const intent = resolveToolbarCommandSubmitIntent({
			selectedCommand: selectedToolbarCommand(),
			confirmingCommandId,
			confirmingCommand: confirmingCommandId
				? availableCommandById().get(confirmingCommandId)
				: undefined,
			confirmationChoice: toolbarConfirmationChoice()
		});

		switch (intent.kind) {
			case 'notify':
				options.onNotify(intent.message);
				return;
			case 'confirm':
				setConfirmingToolbarCommandId(intent.commandId);
				setToolbarConfirmationChoice('confirm');
				return;
			case 'cancel-confirmation':
				clearToolbarConfirmation();
				return;
			case 'execute':
				clearToolbarConfirmation();
				options.onNotify(`Executing ${intent.actionLabel}.`);
				void options.onExecuteToolbarAction(intent.commandId);
				return;
		}
	}

	function buildSelectedActionInput(argumentValue: string): string {
		const commandText = selectedCommand()?.action?.trim();
		const argsText = argumentValue.trim();
		if (!commandText) {
			return argsText;
		}
		return argsText.length > 0 ? `${commandText} ${argsText}` : commandText;
	}

	function handlePanelInputChange(value: string): void {
		if (isMissionFlowTextStep()) {
			options.flowController.setTextValue(value);
			return;
		}
		if (!selectedCommandId()) {
			const normalizedFilter = value.startsWith('/')
				? normalizeCommandInputValue(value).replace(/^\//u, '')
				: value;
			setInputValue(normalizedFilter);
			updateCommandPicker(normalizedFilter);
			return;
		}
		setInputValue(value);
	}

	function handlePanelInputSubmit(submittedValue?: string): void {
		const value = typeof submittedValue === 'string' ? submittedValue : commandPanelInputValue();
		if (isMissionFlowTextStep()) {
			options.flowController.setTextValue(value);
			void options.onSubmitFlowTextStep(value);
			return;
		}
		if (showCommandPicker()) {
			const exactCommand = findAvailableCommandByText(availableActions(), commandInputQuery());
			if (exactCommand) {
				setInputValue('');
				closeCommandPicker({ clearCommandInput: true });
				void options.onExecuteOperatorInput(exactCommand.action);
				return;
			}
			const submittedCommandItems = commandPickerItems();
			const nextSelectedCommandId = pickSelectItemId(
				submittedCommandItems,
				selectedCommandPickerItemId()
			) ?? submittedCommandItems[0]?.id;
			if (nextSelectedCommandId) {
				selectCommandById(nextSelectedCommandId, {
					items: submittedCommandItems,
					fromPicker: true
				});
			} else {
				setInputValue('');
				closeCommandPicker({ clearCommandInput: true });
				void options.onExecuteOperatorInput(commandInputQuery());
			}
			return;
		}
		if (!selectedCommandId()) {
			const submittedQuery = commandInputQuery();
			const exactCommand = findAvailableCommandByText(availableActions(), submittedQuery);
			if (exactCommand) {
				setInputValue('');
				void options.onExecuteOperatorInput(exactCommand.action);
				return;
			}
			const submittedCommandItems = submittedQuery
				? buildCommandPickerItems(availableActions(), submittedQuery)
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
			options.onNoCommandsAvailable();
			return;
		}
		const commandLine = buildSelectedActionInput(value.trim());
		setInputValue('');
		void options.onExecuteOperatorInput(commandLine);
	}

	function handlePanelKeyDown(event: TowerKeyEvent): void {
		if (event.sequence === '/' && !isMissionFlowTextStep()) {
			event.preventDefault();
			event.stopPropagation();
			openCommandPickerShortcut();
			return;
		}
		if (options.focusArea() !== 'command') {
			return;
		}
		if (commandPanelMode() === 'toolbar') {
			if (event.name === 'left') {
				event.preventDefault();
				event.stopPropagation();
				if (confirmingToolbarCommandId()) {
					moveToolbarConfirmationSelection(-1);
				} else {
					moveToolbarCommandSelection(-1);
				}
				return;
			}
			if (event.name === 'right') {
				event.preventDefault();
				event.stopPropagation();
				if (confirmingToolbarCommandId()) {
					moveToolbarConfirmationSelection(1);
				} else {
					moveToolbarCommandSelection(1);
				}
				return;
			}
			if (event.name === 'space' || event.name === 'enter' || event.name === 'return') {
				event.preventDefault();
				event.stopPropagation();
				submitToolbarConfirmation();
				return;
			}
			if (event.name === 'escape' && confirmingToolbarCommandId()) {
				event.preventDefault();
				event.stopPropagation();
				clearToolbarConfirmation();
			}
			return;
		}
		if (event.name === 'escape') {
			event.preventDefault();
			event.stopPropagation();
			if (activePicker() === 'command-select') {
				closeCommandPicker({ clearCommandInput: commandInputQuery() === '/' });
				return;
			}
			if (isMissionFlowTextStep()) {
				resetCommandFlow({ clearCommandInput: true });
				options.onFocusAreaChange('command');
				return;
			}
			if (selectedCommandId() && inputValue().trim().length === 0) {
				setSelectedCommandId(undefined);
				updateCommandPicker('');
				options.onFocusAreaChange('command');
				return;
			}
			setInputValue('');
			options.onFocusAreaChange('command');
			return;
		}
		if (activePicker() === 'command-select' && showCommandPicker()) {
			if (event.name === 'up') {
				event.preventDefault();
				event.stopPropagation();
				moveCommandPickerSelection(-1);
				return;
			}
			if (event.name === 'down') {
				event.preventDefault();
				event.stopPropagation();
				moveCommandPickerSelection(1);
				return;
			}
		}
	}

	function handleCommandPickerKeyDown(event: TowerKeyEvent): void {
		if (event.name === 'enter' || event.name === 'return') {
			event.preventDefault();
			event.stopPropagation();
			const selectedItemId = selectedCommandPickerItemId() ?? commandPickerItems()[0]?.id;
			if (selectedItemId) {
				selectCommandById(selectedItemId, { fromPicker: true });
			}
			return;
		}
		if (event.name === 'escape') {
			event.preventDefault();
			event.stopPropagation();
			closeCommandPicker({ clearCommandInput: commandInputQuery() === '/' });
			return;
		}
		if (event.name === 'backspace') {
			event.preventDefault();
			event.stopPropagation();
			popCommandPickerFilter();
			return;
		}
		if (event.sequence === '/') {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (typeof event.sequence === 'string' && isPrintableCommandFilterKey(event.sequence)) {
			event.preventDefault();
			event.stopPropagation();
			appendCommandPickerFilter(event.sequence);
		}
	}

	return {
		inputValue,
		setInputValue,
		activePicker,
		commandPickerQuery,
		selectedPickerItemId,
		selectedCommandId,
		setSelectedCommandId,
		selectedToolbarCommandId,
		confirmingToolbarCommandId,
		toolbarConfirmationChoice,
		availableActions,
		availableCommandById,
		toolbarCommands,
		selectedToolbarCommand,
		selectedCommand,
		commandInputQuery,
		commandPickerItems,
		showCommandPicker,
		selectedCommandPickerItemId,
		commandPanelDescriptor,
		commandPanelMode,
		commandPanelInputValue,
		commandPanelPrefix,
		isCommandInteractionRunning,
		openCommandPickerShortcut,
		appendCommandPickerFilter,
		popCommandPickerFilter,
		updateCommandPicker,
		closeCommandPicker,
		resetCommandFlow,
		startCommandFlow,
		selectCommandById,
		highlightCommandPickerItem,
		moveCommandPickerSelection,
		moveToolbarCommandSelection,
		moveToolbarConfirmationSelection,
		openToolbarConfirmation,
		clearToolbarConfirmation,
		submitToolbarConfirmation,
		handlePanelInputChange,
		handlePanelInputSubmit,
		handlePanelKeyDown,
		handleCommandPickerKeyDown,
	};
}