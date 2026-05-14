import type { EntityContractType } from './EntitySchema.js';
import { Entity, type EntityExecutionContext } from './Entity.js';
import { MissionRegistry } from '../../daemon/MissionRegistry.js';
import { getDefaultAgentExecutionRegistry } from '../../daemon/runtime/agent-execution/AgentExecutionRegistry.js';
import { AgentContract } from '../Agent/AgentContract.js';
import { AgentExecutionContract } from '../AgentExecution/AgentExecutionContract.js';
import { ArtifactContract } from '../Artifact/ArtifactContract.js';
import { MissionContract } from '../Mission/MissionContract.js';
import { RepositoryContract } from '../Repository/RepositoryContract.js';
import { StageContract } from '../Stage/StageContract.js';
import { SystemContract } from '../System/SystemContract.js';
import { TaskContract } from '../Task/TaskContract.js';
import { TerminalContract } from '../Terminal/TerminalContract.js';
export {
    entityCommandInvocationSchema,
    entityFormInvocationSchema,
    entityQueryInvocationSchema,
    type EntityCommandInvocation,
    type EntityFormInvocation,
    type EntityQueryInvocation,
    type EntityRemoteResult
} from './EntityInvocation.js';
import type {
    EntityCommandInvocation,
    EntityFormInvocation,
    EntityQueryInvocation
} from './EntityInvocation.js';

const entityContracts = [
    MissionContract,
    StageContract,
    TaskContract,
    ArtifactContract,
    AgentContract,
    AgentExecutionContract,
    RepositoryContract,
    SystemContract,
    TerminalContract,
] as const satisfies readonly EntityContractType[];

const entityContractsByName = new Map<string, EntityContractType>(
    entityContracts.map((contract) => [contract.entity, contract])
);

const missionRegistry = new MissionRegistry();
const agentExecutionRegistry = getDefaultAgentExecutionRegistry();
const missionOwnedEntities = new Set(['Mission', 'Stage', 'Task', 'Artifact', 'AgentExecution']);

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

function withMissionRegistry(context: EntityExecutionContext): EntityExecutionContext {
    return {
        ...context,
        missionRegistry: context.missionRegistry ?? missionRegistry
    };
}

function withEntityServices(entity: string, context: EntityExecutionContext): EntityExecutionContext {
    const scopedContext = entity === 'AgentExecution' || entity === 'Repository'
        ? { ...context, agentExecutionRegistry: context.agentExecutionRegistry ?? agentExecutionRegistry }
        : context;
    return missionOwnedEntities.has(entity) ? withMissionRegistry(scopedContext) : scopedContext;
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
    if (!context.missionRegistry || input.entity !== 'Repository') {
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
    await context.missionRegistry.loadRequiredMission(
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