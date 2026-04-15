import type {
	MissionResolvedSelection,
	OperatorActionTargetContext,
} from '@flying-pillow/mission-core';

export function resolveOperatorActionContextFromSelection(
	selection: MissionResolvedSelection | undefined
): OperatorActionTargetContext {
	if (!selection) {
		return {};
	}
	return {
		...(selection.stageId ? { stageId: selection.stageId } : {}),
		...(selection.taskId ? { taskId: selection.taskId } : {}),
		...(selection.activeAgentSessionId ? { sessionId: selection.activeAgentSessionId } : {})
	};
}
