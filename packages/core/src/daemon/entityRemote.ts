import type {
	EntityCommandInvocation,
	EntityFormInvocation,
	EntityQueryInvocation,
	EntityRemoteResult
} from '../schemas/EntityRemote.js';
import { GitHubRepository } from '../entities/GitHubRepository/GitHubRepository.js';
import { AgentSessionCommands } from '../entities/AgentSession/AgentSessionCommands.js';
import { ArtifactCommands } from '../entities/Artifact/ArtifactCommands.js';
import { MissionCommands } from '../entities/Mission/MissionCommands.js';
import { Repository } from '../entities/Repository/Repository.js';
import { StageCommands } from '../entities/Stage/StageCommands.js';
import { TaskCommands } from '../entities/Task/TaskCommands.js';
import {
	gitHubRepositoryClonePayloadSchema,
	gitHubRepositoryEntityName,
	gitHubRepositoryFindPayloadSchema
} from '../schemas/GitHubRepository.js';
import {
	missionActionListSnapshotSchema,
	missionCommandAcknowledgementSchema,
	missionCommandPayloadSchema,
	missionDocumentSnapshotSchema,
	missionExecuteActionPayloadSchema,
	missionEntityName,
	missionListActionsPayloadSchema,
	missionReadDocumentPayloadSchema,
	missionReadPayloadSchema,
	missionReadProjectionPayloadSchema,
	missionReadWorktreePayloadSchema,
	missionProjectionSnapshotSchema,
	missionAgentSessionCommandPayloadSchema,
	missionSnapshotSchema,
	missionTaskCommandPayloadSchema,
	missionWorktreeSnapshotSchema,
	missionWriteDocumentPayloadSchema
} from '../schemas/Mission.js';
import {
	missionStageEntityName,
	missionStageSnapshotSchema,
	stageCommandAcknowledgementSchema,
	stageCommandListSnapshotSchema,
	stageExecuteCommandPayloadSchema,
	stageIdentityPayloadSchema
} from '../schemas/Stage.js';
import {
	missionTaskEntityName,
	missionTaskSnapshotSchema,
	taskCommandAcknowledgementSchema,
	taskCommandListSnapshotSchema,
	taskExecuteCommandPayloadSchema,
	taskIdentityPayloadSchema
} from '../schemas/Task.js';
import {
	artifactCommandAcknowledgementSchema,
	artifactCommandListSnapshotSchema,
	artifactDocumentSnapshotSchema,
	artifactExecuteCommandPayloadSchema,
	artifactIdentityPayloadSchema,
	artifactWriteDocumentPayloadSchema,
	missionArtifactEntityName,
	missionArtifactSnapshotSchema
} from '../schemas/Artifact.js';
import {
	agentSessionCommandAcknowledgementSchema,
	agentSessionCommandListSnapshotSchema,
	agentSessionExecuteCommandPayloadSchema,
	agentSessionIdentityPayloadSchema,
	agentSessionSendCommandPayloadSchema,
	agentSessionSendPromptPayloadSchema,
	missionAgentSessionEntityName,
	missionAgentSessionSnapshotSchema
} from '../schemas/AgentSession.js';
import { githubVisibleRepositorySchema } from '../schemas/AirportClient.js';
import {
	githubIssueDetailSchema,
	repositoryEntityName,
	repositoryFindPayloadSchema,
	repositoryAddPayloadSchema,
	repositoryGetIssuePayloadSchema,
	repositoryListIssuesPayloadSchema,
	repositoryMissionStartAcknowledgementSchema,
	repositoryReadPayloadSchema,
	repositorySnapshotSchema,
	repositoryStartMissionFromBriefPayloadSchema,
	repositoryStartMissionFromIssuePayloadSchema,
	trackedIssueSummarySchema
} from '../schemas/Repository.js';

export async function executeEntityQueryInDaemon(
	input: EntityQueryInvocation,
	context: {
		surfacePath: string;
		authToken?: string;
	}
): Promise<EntityRemoteResult> {
	assertDaemonContext(context);
	return executeEntityQuery(input, context);
}

export async function executeEntityCommandInDaemon(
	input: EntityCommandInvocation | EntityFormInvocation,
	context: {
		surfacePath: string;
		authToken?: string;
	}
): Promise<EntityRemoteResult> {
	assertDaemonContext(context);
	return executeEntityCommand(input, context);
}

async function executeEntityQuery(
	input: EntityQueryInvocation,
	context: {
		surfacePath: string;
		authToken?: string;
	}
): Promise<EntityRemoteResult> {
	switch (input.entity) {
		case missionEntityName:
			return executeMissionQuery(input, context);
		case missionStageEntityName:
			return executeStageQuery(input, context);
		case missionTaskEntityName:
			return executeTaskQuery(input, context);
		case missionArtifactEntityName:
			return executeArtifactQuery(input, context);
		case missionAgentSessionEntityName:
			return executeAgentSessionQuery(input, context);
		case repositoryEntityName:
			return executeRepositoryQuery(input, context);
		case gitHubRepositoryEntityName:
			return executeGitHubRepositoryQuery(input, context);
		default:
			throw new Error(`Entity '${input.entity}' is not implemented in the daemon.`);
	}
}

