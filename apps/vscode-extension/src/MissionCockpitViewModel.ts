import type {
	MissionActionDescriptor,
	MissionStageId,
	MissionStatus
} from '@flying-pillow/mission-core';

export type MissionCockpitStageModel = {
	stageId: MissionStageId;
	label: string;
	status: string;
	selected: boolean;
	taskCount: number;
	completedTaskCount: number;
};

export type MissionCockpitActionModel = {
	id: string;
	label: string;
	action: string;
	scope: MissionActionDescriptor['scope'];
	targetId?: string;
	enabled: boolean;
	disabledReason: string;
	confirmationPrompt?: string;
};

export type MissionCockpitModel = {
	title: string;
	status: MissionStatus;
	selectedStageId?: MissionStageId;
	summary: string;
	stages: MissionCockpitStageModel[];
	actions: MissionCockpitActionModel[];
	emptyMessage?: string;
};

export type MissionCockpitMessage =
	| { type: 'refresh' }
	| { type: 'select-stage'; stageId?: MissionStageId }
	| { type: 'run-action'; actionId: string };

export type MissionCockpitHostMessage = {
	type: 'cockpit-model';
	model: MissionCockpitModel;
};

export function buildMissionCockpitModel(
	status: MissionStatus,
	selectedStageId?: MissionStageId
): MissionCockpitModel {
	const stages = status.stages ?? [];
	const effectiveStageId = resolveSelectedStageId(status, selectedStageId);
	const stageModels = stages.map((stage) => ({
		stageId: stage.stage,
		label: stage.stage.toUpperCase(),
		status: stage.status,
		selected: stage.stage === effectiveStageId,
		taskCount: stage.taskCount,
		completedTaskCount: stage.completedTaskCount
	}));
	const actions = filterActionsForStage(status.availableActions ?? [], effectiveStageId).map((action) => ({
		id: action.id,
		label: action.label,
		action: action.action,
		scope: action.scope,
		...(action.targetId ? { targetId: action.targetId } : {}),
		enabled: action.enabled,
		disabledReason: action.disabledReason,
		...(action.ui?.confirmationPrompt ? { confirmationPrompt: action.ui.confirmationPrompt } : {})
	}));

	return {
		title: status.title ?? status.missionId ?? 'Mission cockpit',
		status,
		...(effectiveStageId ? { selectedStageId: effectiveStageId } : {}),
		summary: buildCockpitSummary(status, effectiveStageId),
		stages: stageModels,
		actions,
		...(actions.length === 0
			? {
				emptyMessage: status.found
					? 'No daemon actions are projected for the current selection.'
					: 'No active mission is selected.'
			}
			: {})
	};
}

function resolveSelectedStageId(
	status: MissionStatus,
	selectedStageId?: MissionStageId
): MissionStageId | undefined {
	if (selectedStageId && status.stages?.some((stage) => stage.stage === selectedStageId)) {
		return selectedStageId;
	}

	return status.workflow?.currentStageId ?? status.stage ?? status.stages?.[0]?.stage;
}

function filterActionsForStage(
	actions: MissionActionDescriptor[],
	stageId?: MissionStageId
): MissionActionDescriptor[] {
	if (!stageId) {
		return actions.filter((action) => {
			const targets = action.presentationTargets ?? [];
			return targets.length === 0 || targets.some((target) => target.scope === 'mission');
		});
	}

	return actions.filter((action) => {
		const targets = action.presentationTargets ?? [];
		if (targets.length > 0) {
			return targets.some(
				(target) => target.scope === 'stage' && target.targetId === stageId
			);
		}

		return action.scope === 'generation' && action.targetId === stageId;
	});
}

function buildCockpitSummary(status: MissionStatus, stageId?: MissionStageId): string {
	if (!status.found) {
		return 'Control mode';
	}

	const selectedStage = status.stages?.find((stage) => stage.stage === stageId);
	if (selectedStage) {
		return `${selectedStage.stage.toUpperCase()} ${selectedStage.completedTaskCount}/${selectedStage.taskCount}`;
	}

	return status.missionId ?? 'Mission cockpit';
}
