import type {
	EntityCommandInvocation,
	EntityFormInvocation,
	EntityQueryInvocation,
	EntityRemoteResult
} from '../schemas/EntityRemote.js';
import { GitHubRepository } from '../entities/GitHubRepository/GitHubRepository.js';
import { Repository } from '../entities/Repository/Repository.js';
import {
	gitHubRepositoryClonePayloadSchema,
	gitHubRepositoryEntityName,
	gitHubRepositoryFindPayloadSchema
} from '../schemas/GitHubRepository.js';
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
		case repositoryEntityName:
			return executeRepositoryCommand(input, context);
		case gitHubRepositoryEntityName:
			return executeGitHubRepositoryCommand(input, context);
		default:
			throw new Error(`Entity '${input.entity}' is not implemented in the daemon.`);
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