async function executeEntityCommand(
	input: EntityCommandInvocation | EntityFormInvocation,
	context: {
		surfacePath: string;
		authToken?: string;
	}
): Promise<EntityRemoteResult> {
	switch (input.entity) {
		case missionEntityName:
			return executeMissionCommand(input, context);
		case missionStageEntityName:
			return executeStageCommand(input, context);
		case missionTaskEntityName:
			return executeTaskCommand(input, context);
		case missionArtifactEntityName:
			return executeArtifactCommand(input, context);
		case missionAgentSessionEntityName:
			return executeAgentSessionCommand(input, context);
		case repositoryEntityName:
			return executeRepositoryCommand(input, context);
		case gitHubRepositoryEntityName:
			return executeGitHubRepositoryCommand(input, context);
		default:
			throw new Error(`Entity '${input.entity}' is not implemented in the daemon.`);
	}
}

async function executeMissionQuery(
	input: EntityQueryInvocation,
	context: {
		surfacePath: string;
	}
): Promise<EntityRemoteResult> {
	switch (input.method) {
		case 'read': {
			const payload = missionReadPayloadSchema.parse(input.payload ?? {});
			return missionSnapshotSchema.parse(await MissionCommands.read(payload, context));
		}
		case 'readProjection': {
			const payload = missionReadProjectionPayloadSchema.parse(input.payload ?? {});
			return missionProjectionSnapshotSchema.parse(await MissionCommands.readProjection(payload, context));
		}
		case 'listActions': {
			const payload = missionListActionsPayloadSchema.parse(input.payload ?? {});
			return missionActionListSnapshotSchema.parse(await MissionCommands.listActions(payload, context));
		}
		case 'readDocument': {
			const payload = missionReadDocumentPayloadSchema.parse(input.payload ?? {});
			return missionDocumentSnapshotSchema.parse(await MissionCommands.readDocument(payload, context));
		}
		case 'readWorktree': {
			const payload = missionReadWorktreePayloadSchema.parse(input.payload ?? {});
			return missionWorktreeSnapshotSchema.parse(await MissionCommands.readWorktree(payload, context));
		}
		default:
			throw new Error(`Query method '${input.entity}.${input.method}' is not implemented in the daemon.`);
	}
}

async function executeStageQuery(
	input: EntityQueryInvocation,
	context: {
		surfacePath: string;
	}
): Promise<EntityRemoteResult> {
	switch (input.method) {
		case 'read': {
			const payload = stageIdentityPayloadSchema.parse(input.payload ?? {});
			return missionStageSnapshotSchema.parse(await StageCommands.read(payload, context));
		}
		case 'listCommands': {
			const payload = stageIdentityPayloadSchema.parse(input.payload ?? {});
			return stageCommandListSnapshotSchema.parse(await StageCommands.listCommands(payload, context));
		}
		default:
			throw new Error(`Query method '${input.entity}.${input.method}' is not implemented in the daemon.`);
	}
}

async function executeTaskQuery(
	input: EntityQueryInvocation,
	context: {
		surfacePath: string;
	}
): Promise<EntityRemoteResult> {
	switch (input.method) {
		case 'read': {
			const payload = taskIdentityPayloadSchema.parse(input.payload ?? {});
			return missionTaskSnapshotSchema.parse(await TaskCommands.read(payload, context));
		}
		case 'listCommands': {
			const payload = taskIdentityPayloadSchema.parse(input.payload ?? {});
			return taskCommandListSnapshotSchema.parse(await TaskCommands.listCommands(payload, context));
		}
		default:
			throw new Error(`Query method '${input.entity}.${input.method}' is not implemented in the daemon.`);
	}
}

async function executeArtifactQuery(
	input: EntityQueryInvocation,
	context: {
		surfacePath: string;
	}
): Promise<EntityRemoteResult> {
	switch (input.method) {
		case 'read': {
			const payload = artifactIdentityPayloadSchema.parse(input.payload ?? {});
			return missionArtifactSnapshotSchema.parse(await ArtifactCommands.read(payload, context));
		}
		case 'readDocument': {
			const payload = artifactIdentityPayloadSchema.parse(input.payload ?? {});
			return artifactDocumentSnapshotSchema.parse(await ArtifactCommands.readDocument(payload, context));
		}
		case 'listCommands': {
			const payload = artifactIdentityPayloadSchema.parse(input.payload ?? {});
			return artifactCommandListSnapshotSchema.parse(await ArtifactCommands.listCommands(payload, context));
		}
		default:
			throw new Error(`Query method '${input.entity}.${input.method}' is not implemented in the daemon.`);
	}
}

