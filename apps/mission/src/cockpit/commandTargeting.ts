import type { MissionActionDescriptor, MissionStageId } from '@flying-pillow/mission-core';

export type CommandTargetContext = {
	stageId: MissionStageId | undefined;
	taskId: string | undefined;
	sessionId: string | undefined;
};

export function resolveAvailableCommandsForContext(
	commands: MissionActionDescriptor[],
	context: CommandTargetContext
): MissionActionDescriptor[] {
	return commands.filter((command) => matchesCommandTargetContext(command, context));
}

export function resolveToolbarCommandsForContext(
	commands: MissionActionDescriptor[],
	context: CommandTargetContext
): MissionActionDescriptor[] {
	return commands.filter((command) => matchesCommandTargetContext(command, context));
}

export function matchesCommandTargetContext(
	command: MissionActionDescriptor,
	context: CommandTargetContext
): boolean {
	const presentationTargets = command.presentationTargets ?? [];
	const hasActiveContext = Boolean(context.sessionId || context.taskId || context.stageId);

	if (presentationTargets.length > 0) {
		const scopeToMatch = resolvePresentationScope(presentationTargets, context);
		if (scopeToMatch === 'session') {
			return presentationTargets.some(
				(target) => target.scope === 'session' && target.targetId === context.sessionId
			);
		}
		if (scopeToMatch === 'task') {
			return presentationTargets.some(
				(target) => target.scope === 'task' && target.targetId === context.taskId
			);
		}
		if (scopeToMatch === 'stage') {
			return presentationTargets.some(
				(target) => target.scope === 'stage' && target.targetId === context.stageId
			);
		}
		if (scopeToMatch === 'mission') {
			return presentationTargets.some((target) => target.scope === 'mission');
		}

		return !hasActiveContext && presentationTargets.some((target) => target.scope === 'mission');
	}

	if (context.sessionId && command.scope === 'session' && command.targetId === context.sessionId) {
		return true;
	}

	if (context.taskId && command.scope === 'task' && command.targetId === context.taskId) {
		return true;
	}

	if (context.stageId && command.scope === 'generation' && command.targetId === context.stageId) {
		return true;
	}

	if (hasActiveContext) {
		return false;
	}

	return command.scope === 'mission';
}

function resolvePresentationScope(
	presentationTargets: MissionActionDescriptor['presentationTargets'],
	context: CommandTargetContext
): 'session' | 'task' | 'stage' | 'mission' | undefined {
	if (context.sessionId && presentationTargets?.some((target) => target.scope === 'session')) {
		return 'session';
	}
	if (context.taskId && presentationTargets?.some((target) => target.scope === 'task')) {
		return 'task';
	}
	if (context.stageId && presentationTargets?.some((target) => target.scope === 'stage')) {
		return 'stage';
	}
	if (presentationTargets?.some((target) => target.scope === 'mission')) {
		return 'mission';
	}
	return undefined;
}