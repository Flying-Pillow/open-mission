import type { AgentExecutionScope } from '../../../entities/AgentExecution/protocol/AgentExecutionProtocolTypes.js';
import type { AgentExecutionJournalRecordType } from '../../../entities/AgentExecution/journal/AgentExecutionJournalSchema.js';
import type { AgentExecutionJournalWriter } from '../../../entities/AgentExecution/journal/AgentExecutionJournalWriter.js';
import {
    AgentExecutionReadArtifactOperationInputSchema,
    READ_ARTIFACT_OPERATION_NAME,
    type AgentExecutionReadArtifactOperationInputType,
    type AgentExecutionReadArtifactOperationResultType,
    type AgentExecutionSemanticOperationInvocationType,
    type AgentExecutionSemanticOperationNameType,
    type AgentExecutionSemanticOperationResultType
} from '../../../entities/AgentExecution/protocol/AgentExecutionSemanticOperationSchema.js';
import { ArtifactService } from './ArtifactService.js';

type AgentExecutionSemanticOperationHandler = {
    name: AgentExecutionSemanticOperationNameType;
    invoke(input: AgentExecutionSemanticOperationRequestType): Promise<AgentExecutionSemanticOperationResultType>;
};

export { AgentExecutionReadArtifactOperationInputSchema, READ_ARTIFACT_OPERATION_NAME };
export type {
    AgentExecutionReadArtifactOperationInputType,
    AgentExecutionReadArtifactOperationResultType,
    AgentExecutionSemanticOperationInvocationType,
    AgentExecutionSemanticOperationNameType as AgentExecutionSemanticOperationName,
    AgentExecutionSemanticOperationResultType
};

export type AgentExecutionSemanticOperationDescriptorType = {
    name: AgentExecutionSemanticOperationNameType;
    title: string;
    description: string;
};

export const AgentExecutionSemanticOperationDescriptors: AgentExecutionSemanticOperationDescriptorType[] = [
    {
        name: READ_ARTIFACT_OPERATION_NAME,
        title: 'Read Artifact',
        description: 'Reads a repository-relative artifact through Mission-owned semantic access and records an authoritative artifact-read Agent execution fact.'
    }
];

export type AgentExecutionSemanticOperationRequestType = AgentExecutionSemanticOperationInvocationType & {
    scope: AgentExecutionScope;
    onRecordAppended?: (record: AgentExecutionJournalRecordType) => void | Promise<void>;
};

export type AgentExecutionSemanticOperationInvoker = {
    invokeSemanticOperation(input: AgentExecutionSemanticOperationInvocationType):
        | AgentExecutionSemanticOperationResultType
        | Promise<AgentExecutionSemanticOperationResultType>;
};

// Keep semantic operations closed and concrete. Add handlers only for real Mission features.
export class AgentExecutionSemanticOperations {
    private readonly handlersByName: Map<AgentExecutionSemanticOperationNameType, AgentExecutionSemanticOperationHandler>;

    public constructor(input: {
        artifactService: ArtifactService;
        journalWriter: AgentExecutionJournalWriter;
    }) {
        const handlers = [
            createReadArtifactOperationHandler({
                artifactService: input.artifactService,
                journalWriter: input.journalWriter
            })
        ];
        this.handlersByName = new Map(handlers.map((handler) => [handler.name, handler]));
    }

    public async invoke(input: AgentExecutionSemanticOperationRequestType): Promise<AgentExecutionSemanticOperationResultType> {
        const handler = this.handlersByName.get(input.name);
        if (!handler) {
            throw new Error(`Semantic operation '${input.name}' is not registered.`);
        }
        return handler.invoke(input);
    }
}

export function readAgentExecutionSemanticOperationDescriptor(name: string): AgentExecutionSemanticOperationDescriptorType | undefined {
    return AgentExecutionSemanticOperationDescriptors.find((descriptor) => descriptor.name === name);
}

export function readAgentExecutionSemanticOperationInputSchema(name: AgentExecutionSemanticOperationNameType) {
    switch (name) {
        case READ_ARTIFACT_OPERATION_NAME:
            return AgentExecutionReadArtifactOperationInputSchema;
    }
}

function requireRepositoryRootPathForSemanticAccess(scope: AgentExecutionScope, agentExecutionId: string): string {
    switch (scope.kind) {
        case 'repository':
            return scope.repositoryRootPath.trim();
        case 'mission':
        case 'task':
        case 'artifact': {
            const repositoryRootPath = scope.repositoryRootPath?.trim();
            if (repositoryRootPath) {
                return repositoryRootPath;
            }
            throw new Error(`AgentExecution '${agentExecutionId}' does not expose repository-scoped semantic access for scope '${scope.kind}'.`);
        }
        case 'system':
            throw new Error(`AgentExecution '${agentExecutionId}' does not support repository artifact access for system scope.`);
    }
}

function createReadArtifactOperationHandler(input: {
    artifactService: ArtifactService;
    journalWriter: AgentExecutionJournalWriter;
}): AgentExecutionSemanticOperationHandler {
    return {
        name: READ_ARTIFACT_OPERATION_NAME,
        async invoke(request) {
            const repositoryRootPath = requireRepositoryRootPathForSemanticAccess(request.scope, request.agentExecutionId);
            const artifact = await input.artifactService.readArtifact({
                repositoryRootPath,
                artifactPath: request.input.path
            });
            const fact = await input.journalWriter.appendFact({
                agentExecutionId: request.agentExecutionId,
                scope: request.scope,
                factType: 'artifact-read',
                path: artifact.path,
                detail: 'Mission recorded an artifact-read Agent execution fact.',
                payload: {
                    operationName: request.name
                }
            });
            await request.onRecordAppended?.(fact);
            return {
                operationName: request.name,
                agentExecutionId: request.agentExecutionId,
                eventId: request.input.eventId?.trim() || fact.factId,
                path: artifact.path,
                content: artifact.content,
                factType: 'artifact-read'
            };
        }
    };
}