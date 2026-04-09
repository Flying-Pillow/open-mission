import type {
	ControlSettingsUpdate,
	MissionAgentSessionRecord
} from '../contracts.js';
import type {
	ContextSelection,
	MissionControlPlaneStatus,
	MissionSelectionCandidate,
	MissionTaskState,
	MissionTowerProjection,
	OperatorActionDescriptor,
	OperatorStatus
} from '../../types.js';

export type MissionControlSource = {
	repositoryId: string;
	repositoryRootPath: string;
	control: MissionControlPlaneStatus;
	availableMissions: MissionSelectionCandidate[];
	availableActions: OperatorActionDescriptor[];
	missionStatus?: OperatorStatus;
};

export type MissionControlSourceSelectionHint = Partial<ContextSelection>;

export type MissionControlMissionStatusSource = Pick<
	OperatorStatus,
	| 'missionId'
	| 'title'
	| 'issueId'
	| 'type'
	| 'stage'
	| 'branchRef'
	| 'missionDir'
	| 'missionRootDir'
	| 'missionControlDir'
	| 'productFiles'
	| 'activeTasks'
	| 'readyTasks'
	| 'stages'
	| 'agentSessions'
	| 'tower'
	| 'workflow'
	| 'availableActions'
>;

export type MissionControlWorkspaceSource = {
	repositoryId: string;
	repositoryRootPath: string;
	control: MissionControlPlaneStatus;
	availableMissions: MissionSelectionCandidate[];
	availableActions: OperatorActionDescriptor[];
	missionStatus?: MissionControlMissionStatusSource;
};

export type MissionControlDocumentPathField = ControlSettingsUpdate['field'];

export type MissionControlAgentSessions = MissionAgentSessionRecord[];

export type MissionControlTowerProjection = MissionTowerProjection;

export type MissionControlTaskList = MissionTaskState[];