import type { EntityContractType } from '../entities/Entity/EntitySchema.js';
import type { EntityExecutionContext } from '../entities/Entity/Entity.js';
import {
    executeEntityCommand,
    executeEntityQuery
} from '../entities/Entity/EntityRemote.js';
import type {
    EntityCommandInvocation,
    EntityFormInvocation,
    EntityQueryInvocation,
    EntityRemoteResult
} from '../entities/Entity/EntityInvocation.js';

type MissionRegistryCapability = {
    loadRequiredMission(
        input: { missionId: string; repositoryRootPath: string },
        context: { surfacePath: string }
    ): Promise<unknown>;
};

const entityContractLoaders = new Map<string, () => Promise<EntityContractType>>([
    ['Mission', async () => (await import('../entities/Mission/MissionContract.js')).MissionContract],
    ['Stage', async () => (await import('../entities/Stage/StageContract.js')).StageContract],
    ['Task', async () => (await import('../entities/Task/TaskContract.js')).TaskContract],
    ['Artifact', async () => (await import('../entities/Artifact/ArtifactContract.js')).ArtifactContract],
    ['Agent', async () => (await import('../entities/Agent/AgentContract.js')).AgentContract],
    ['AgentExecution', async () => (await import('../entities/AgentExecution/AgentExecutionContract.js')).AgentExecutionContract],
    ['CodeGraphSnapshot', async () => (await import('../entities/CodeGraphSnapshot/CodeGraphSnapshotContract.js')).CodeGraphSnapshotContract],
    ['CodeObject', async () => (await import('../entities/CodeObject/CodeObjectContract.js')).CodeObjectContract],
    ['CodeRelation', async () => (await import('../entities/CodeRelation/CodeRelationContract.js')).CodeRelationContract],
    ['Repository', async () => (await import('../entities/Repository/RepositoryContract.js')).RepositoryContract],
    ['System', async () => (await import('../entities/System/SystemContract.js')).SystemContract],
    ['Terminal', async () => (await import('../entities/Terminal/TerminalContract.js')).TerminalContract],
]);

const missionOwnedEntities = new Set(['Mission', 'Stage', 'Task', 'Artifact', 'AgentExecution']);

export async function executeEntityQueryInDaemon(
    input: EntityQueryInvocation,
    context: EntityExecutionContext
): Promise<EntityRemoteResult> {
    return executeEntityQuery(input, context, {
        resolveContract: resolveEntityContract,
        prepareContext: prepareDaemonEntityContext
    });
}

export async function executeEntityCommandInDaemon(
    input: EntityCommandInvocation | EntityFormInvocation,
    context: EntityExecutionContext
): Promise<EntityRemoteResult> {
    return executeEntityCommand(input, context, {
        resolveContract: resolveEntityContract,
        prepareContext: prepareDaemonEntityContext,
        afterCommand: hydrateStartedRepositoryMission
    });
}

function prepareDaemonEntityContext(
    input: EntityQueryInvocation | EntityCommandInvocation | EntityFormInvocation,
    context: EntityExecutionContext
): EntityExecutionContext {
    return missionOwnedEntities.has(input.entity) ? { ...context } : context;
}

async function resolveEntityContract(entity: string): Promise<EntityContractType> {
    const loadContract = entityContractLoaders.get(entity);
    if (!loadContract) {
        throw new Error(`Entity '${entity}' is not implemented in the daemon.`);
    }
    return loadContract();
}

async function hydrateStartedRepositoryMission(
    input: EntityCommandInvocation | EntityFormInvocation,
    context: EntityExecutionContext,
    result: EntityRemoteResult
): Promise<void> {
    const registry = context['missionRegistry'];
    if (!isMissionRegistry(registry) || input.entity !== 'Repository') {
        return;
    }
    if (input.method !== 'startMissionFromIssue' && input.method !== 'startMissionFromBrief') {
        return;
    }
    if (!isRecord(result) || typeof result['id'] !== 'string' || !result['id'].trim()) {
        return;
    }

    const payload = isRecord(input.payload) ? input.payload : {};
    const repositoryRootPath = typeof result['worktreePath'] === 'string' && result['worktreePath'].trim()
        ? result['worktreePath'].trim()
        : typeof payload['repositoryRootPath'] === 'string' && payload['repositoryRootPath'].trim()
            ? payload['repositoryRootPath'].trim()
            : context.surfacePath;
    await registry.loadRequiredMission(
        {
            missionId: result['id'].trim(),
            repositoryRootPath
        },
        { surfacePath: repositoryRootPath }
    );
}

function isMissionRegistry(input: unknown): input is MissionRegistryCapability {
    return isRecord(input) && typeof input['loadRequiredMission'] === 'function';
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}