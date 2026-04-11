import type { OperatorActionDescriptor, OperatorActionTargetContext, OperatorActionPresentationScope } from '../types.js';

export function resolveAvailableActionsForTargetContext(
	commands: OperatorActionDescriptor[],
	context: OperatorActionTargetContext
): OperatorActionDescriptor[] {
	return orderAvailableActions(
		commands.filter((command) => matchesOperatorActionTargetContext(command, context)),
		context
	);
}

export function orderAvailableActions(
	commands: OperatorActionDescriptor[],
	context?: OperatorActionTargetContext
): OperatorActionDescriptor[] {
	return commands
		.map((command, index) => ({ command, index }))
		.sort((left, right) => {
			const recoveryOrder = compareNumber(getRecoveryRank(left.command), getRecoveryRank(right.command));
			if (recoveryOrder !== 0) {
				return recoveryOrder;
			}

			const enabledOrder = compareNumber(getEnabledRank(left.command), getEnabledRank(right.command));
			if (enabledOrder !== 0) {
				return enabledOrder;
			}

			const affinityOrder = compareNumber(
				getContextAffinityRank(left.command, context),
				getContextAffinityRank(right.command, context)
			);
			if (affinityOrder !== 0) {
				return affinityOrder;
			}

			const scopeOrder = compareNumber(getScopeRank(left.command.scope), getScopeRank(right.command.scope));
			if (scopeOrder !== 0) {
				return scopeOrder;
			}

			return compareNumber(left.index, right.index);
		})
		.map(({ command }) => command);
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

function getRecoveryRank(command: OperatorActionDescriptor): number {
	return command.ordering?.group === 'recovery' ? 0 : 1;
}

function getEnabledRank(command: OperatorActionDescriptor): number {
	return command.enabled ? 0 : 1;
}

function getContextAffinityRank(
	command: OperatorActionDescriptor,
	context?: OperatorActionTargetContext
): number {
	if (!context) {
		return 0;
	}

	const affinityChain: Array<[OperatorActionPresentationScope, string | undefined]> = [];
	if (context.sessionId) {
		affinityChain.push(['session', context.sessionId]);
	}
	if (context.taskId) {
		affinityChain.push(['task', context.taskId]);
	}
	if (context.stageId) {
		affinityChain.push(['stage', context.stageId]);
	}
	affinityChain.push(['mission', undefined]);

	for (let index = 0; index < affinityChain.length; index += 1) {
		const [scope, targetId] = affinityChain[index] ?? [];
		if (scope && matchesAffinityScope(command, scope, targetId)) {
			return index;
		}
	}

	return affinityChain.length;
}

function matchesAffinityScope(
	command: OperatorActionDescriptor,
	scope: OperatorActionPresentationScope,
	targetId: string | undefined
): boolean {
	if (scope === 'mission') {
		return command.scope === 'mission'
			|| command.presentationTargets?.some((target) => target.scope === 'mission') === true;
	}

	if (!targetId) {
		return false;
	}

	return getTargetIdsForScope(command, scope).includes(targetId);
}

function getScopeRank(scope: OperatorActionDescriptor['scope']): number {
	switch (scope) {
		case 'session': return 0;
		case 'task': return 1;
		case 'generation': return 2;
		case 'mission': return 3;
	}
	return 4;
}

function compareNumber(left: number, right: number): number {
	return left - right;
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