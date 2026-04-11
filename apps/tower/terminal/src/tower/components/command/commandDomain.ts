import type { OperatorActionDescriptor } from '@flying-pillow/mission-core';
import type { CommandItem, SelectItem } from '../types.js';

// Tower terminology:
// - action: canonical daemon descriptor (OperatorActionDescriptor)
// - command item: Tower picker projection of an action
// - command query/input: operator-typed text used to search for or invoke an action by its action text
// The picker and toolbar should adapt daemon actions; they should not define business operations.

export type CommandToolbarItem = {
	id: string;
	label: string;
	enabled: boolean;
	reason?: string;
	requiresConfirmation?: boolean;
	confirmationPrompt?: string;
};

export function isCommandQueryInput(value: string): boolean {
	return /^\/\S*$/u.test(value.trim());
}

export function parseCommandQuery(value: string): string {
	const trimmed = value.trim();
	return isCommandQueryInput(trimmed) ? trimmed : '';
}

export function normalizeCommandInputValue(value: string): string {
	if (value.startsWith('/')) {
		return value.replace(/^\/+/u, '/');
	}
	return value;
}

export function isPrintableCommandFilterKey(sequence: string | undefined): boolean {
	return typeof sequence === 'string' && /^[ -~]$/u.test(sequence);
}

export function buildCommandPickerItems(
	commands: OperatorActionDescriptor[],
	query: string,
	options?: { includeDisabled?: boolean }
): CommandItem[] {
	const normalizedQuery = query.toLowerCase();
	const includeDisabled = options?.includeDisabled ?? false;
	// Preserve daemon order exactly. Tower may project and query-filter the list,
	// but ordering and context filtering remain daemon responsibilities.
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
				commandText.includes(normalizedQuery)
				|| labelText.includes(normalizedQuery)
				|| descriptionText.includes(normalizedQuery)
			);
		});
}

export function buildToolbarCommandItems(commands: OperatorActionDescriptor[]): CommandToolbarItem[] {
	// Preserve daemon order exactly. Toolbar projection must not introduce its own ranking.
	return commands.map((command) => ({
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
	}));
}

function formatCommandDescription(command: OperatorActionDescriptor): string {
	const baseDescription = command.targetId ? `${command.label} [${command.targetId}]` : command.label;
	if (command.enabled || !command.reason) {
		return baseDescription;
	}
	return `${baseDescription} - Unavailable: ${command.reason}`;
}

export function findAvailableCommandByText(
	commands: OperatorActionDescriptor[],
	commandText: string | undefined
): OperatorActionDescriptor | undefined {
	const trimmed = commandText?.trim();
	if (!trimmed) {
		return undefined;
	}
	return commands.find((command) => command.action === trimmed);
}

export function pickSelectItemId(items: SelectItem[], current: string | undefined): string | undefined {
	if (items.length === 0) {
		return undefined;
	}
	if (current && items.some((item) => item.id === current)) {
		return current;
	}
	return items[0]?.id;
}

export function pickPreferredToolbarCommandId(
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

export function movePickerSelection(items: SelectItem[], current: string | undefined, delta: number): string | undefined {
	if (items.length === 0) {
		return undefined;
	}
	const currentId = pickSelectItemId(items, current);
	const currentIndex = Math.max(0, items.findIndex((item) => item.id === currentId));
	const nextIndex = (currentIndex + delta + items.length) % items.length;
	return items[nextIndex]?.id;
}

function formatToolbarCommandLabel(command: OperatorActionDescriptor): string {
	if (command.ui?.toolbarLabel) {
		return command.ui.toolbarLabel.trim().toUpperCase();
	}
	const normalized = command.action.trim().replace(/^\/+/u, '').replace(/\s+/gu, ' ');
	return normalized.toUpperCase();
}