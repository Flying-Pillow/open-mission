import {
	matchesOperatorActionTargetContext,
	resolveAvailableActionsForTargetContext,
	type OperatorActionDescriptor,
	type OperatorActionTargetContext
} from '@flying-pillow/mission-core';

export type CommandTargetContext = OperatorActionTargetContext;

export function resolveAvailableCommandsForContext(
	commands: OperatorActionDescriptor[],
	context: CommandTargetContext
): OperatorActionDescriptor[] {
	return resolveAvailableActionsForTargetContext(commands, context);
}

export function resolveToolbarCommandsForContext(
	commands: OperatorActionDescriptor[],
	context: CommandTargetContext
): OperatorActionDescriptor[] {
	return resolveAvailableActionsForTargetContext(commands, context);
}

export function matchesCommandTargetContext(
	command: OperatorActionDescriptor,
	context: CommandTargetContext
): boolean {
	return matchesOperatorActionTargetContext(command, context);
}