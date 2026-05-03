import {
    MissionControlViewSnapshotSchema,
    MissionSnapshotSchema,
    type MissionDataType,
    type MissionCommandViewSnapshotType,
    type MissionSnapshotType
} from './MissionSchema.js';

export function buildMissionSnapshot(input: {
    missionId: string;
    mission: MissionDataType;
    commandView: MissionCommandViewSnapshotType;
}): MissionSnapshotType {
    const workflow = toMissionWorkflowSnapshot(input.mission);
    return MissionSnapshotSchema.parse({
        mission: input.mission,
        commandView: input.commandView,
        status: toMissionStatusSnapshot(input.mission, input.missionId, workflow),
        ...(workflow ? { workflow } : {}),
        stages: input.mission.stages,
        tasks: input.mission.stages.flatMap((stage) => stage.tasks),
        artifacts: input.mission.artifacts,
        agentSessions: input.mission.agentSessions
    });
}

export function buildMissionControlViewSnapshot(input: {
    snapshot: MissionSnapshotType;
}) {
    return MissionControlViewSnapshotSchema.parse({
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
