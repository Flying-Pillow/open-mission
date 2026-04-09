import type {
    MissionTowerTreeNode,
    MissionAgentSessionRecord,
    MissionStageId,
    MissionStageStatus,
    MissionTaskState
} from '@flying-pillow/mission-core';

export type TreeTargetDescriptor = MissionTowerTreeNode & {
    collapsed: boolean;
};

export type TreeTargetKind = TreeTargetDescriptor['kind'];

export function pickPreferredStageId(
    stages: MissionStageStatus[],
    current: MissionStageId | undefined,
    preferred: MissionStageId | undefined
): MissionStageId | undefined {
    if (stages.length === 0) {
        return undefined;
    }
    if (current && stages.some((stage) => stage.stage === current)) {
        return current;
    }
    if (preferred && stages.some((stage) => stage.stage === preferred)) {
        return preferred;
    }
    return stages[0]?.stage;
}

export function pickPreferredTaskId(tasks: MissionTaskState[], current: string): string {
    if (tasks.length === 0) {
        return '';
    }
    if (current && tasks.some((task) => task.taskId === current)) {
        return current;
    }
    const preferred =
        tasks.find((task) => task.status === 'active') ??
        tasks.find((task) => task.status === 'todo' && task.blockedBy.length === 0) ??
        tasks[0];
    return preferred?.taskId ?? '';
}

export function pickPreferredSessionId(
    sessions: MissionAgentSessionRecord[],
    current: string | undefined
): string | undefined {
    const liveSessions = sessions.filter((session) =>
        session.lifecycleState === 'awaiting-input'
        || session.lifecycleState === 'running'
        || session.lifecycleState === 'starting'
    );
    if (liveSessions.length === 0) {
        return undefined;
    }
    if (current && liveSessions.some((session) => session.sessionId === current)) {
        return current;
    }
    const preferred =
        liveSessions.find((session) => session.lifecycleState === 'awaiting-input') ??
        liveSessions.find((session) => session.lifecycleState === 'running' || session.lifecycleState === 'starting') ??
        liveSessions[0];
    return preferred?.sessionId;
}

export function moveTreeTargetSelection(
    targets: TreeTargetDescriptor[],
    current: string | undefined,
    delta: number
): string | undefined {
    if (targets.length === 0) {
        return undefined;
    }
    const currentId = current && targets.some((target) => target.id === current) ? current : targets[0]?.id;
    const currentIndex = Math.max(0, targets.findIndex((target) => target.id === currentId));
    const nextIndex = clampIndex(currentIndex + delta, targets.length);
    return targets[nextIndex]?.id;
}

export function createSessionNodeId(sessionId: string): string {
    return `tree:session:${sessionId}`;
}

export function buildVisibleTreeTargets(
    targets: TreeTargetDescriptor[],
    collapsedTreeNodeIds: ReadonlySet<string>
): TreeTargetDescriptor[] {
    const visible: TreeTargetDescriptor[] = [];
    const hiddenBranches = new Set<string>();
    for (const target of targets) {
        if (target.kind === 'stage') {
            visible.push(target);
            if (collapsedTreeNodeIds.has(target.id) && target.stageId) {
                hiddenBranches.add(`stage:${target.stageId}`);
            } else if (target.stageId) {
                hiddenBranches.delete(`stage:${target.stageId}`);
            }
            continue;
        }

        if (target.stageId && hiddenBranches.has(`stage:${target.stageId}`)) {
            continue;
        }

        if (target.kind === 'task') {
            visible.push(target);
            if (collapsedTreeNodeIds.has(target.id) && target.taskId) {
                hiddenBranches.add(`task:${target.taskId}`);
            } else if (target.taskId) {
                hiddenBranches.delete(`task:${target.taskId}`);
            }
            continue;
        }

        if (target.taskId && hiddenBranches.has(`task:${target.taskId}`)) {
            continue;
        }

        visible.push(target);
    }
    return visible;
}

export function buildDefaultCollapsedTreeNodeIds(
    stages: MissionStageStatus[],
    sessions: MissionAgentSessionRecord[]
): Set<string> {
    const collapsed = new Set<string>();
    const runningSessionTaskIds = new Set(
        sessions
            .filter((session) =>
                session.lifecycleState === 'running'
                || session.lifecycleState === 'starting'
                || session.lifecycleState === 'awaiting-input'
            )
            .map((session) => session.taskId)
            .filter((taskId): taskId is string => typeof taskId === 'string' && taskId.length > 0)
    );

    for (const stage of stages) {
        const stageNodeId = createStageNodeId(stage.stage);
        const hasExpandedTask = stage.tasks.some(
            (task) => task.status === 'active' || runningSessionTaskIds.has(task.taskId)
        );
        if (stage.status !== 'active' && !hasExpandedTask) {
            collapsed.add(stageNodeId);
        }

        for (const task of stage.tasks) {
            const taskNodeId = createTaskNodeId(task.taskId);
            if (task.status !== 'active' && !runningSessionTaskIds.has(task.taskId)) {
                collapsed.add(taskNodeId);
            }
        }
    }

    return collapsed;
}

export function pickPreferredTreeTargetId(
    targets: TreeTargetDescriptor[],
    current: string | undefined,
    selected: {
        selectedStageId: MissionStageId | undefined;
        selectedTaskId: string;
        selectedSessionId: string | undefined;
    }
): string | undefined {
    if (targets.length === 0) {
        return undefined;
    }
    if (current && targets.some((target) => target.id === current)) {
        return current;
    }
    if (selected.selectedSessionId) {
        const sessionNodeId = createSessionNodeId(selected.selectedSessionId);
        if (targets.some((target) => target.id === sessionNodeId)) {
            return sessionNodeId;
        }
    }
    if (selected.selectedTaskId) {
        const taskNodeId = createTaskNodeId(selected.selectedTaskId);
        if (targets.some((target) => target.id === taskNodeId)) {
            return taskNodeId;
        }
        const taskArtifactId = createTaskArtifactNodeId(selected.selectedTaskId);
        if (targets.some((target) => target.id === taskArtifactId)) {
            return taskArtifactId;
        }
    }
    if (selected.selectedStageId) {
        const stageNodeId = createStageNodeId(selected.selectedStageId);
        if (targets.some((target) => target.id === stageNodeId)) {
            return stageNodeId;
        }
        const stageArtifactId = createStageArtifactNodeId(selected.selectedStageId);
        if (targets.some((target) => target.id === stageArtifactId)) {
            return stageArtifactId;
        }
    }
    return targets[0]?.id;
}

function clampIndex(index: number, length: number): number {
    return Math.max(0, Math.min(length - 1, index));
}

function createStageNodeId(stage: MissionStageId): string {
    return `tree:stage:${stage}`;
}

function createStageArtifactNodeId(stage: MissionStageId): string {
    return `tree:stage-artifact:${stage}`;
}

function createTaskNodeId(taskId: string): string {
    return `tree:task:${taskId}`;
}

function createTaskArtifactNodeId(taskId: string): string {
    return `tree:task-artifact:${taskId}`;
}