async function executeAgentSessionQuery(
	input: EntityQueryInvocation,
	context: {
		surfacePath: string;
	}
): Promise<EntityRemoteResult> {
	switch (input.method) {
		case 'read': {
			const payload = agentSessionIdentityPayloadSchema.parse(input.payload ?? {});
			return missionAgentSessionSnapshotSchema.parse(await AgentSessionCommands.read(payload, context));
		}
		case 'listCommands': {
			const payload = agentSessionIdentityPayloadSchema.parse(input.payload ?? {});
			return agentSessionCommandListSnapshotSchema.parse(await AgentSessionCommands.listCommands(payload, context));
		}
		default:
			throw new Error(`Query method '${input.entity}.${input.method}' is not implemented in the daemon.`);
	}
}

async function executeRepositoryQuery(
	input: EntityQueryInvocation,
	context: {
		authToken?: string;
	}
): Promise<EntityRemoteResult> {
	switch (input.method) {
		case 'find': {
			const payload = repositoryFindPayloadSchema.parse(input.payload ?? {});
			return repositorySnapshotSchema.array().parse(await Repository.find(payload, context));
		}
		case 'read': {
			const payload = repositoryReadPayloadSchema.parse(input.payload ?? {});
			const repository = await resolveRepositoryInstance(input, payload);
			return repositorySnapshotSchema.parse(await repository.read(payload));
		}
		case 'listIssues': {
			const payload = repositoryListIssuesPayloadSchema.parse(input.payload ?? {});
			const repository = await resolveRepositoryInstance(input, payload);
			return trackedIssueSummarySchema.array().parse(await repository.listIssues(payload, context));
		}
		case 'getIssue': {
			const payload = repositoryGetIssuePayloadSchema.parse(input.payload ?? {});
			const repository = await resolveRepositoryInstance(input, payload);
			return githubIssueDetailSchema.parse(await repository.getIssue(payload, context));
		}
		default:
			throw new Error(`Query method '${input.entity}.${input.method}' is not implemented in the daemon.`);
	}
}

async function executeMissionCommand(
	input: EntityCommandInvocation | EntityFormInvocation,
	context: {
		surfacePath: string;
	}
): Promise<EntityRemoteResult> {
	switch (input.method) {
		case 'command': {
			const payload = missionCommandPayloadSchema.parse(input.payload ?? {});
			return missionCommandAcknowledgementSchema.parse(await MissionCommands.command(payload, context));
		}
		case 'taskCommand': {
			const payload = missionTaskCommandPayloadSchema.parse(input.payload ?? {});
			return missionCommandAcknowledgementSchema.parse(await MissionCommands.taskCommand(payload, context));
		}
		case 'sessionCommand': {
			const payload = missionAgentSessionCommandPayloadSchema.parse(input.payload ?? {});
			return missionCommandAcknowledgementSchema.parse(await MissionCommands.sessionCommand(payload, context));
		}
		case 'executeAction': {
			const payload = missionExecuteActionPayloadSchema.parse(input.payload ?? {});
			return missionCommandAcknowledgementSchema.parse(await MissionCommands.executeAction(payload, context));
		}
		case 'writeDocument': {
			const payload = missionWriteDocumentPayloadSchema.parse(input.payload ?? {});
			return missionDocumentSnapshotSchema.parse(await MissionCommands.writeDocument(payload, context));
		}
		default:
			throw new Error(`Command method '${input.entity}.${input.method}' is not implemented in the daemon.`);
	}
}

async function executeStageCommand(
	input: EntityCommandInvocation | EntityFormInvocation,
	context: {
		surfacePath: string;
	}
): Promise<EntityRemoteResult> {
	switch (input.method) {
		case 'executeCommand': {
			const payload = stageExecuteCommandPayloadSchema.parse(input.payload ?? {});
			return stageCommandAcknowledgementSchema.parse(await StageCommands.executeCommand(payload, context));
		}
		default:
			throw new Error(`Command method '${input.entity}.${input.method}' is not implemented in the daemon.`);
	}
}

async function executeTaskCommand(
	input: EntityCommandInvocation | EntityFormInvocation,
	context: {
		surfacePath: string;
	}
): Promise<EntityRemoteResult> {
	switch (input.method) {
		case 'executeCommand': {
			const payload = taskExecuteCommandPayloadSchema.parse(input.payload ?? {});
			return taskCommandAcknowledgementSchema.parse(await TaskCommands.executeCommand(payload, context));
		}
		default:
			throw new Error(`Command method '${input.entity}.${input.method}' is not implemented in the daemon.`);
	}
}

