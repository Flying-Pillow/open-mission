import type { OperatorActionDescriptor, OperatorActionTargetContext, OperatorActionPresentationScope } from '../types.js';

export function resolveAvailableActionsForTargetContext(
	commands: OperatorActionDescriptor[],
	context: OperatorActionTargetContext
): OperatorActionDescriptor[] {
	return commands.filter((command) => matchesOperatorActionTargetContext(command, context));
}

export function matchesOperatorActionTargetContext(
	command: OperatorActionDescriptor,
	context: OperatorActionTargetContext
): boolean {
	switch (command.scope) {
		case 'session':
			return matchesTargetScope(command, context, 'session');
		case 'task':
			return matchesTargetScope(command, context, 'task');
		case 'generation':
			return matchesTargetScope(command, context, 'stage');
		case 'mission':
			return matchesMissionScope(command, context);
	}
	return false;
}

function matchesTargetScope(
	command: OperatorActionDescriptor,
	context: OperatorActionTargetContext,
	scope: 'session' | 'task' | 'stage'
): boolean {
	const contextTargetId = getContextTargetId(context, scope);
	if (!contextTargetId) {
		return false;
	}

	const targetIds = getTargetIdsForScope(command, scope);
	if (targetIds.length === 0) {
		return false;
	}

	return targetIds.includes(contextTargetId);
}

function matchesMissionScope(
	command: OperatorActionDescriptor,
	context: OperatorActionTargetContext
): boolean {
	const presentationTargets = command.presentationTargets ?? [];
	if (presentationTargets.length === 0) {
		return true;
	}

	if (presentationTargets.some((target) => target.scope === 'mission')) {
		return true;
	}

	if (context.sessionId) {
		const sessionIds = getTargetIdsForScope(command, 'session');
		if (sessionIds.length > 0) {
			return sessionIds.includes(context.sessionId);
		}
	}

	if (context.taskId) {
		const taskIds = getTargetIdsForScope(command, 'task');
		if (taskIds.length > 0) {
			return taskIds.includes(context.taskId);
		}
	}

	if (context.stageId) {
		const stageIds = getTargetIdsForScope(command, 'stage');
		if (stageIds.length > 0) {
			return stageIds.includes(context.stageId);
		}
	}

	return true;
}

function getTargetIdsForScope(
	command: OperatorActionDescriptor,
	scope: OperatorActionPresentationScope
): string[] {
	const fromPresentationTargets = (command.presentationTargets ?? [])
		.filter((target) => target.scope === scope && typeof target.targetId === 'string' && target.targetId.length > 0)
		.map((target) => target.targetId as string);

	if (fromPresentationTargets.length > 0) {
		return fromPresentationTargets;
	}

	if (scope === 'stage' && command.scope === 'generation' && command.targetId) {
		return [command.targetId];
	}

	if (scope === 'task' && command.scope === 'task' && command.targetId) {
		return [command.targetId];
	}

	if (scope === 'session' && command.scope === 'session' && command.targetId) {
		return [command.targetId];
	}

	return [];
}

function getContextTargetId(
	context: OperatorActionTargetContext,
	scope: 'session' | 'task' | 'stage'
): string | undefined {
	switch (scope) {
		case 'session':
			return context.sessionId;
		case 'task':
			return context.taskId;
		case 'stage':
			return context.stageId;
	}
	return undefined;
}