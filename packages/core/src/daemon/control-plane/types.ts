import type {
	ControlSettingsUpdate,
	MissionAgentSessionRecord
} from '../protocol/contracts.js';
import type {
	ContextSelection,
	RepositoryControlStatus,
	RepositoryCandidate,
	MissionSelectionCandidate,
	MissionTaskState,
	MissionTowerProjection,
	OperatorStatus
} from '../../types.js';

export type ControlSource = {
	repositoryId: string;
	repositoryRootPath: string;
	control: RepositoryControlStatus;
	availableRepositories: RepositoryCandidate[];
	availableMissions: MissionSelectionCandidate[];
	missionStatus?: OperatorStatus;
};

export type ControlSourceSelectionHint = Partial<ContextSelection>;

export type ControlMissionStatusSource = Pick<
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

export type ControlWorkspaceSource = {
	repositoryId: string;
	repositoryRootPath: string;
	control: RepositoryControlStatus;
	availableRepositories: RepositoryCandidate[];
	availableMissions: MissionSelectionCandidate[];
	missionStatus?: ControlMissionStatusSource;
};

export type ControlDocumentPathField = ControlSettingsUpdate['field'];

export type ControlAgentSessions = MissionAgentSessionRecord[];

export type ControlTowerProjection = MissionTowerProjection;

export type ControlTaskList = MissionTaskState[];