import type { MissionActionDescriptor } from '@flying-pillow/mission-core';
import type { CommandItem, SelectItem } from '../types.js';

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
	commands: MissionActionDescriptor[],
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
				commandText.includes(normalizedQuery)
				|| labelText.includes(normalizedQuery)
				|| descriptionText.includes(normalizedQuery)
			);
		});
}

function formatCommandDescription(command: MissionActionDescriptor): string {
	const baseDescription = command.targetId ? `${command.label} [${command.targetId}]` : command.label;
	if (command.enabled || !command.reason) {
		return baseDescription;
	}
	return `${baseDescription} - Unavailable: ${command.reason}`;
}

export function findAvailableCommandByText(
	commands: MissionActionDescriptor[],
	commandText: string | undefined
): MissionActionDescriptor | undefined {
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

export function movePickerSelection(items: SelectItem[], current: string | undefined, delta: number): string | undefined {
	if (items.length === 0) {
		return undefined;
	}
	const currentId = pickSelectItemId(items, current);
	const currentIndex = Math.max(0, items.findIndex((item) => item.id === currentId));
	const nextIndex = (currentIndex + delta + items.length) % items.length;
	return items[nextIndex]?.id;
}