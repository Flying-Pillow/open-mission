import type {
	ControlSettingsUpdate,
	MissionAgentSessionRecord
} from '../protocol/contracts.js';
import type {
	ContextSelection,
	MissionControlPlaneStatus,
	MissionRepositoryCandidate,
	MissionSelectionCandidate,
	MissionTaskState,
	MissionTowerProjection,
	OperatorStatus
} from '../../types.js';

export type MissionControlSource = {
	repositoryId: string;
	repositoryRootPath: string;
	control: MissionControlPlaneStatus;
	availableRepositories: MissionRepositoryCandidate[];
	availableMissions: MissionSelectionCandidate[];
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
	| 'productFiles'
	| 'activeTasks'
	| 'readyTasks'
	| 'stages'
	| 'agentSessions'
	| 'tower'
	| 'workflow'
>;

export type MissionControlWorkspaceSource = {
	repositoryId: string;
	repositoryRootPath: string;
	control: MissionControlPlaneStatus;
	availableRepositories: MissionRepositoryCandidate[];
	availableMissions: MissionSelectionCandidate[];
	missionStatus?: MissionControlMissionStatusSource;
};

export type MissionControlDocumentPathField = ControlSettingsUpdate['field'];

export type MissionControlAgentSessions = MissionAgentSessionRecord[];

export type MissionControlTowerProjection = MissionTowerProjection;

export type MissionControlTaskList = MissionTaskState[];