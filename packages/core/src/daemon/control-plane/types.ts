import type { AgentSessionRecord } from '../protocol/contracts.js';
import type {
	ContextSelection,
	RepositoryControlStatus,
	MissionSelectionCandidate,
	MissionTaskState,
	MissionTowerProjection,
	OperatorStatus
} from '../../types.js';
import type { Repository } from '../../entities/Repository/Repository.js';

export type ControlSource = {
	repositoryId: string;
	repositoryRootPath: string;
	control: RepositoryControlStatus;
	availableRepositories: Repository[];
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
	availableRepositories: Repository[];
	availableMissions: MissionSelectionCandidate[];
	missionStatus?: ControlMissionStatusSource;
};

export type ControlDocumentPathField = 'agentRunner' | 'defaultAgentMode' | 'defaultModel' | 'missionsRoot' | 'instructionsPath' | 'skillsPath';

export type ControlAgentSessions = AgentSessionRecord[];

export type ControlTowerProjection = MissionTowerProjection;

export type ControlTaskList = MissionTaskState[];
