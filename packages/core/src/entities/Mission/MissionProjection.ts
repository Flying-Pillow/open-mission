import type { MissionStageId } from '../../types.js';
import {
    MissionProjectionSnapshotSchema,
    MissionSnapshotSchema,
    type MissionDataType,
    type MissionSnapshotType
} from './MissionSchema.js';
import type { MissionOwnedCommandDescriptor } from './MissionCommandDescriptors.js';

export function buildMissionSnapshot(input: {
    missionId: string;
    mission: MissionDataType;
    commands: MissionOwnedCommandDescriptor[];
}): MissionSnapshotType {
    const commandSnapshot = withEntityCommands(input.mission, input.commands);
    const workflow = toMissionWorkflowSnapshot(commandSnapshot);
    return MissionSnapshotSchema.parse({
        mission: commandSnapshot,
        status: toMissionStatusSnapshot(commandSnapshot, input.missionId, workflow),
        ...(workflow ? { workflow } : {}),
        stages: commandSnapshot.stages,
        tasks: commandSnapshot.stages.flatMap((stage) => stage.tasks),
        artifacts: commandSnapshot.artifacts,
        agentSessions: commandSnapshot.agentSessions
    });
}

export function buildMissionProjectionSnapshot(input: {
    snapshot: MissionSnapshotType;
}) {
    return MissionProjectionSnapshotSchema.parse({
        missionId: input.snapshot.mission.missionId,
        ...(input.snapshot.status ? { status: input.snapshot.status } : {}),
        ...(input.snapshot.workflow ? { workflow: input.snapshot.workflow } : {}),
        updatedAt: input.snapshot.mission.updatedAt
    });
}

function toMissionStatusSnapshot(
    snapshot: MissionDataType,
    missionId: string,
    workflow: ReturnType<typeof toMissionWorkflowSnapshot>
) {
    return {
        missionId: snapshot.missionId.trim() || missionId,
        ...(snapshot.title ? { title: snapshot.title } : {}),
        ...(snapshot.issueId !== undefined ? { issueId: snapshot.issueId } : {}),
        ...(snapshot.type ? { type: snapshot.type } : {}),
        ...(snapshot.operationalMode ? { operationalMode: snapshot.operationalMode } : {}),
        ...(snapshot.branchRef ? { branchRef: snapshot.branchRef } : {}),
        ...(snapshot.missionDir ? { missionDir: snapshot.missionDir } : {}),
        ...(snapshot.missionRootDir ? { missionRootDir: snapshot.missionRootDir } : {}),
        ...(snapshot.artifacts.length > 0 ? { artifacts: snapshot.artifacts } : {}),
        ...(workflow ? { workflow } : {}),
        ...(snapshot.recommendedAction ? { recommendedAction: snapshot.recommendedAction } : {})
    };
}

function toMissionWorkflowSnapshot(snapshot: MissionDataType) {
    if (!snapshot.lifecycle && !snapshot.updatedAt && !snapshot.currentStageId && snapshot.stages.length === 0) {
        return undefined;
    }

    return {
        ...(snapshot.lifecycle ? { lifecycle: snapshot.lifecycle } : {}),
        ...(snapshot.updatedAt ? { updatedAt: snapshot.updatedAt } : {}),
        ...(snapshot.currentStageId ? { currentStageId: snapshot.currentStageId } : {}),
        ...(snapshot.stages.length > 0 ? { stages: snapshot.stages } : {})
    };
}

function withEntityCommands(
    snapshot: MissionDataType,
    commands: MissionOwnedCommandDescriptor[]
): MissionDataType {
    return {
        ...snapshot,
        commands: commandsForOwner(commands, { entity: 'Mission' }),
        artifacts: snapshot.artifacts.map((artifact) => ({
            ...artifact,
            commands: []
        })),
        stages: snapshot.stages.map((stage) => ({
            ...stage,
            commands: commandsForOwner(commands, { entity: 'Stage', stageId: stage.stageId as MissionStageId }),
            artifacts: stage.artifacts.map((artifact) => ({
                ...artifact,
                commands: []
            })),
            tasks: stage.tasks.map((task) => ({
                ...task,
                commands: commandsForOwner(commands, { entity: 'Task', taskId: task.taskId })
            }))
        })),
        agentSessions: snapshot.agentSessions.map((session) => ({
            ...session,
            commands: commandsForOwner(commands, { entity: 'AgentSession', sessionId: session.sessionId })
        }))
    };
}

function commandsForOwner(
    commands: MissionOwnedCommandDescriptor[],
    owner: MissionOwnedCommandDescriptor['owner']
) {
    return commands
        .filter((candidate) => matchesOwner(candidate.owner, owner))
        .map((candidate) => candidate.command);
}

function matchesOwner(
    candidate: MissionOwnedCommandDescriptor['owner'],
    owner: MissionOwnedCommandDescriptor['owner']
): boolean {
    if (candidate.entity !== owner.entity) {
        return false;
    }
    if (candidate.entity === 'Stage' && owner.entity === 'Stage') {
        return candidate.stageId === owner.stageId;
    }
    if (candidate.entity === 'Task' && owner.entity === 'Task') {
        return candidate.taskId === owner.taskId;
    }
    if (candidate.entity === 'AgentSession' && owner.entity === 'AgentSession') {
        return candidate.sessionId === owner.sessionId;
    }
    return candidate.entity === 'Mission';
}