async function executeArtifactCommand(
	input: EntityCommandInvocation | EntityFormInvocation,
	context: {
		surfacePath: string;
	}
): Promise<EntityRemoteResult> {
	switch (input.method) {
		case 'writeDocument': {
			const payload = artifactWriteDocumentPayloadSchema.parse(input.payload ?? {});
			return artifactDocumentSnapshotSchema.parse(await ArtifactCommands.writeDocument(payload, context));
		}
		case 'executeCommand': {
			const payload = artifactExecuteCommandPayloadSchema.parse(input.payload ?? {});
			return artifactCommandAcknowledgementSchema.parse(await ArtifactCommands.executeCommand(payload, context));
		}
		default:
			throw new Error(`Command method '${input.entity}.${input.method}' is not implemented in the daemon.`);
	}
}

async function executeAgentSessionCommand(
	input: EntityCommandInvocation | EntityFormInvocation,
	context: {
		surfacePath: string;
	}
): Promise<EntityRemoteResult> {
	switch (input.method) {
		case 'executeCommand': {
			const payload = agentSessionExecuteCommandPayloadSchema.parse(input.payload ?? {});
			return agentSessionCommandAcknowledgementSchema.parse(await AgentSessionCommands.executeCommand(payload, context));
		}
		case 'sendPrompt': {
			const payload = agentSessionSendPromptPayloadSchema.parse(input.payload ?? {});
			return agentSessionCommandAcknowledgementSchema.parse(await AgentSessionCommands.sendPrompt(payload, context));
		}
		case 'sendCommand': {
			const payload = agentSessionSendCommandPayloadSchema.parse(input.payload ?? {});
			return agentSessionCommandAcknowledgementSchema.parse(await AgentSessionCommands.sendCommand(payload, context));
		}
		default:
			throw new Error(`Command method '${input.entity}.${input.method}' is not implemented in the daemon.`);
	}
}

async function executeGitHubRepositoryQuery(
	input: EntityQueryInvocation,
	context: {
		surfacePath: string;
		authToken?: string;
	}
): Promise<EntityRemoteResult> {
	switch (input.method) {
		case 'find': {
			const payload = gitHubRepositoryFindPayloadSchema.parse(input.payload ?? {});
			return githubVisibleRepositorySchema.array().parse(await GitHubRepository.find(payload, context));
		}
		default:
			throw new Error(`Query method '${input.entity}.${input.method}' is not implemented in the daemon.`);
	}
}

async function executeRepositoryCommand(
	input: EntityCommandInvocation | EntityFormInvocation,
	context: {
		authToken?: string;
	}
): Promise<EntityRemoteResult> {
	switch (input.method) {
		case 'add': {
			const payload = repositoryAddPayloadSchema.parse(input.payload ?? {});
			return repositorySnapshotSchema.parse(await Repository.add(payload, context));
		}
		case 'startMissionFromIssue': {
			const payload = repositoryStartMissionFromIssuePayloadSchema.parse(input.payload ?? {});
			const repository = await resolveRepositoryInstance(input, payload);
			return repositoryMissionStartAcknowledgementSchema.parse(await repository.startMissionFromIssue(payload, context));
		}
		case 'startMissionFromBrief': {
			const payload = repositoryStartMissionFromBriefPayloadSchema.parse(input.payload ?? {});
			const repository = await resolveRepositoryInstance(input, payload);
			return repositoryMissionStartAcknowledgementSchema.parse(await repository.startMissionFromBrief(payload, context));
		}
		default:
			throw new Error(`Command method '${input.entity}.${input.method}' is not implemented in the daemon.`);
	}
}

async function executeGitHubRepositoryCommand(
	input: EntityCommandInvocation | EntityFormInvocation,
	context: {
		surfacePath: string;
		authToken?: string;
	}
): Promise<EntityRemoteResult> {
	switch (input.method) {
		case 'clone': {
			const payload = gitHubRepositoryClonePayloadSchema.parse(input.payload ?? {});
			return repositorySnapshotSchema.parse(await GitHubRepository.clone(payload, context));
		}
		default:
			throw new Error(`Command method '${input.entity}.${input.method}' is not implemented in the daemon.`);
	}
}

function assertDaemonContext(context: { surfacePath: string }): void {
	if (!context.surfacePath.trim()) {
		throw new Error('Entity daemon dispatch requires a surfacePath context.');
	}
}

async function resolveRepositoryInstance(
	input: EntityQueryInvocation | EntityCommandInvocation | EntityFormInvocation,
	payload: { repositoryId: string; repositoryRootPath?: string | undefined }
): Promise<Repository> {
	const repository = await Repository.resolve(payload);
	if (!repository) {
		throw new Error(`Entity '${input.entity}' could not be resolved for method '${input.method}'.`);
	}

	return repository;
}