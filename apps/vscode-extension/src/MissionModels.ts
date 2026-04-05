import type {
	GateIntent,
	MissionAgentConsoleEvent,
	MissionAgentConsoleState,
	MissionArtifactKey,
	MissionStageId,
	MissionStatus,
	TrackedIssueSummary
} from '@flying-pillow/mission-core';
import {
	isGateIntent,
	isMissionArtifactKey as isCoreMissionArtifactKey,
	isMissionStageId as isCoreMissionStageId,
	MISSION_ARTIFACTS,
	MISSION_ARTIFACT_FILE_NAMES,
	MISSION_ARTIFACT_LABELS,
	MISSION_GATE_INTENTS,
	MISSION_STAGES,
	MISSION_TRACKED_FILE_NAMES
} from '@flying-pillow/mission-core';

export {
	MISSION_ARTIFACTS,
	MISSION_ARTIFACT_FILE_NAMES,
	MISSION_ARTIFACT_LABELS,
	MISSION_GATE_INTENTS,
	MISSION_STAGES,
	MISSION_TRACKED_FILE_NAMES
};

export type MissionGateIntent = GateIntent;
export type MissionMissionStatus = MissionStatus;
export type MissionGitHubIssue = TrackedIssueSummary;
export type MissionOperatorConsoleState = MissionAgentConsoleState;
export type MissionOperatorConsoleEvent = MissionAgentConsoleEvent;

export type MissionMissionSnapshot = {
	status: MissionStatus;
	controlRoot?: string;
	errorMessage?: string;
};

export type MissionArtifactReference = {
	artifactKey?: MissionArtifactKey;
	artifactPath?: string;
};

export type MissionChatRequest = {
	query: string;
};

export type MissionArtifactPreparationAction = {
	artifactKey: MissionArtifactKey;
	artifactPath?: string;
	label?: string;
	source?: string;
};

export type MissionTaskExecutionAction = {
	taskId?: string;
	taskPath?: string;
	label?: string;
	source?: string;
};

export type MissionIntermediateCommitAction = {
	label?: string;
	source?: string;
};

export type MissionArtifactDispositionAction = {
	artifactKey: MissionArtifactKey;
	label?: string;
	source?: string;
};

export function isMissionStageId(value: unknown): value is MissionStageId {
	return isCoreMissionStageId(value);
}

export function isMissionGateIntent(value: unknown): value is MissionGateIntent {
	return isGateIntent(value);
}

export function isMissionArtifactKey(value: unknown): value is MissionArtifactKey {
	return isCoreMissionArtifactKey(value);
}
