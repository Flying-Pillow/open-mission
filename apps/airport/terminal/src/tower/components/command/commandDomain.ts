import type {
	MissionStageId,
	OperatorActionDescriptor,
	OperatorStatus,
} from '@flying-pillow/mission-core';
import type { CommandItem, SelectItem } from '../types.js';
import type { TreeTargetKind } from '../mission-control/missionControlDomain.js';
import { buildFlowStepTitle, type CommandFlowState, type CommandFlowStep } from '../flow/flowDomain.js';

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

export type CommandPanelDescriptor = {
	title: string;
	placeholder: string;
};

export type ToolbarCommandSubmitIntent =
	| { kind: 'notify'; message: string }
	| { kind: 'confirm'; commandId: string }
	| { kind: 'cancel-confirmation' }
	| { kind: 'execute'; commandId: string; actionLabel: string };

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
	const normalizedQuery = query.replace(/^\/+/u, '').toLowerCase();
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

export function resolveToolbarCommandSubmitIntent(input: {
	selectedCommand: OperatorActionDescriptor | undefined;
	confirmingCommandId: string | undefined;
	confirmingCommand: OperatorActionDescriptor | undefined;
	confirmationChoice: 'confirm' | 'cancel';
}): ToolbarCommandSubmitIntent {
	if (!input.confirmingCommandId) {
		const selected = input.selectedCommand;
		if (!selected) {
			return { kind: 'notify', message: 'No command is selected.' };
		}
		if (!selected.enabled) {
			return {
				kind: 'notify',
				message: selected.reason ?? `Action ${selected.action} is not available for the selected target.`
			};
		}
		if (selected.ui?.requiresConfirmation === true) {
			return { kind: 'confirm', commandId: selected.id };
		}
		return { kind: 'execute', commandId: selected.id, actionLabel: selected.action };
	}
	if (input.confirmationChoice === 'cancel') {
		return { kind: 'cancel-confirmation' };
	}
	if (!input.confirmingCommand) {
		return { kind: 'notify', message: 'Selected command is no longer available.' };
	}
	return {
		kind: 'execute',
		commandId: input.confirmingCommand.id,
		actionLabel: input.confirmingCommand.action
	};
}

export function describeCommandFlowCompletionMessage(
	command: OperatorActionDescriptor,
	status: OperatorStatus | undefined
): string | undefined {
	if (command.id === 'control.mission.start') {
		if (!status) {
			return 'Mission prepared.';
		}
		if (status.preparation?.kind === 'repository-bootstrap') {
			return `Repository bootstrap prepared on ${status.preparation.branchRef}. PR: ${status.preparation.pullRequestUrl}`;
		}
		if (status.preparation?.kind === 'mission') {
			return `Mission ${status.preparation.missionId} prepared on ${status.preparation.branchRef}. Worktree: ${status.preparation.worktreePath}`;
		}
		return `Mission ${status.missionId ?? 'unknown'} selected on ${status.branchRef ?? 'its mission branch'}.`;
	}
	if (command.id === 'control.mission.select') {
		const missionId = status?.missionId;
		return missionId ? `Selected mission ${missionId}.` : 'Selected mission.';
	}
	if (command.id === 'control.setup.edit') {
		return 'Setting saved.';
	}
	return undefined;
}

export function describeExecutedActionMessage(
	command: OperatorActionDescriptor,
	status: OperatorStatus | undefined
): string {
	if (command.id === 'mission.deliver') {
		return status && isMissionDelivered(status) ? 'Mission delivered.' : 'Mission delivery completed.';
	}
	if (
		command.id.startsWith('task.start.')
		|| command.id.startsWith('task.done.')
		|| command.id.startsWith('task.block.')
		|| command.id.startsWith('task.reopen.')
		|| command.id.startsWith('task.launch.')
	) {
		return `${command.label}${command.targetId ? `: ${command.targetId}` : '.'}`;
	}
	if (command.id.startsWith('session.cancel.')) {
		return `Cancellation requested for ${command.targetId ?? 'session'}.`;
	}
	if (command.id.startsWith('session.terminate.')) {
		return `Termination requested for ${command.targetId ?? 'session'}.`;
	}
	return `Executed ${command.action}.`;
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

export function buildCommandPanelDescriptor(input: {
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

function formatToolbarCommandLabel(command: OperatorActionDescriptor): string {
	if (command.ui?.toolbarLabel) {
		return command.ui.toolbarLabel.trim().toUpperCase();
	}
	const normalized = command.action.trim().replace(/^\/+/u, '').replace(/\s+/gu, ' ');
	return normalized.toUpperCase();
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
		case '/root':
			return {
				title: 'MISSION > SWITCH',
				placeholder: 'Press Enter to return to repository mode.'
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
				placeholder: args.length > 0
					? 'This command is not available with inline arguments.'
					: `Press Enter to run the current command${status.stage ?? selectedStageId ? ` for ${formatDockStageLabel(status.stage ?? selectedStageId)}` : ''}.`
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

function isMissionDelivered(status: OperatorStatus): boolean {
	return Boolean(status.stages?.some((stage) => stage.stage === 'delivery' && stage.status === 'completed'));
}