import type { OperatorActionDescriptor } from '@flying-pillow/mission-core';
import { createEffect, createMemo, createSignal, type Accessor } from 'solid-js';
import type { CommandItem } from '../types.js';
import {
	buildCommandPickerItems,
	movePickerSelection,
	pickSelectItemId,
} from './commandDomain.js';

type CreateCommandControllerOptions = {
	availableActions: Accessor<OperatorActionDescriptor[]>;
};

export type CommandController = ReturnType<typeof createCommandController>;

export function createCommandController(options: CreateCommandControllerOptions) {
	const [inputValue, setInputValue] = createSignal<string>('');
	const [selectedCommandId, setSelectedCommandId] = createSignal<string | undefined>();
	const [pickerOpen, setPickerOpen] = createSignal<boolean>(false);
	const [pickerQuery, setPickerQuery] = createSignal<string>('');
	const [selectedPickerItemId, setSelectedPickerItemId] = createSignal<string | undefined>();

	const pickerItems = createMemo<CommandItem[]>(() =>
		buildCommandPickerItems(options.availableActions(), pickerQuery())
	);
	const selectedCommand = createMemo(() =>
		options.availableActions().find((command) => command.id === selectedCommandId())
	);
	const selectedCommandText = createMemo(() => selectedCommand()?.action);
	const cycleItems = createMemo<CommandItem[]>(() =>
		buildCommandPickerItems(options.availableActions(), '')
	);
	const isPickerOpen = createMemo(() => pickerOpen());
	const activePickerItemId = createMemo(() =>
		pickSelectItemId(pickerItems(), selectedPickerItemId())
	);
	const exactCommand = createMemo(() => selectedCommand());

	createEffect(() => {
		if (!isPickerOpen()) {
			return;
		}
		setSelectedPickerItemId((current) => pickSelectItemId(pickerItems(), current));
	});

	function setInput(rawValue: string): string {
		setInputValue(rawValue);
		return rawValue;
	}

	function setInputWithoutPicker(value: string): void {
		setInputValue(value);
	}

	function setPickerFilter(value: string): string {
		setPickerOpen(true);
		setPickerQuery(value);
		setSelectedPickerItemId((current) => pickSelectItemId(buildCommandPickerItems(options.availableActions(), value), current));
		return value;
	}

	function appendPickerFilter(value: string): string {
		return setPickerFilter(`${pickerQuery()}${value}`);
	}

	function popPickerFilter(): string {
		const nextValue = pickerQuery().slice(0, -1);
		setPickerQuery(nextValue);
		setSelectedPickerItemId((current) => pickSelectItemId(buildCommandPickerItems(options.availableActions(), nextValue), current));
		return nextValue;
	}

	function syncPickerToInput(value: string): void {
		setPickerFilter(value);
	}

	function seedSlashCommand(): void {
		setPickerOpen(true);
		setPickerQuery('');
		setSelectedPickerItemId((current) => pickSelectItemId(buildCommandPickerItems(options.availableActions(), ''), current));
	}

	function clearInput(): void {
		setInputValue('');
	}

	function clearCommandSelection(): void {
		setSelectedCommandId(undefined);
	}

	function clearComposer(): void {
		clearInput();
		clearCommandSelection();
	}

	function highlightPickerItem(commandId: string): void {
		setSelectedPickerItemId(commandId);
	}

	function closePicker(options?: { clearInput?: boolean }): void {
		setPickerOpen(false);
		setPickerQuery('');
		setSelectedPickerItemId(undefined);
		if (options?.clearInput) {
			clearInput();
		}
	}

	function previewPickerSelection(delta: number): CommandItem | undefined {
		const nextId = movePickerSelection(pickerItems(), selectedPickerItemId(), delta);
		if (!nextId) {
			return undefined;
		}
		setSelectedPickerItemId(nextId);
		return pickerItems().find((item) => item.id === nextId);
	}

	function cycleInput(delta: number): CommandItem | undefined {
		const items = cycleItems();
		if (items.length === 0) {
			return undefined;
		}
		const currentText = selectedCommandText()?.trim() ?? '';
		const currentIndex = items.findIndex((item) => item.command === currentText);
		const seedIndex = currentIndex >= 0 ? currentIndex : 0;
		const nextIndex = (seedIndex + delta + items.length) % items.length;
		const nextCommand = items[nextIndex];
		if (!nextCommand) {
			return undefined;
		}
		setSelectedCommandId(nextCommand.id);
		setSelectedPickerItemId(nextCommand.id);
		clearInput();
		return nextCommand;
	}

	function resolveCommandSelection(commandId: string, items?: CommandItem[]): CommandItem | undefined {
		const nextCommand = items?.find((item) => item.id === commandId)
			?? pickerItems().find((item) => item.id === commandId)
			?? (() => {
				const command = options.availableActions().find((item) => item.id === commandId);
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
			return undefined;
		}
		setSelectedPickerItemId(commandId);
		return nextCommand;
	}

	function applyResolvedSelection(command: CommandItem, options?: { preserveInput?: boolean }): void {
		setSelectedCommandId(command.id);
		if (!options?.preserveInput) {
			clearInput();
		}
		closePicker();
	}

	function composedCommandText(): string {
		const commandText = selectedCommandText()?.trim();
		const suffix = inputValue().trim();
		if (!commandText) {
			return suffix;
		}
		return suffix.length > 0 ? `${commandText} ${suffix}` : commandText;
	}

	return {
		inputValue,
		selectedCommandId,
		selectedCommandText,
		pickerQuery,
		pickerItems,
		cycleItems,
		isPickerOpen,
		activePickerItemId,
		exactCommand,
		setInput,
		setInputWithoutPicker,
		setPickerFilter,
		appendPickerFilter,
		popPickerFilter,
		syncPickerToInput,
		seedSlashCommand,
		clearInput,
		clearCommandSelection,
		clearComposer,
		highlightPickerItem,
		closePicker,
		previewPickerSelection,
		cycleInput,
		resolveCommandSelection,
		applyResolvedSelection,
		composedCommandText,
	};
}