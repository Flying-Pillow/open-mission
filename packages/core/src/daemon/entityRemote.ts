import type {
    EntityCommandInvocation,
    EntityFormInvocation,
    EntityQueryInvocation,
    EntityRemoteResult
} from './protocol/entityRemote.js';
import { Entity, type EntityExecutionContext } from '../entities/Entity/Entity.js';
import type { EntityContractType } from '../entities/Entity/EntitySchema.js';
import { MissionDaemon } from './MissionDaemon.js';
import { agentSessionEntityContract } from '../entities/AgentSession/AgentSessionContract.js';
import { artifactEntityContract } from '../entities/Artifact/ArtifactContract.js';
import { missionEntityContract } from '../entities/Mission/MissionContract.js';
import { repositoryContract } from '../entities/Repository/RepositoryContract.js';
import { stageEntityContract } from '../entities/Stage/StageContract.js';
import { taskEntityContract } from '../entities/Task/TaskContract.js';

const entityContracts = [
    missionEntityContract,
    stageEntityContract,
    taskEntityContract,
    artifactEntityContract,
    agentSessionEntityContract,
    repositoryContract,
] as const satisfies readonly EntityContractType[];

const entityContractsByName = new Map<string, EntityContractType>(
    entityContracts.map((contract) => [contract.entity, contract])
);

const missionDaemon = new MissionDaemon();
const missionOwnedEntities = new Set(['Mission', 'Stage', 'Task', 'Artifact', 'AgentSession']);

export async function executeEntityQueryInDaemon(
    input: EntityQueryInvocation,
    context: EntityExecutionContext
): Promise<EntityRemoteResult> {
    assertDaemonContext(context);
    return Entity.executeQuery(resolveEntityContract(input.entity), input, withEntityServices(input.entity, context));
}

export async function executeEntityCommandInDaemon(
    input: EntityCommandInvocation | EntityFormInvocation,
    context: EntityExecutionContext
): Promise<EntityRemoteResult> {
    assertDaemonContext(context);
    const result = await Entity.executeCommand(resolveEntityContract(input.entity), input, withEntityServices(input.entity, context));
    await hydrateStartedRepositoryMission(input, context, result);
    return result;
}

function withMissionService(context: EntityExecutionContext): EntityExecutionContext {
    return {
        ...context,
        missionDaemon: context.missionDaemon ?? missionDaemon
    };
}

function withEntityServices(entity: string, context: EntityExecutionContext): EntityExecutionContext {
    return missionOwnedEntities.has(entity) ? withMissionService(context) : context;
}

function resolveEntityContract(entity: string): EntityContractType {
    const contract = entityContractsByName.get(entity);
    if (!contract) {
        throw new Error(`Entity '${entity}' is not implemented in the daemon.`);
    }
    return contract;
}

async function hydrateStartedRepositoryMission(
    input: EntityCommandInvocation | EntityFormInvocation,
    context: EntityExecutionContext,
    result: EntityRemoteResult
): Promise<void> {
    if (!context.missionDaemon || input.entity !== 'Repository') {
        return;
    }
    if (input.method !== 'startMissionFromIssue' && input.method !== 'startMissionFromBrief') {
        return;
    }
    if (!isRecord(result) || typeof result['id'] !== 'string' || !result['id'].trim()) {
        return;
    }

    const payload = isRecord(input.payload) ? input.payload : {};
    const repositoryRootPath = typeof payload['repositoryRootPath'] === 'string' && payload['repositoryRootPath'].trim()
        ? payload['repositoryRootPath'].trim()
        : context.surfacePath;
    await context.missionDaemon.loadRequiredMission(
        {
            missionId: result['id'].trim(),
            repositoryRootPath
        },
        { surfacePath: repositoryRootPath }
    );
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function assertDaemonContext(context: { surfacePath: string }): void {
    if (!context.surfacePath.trim()) {
        throw new Error('Entity daemon dispatch requires a surfacePath context.');
    }
}
