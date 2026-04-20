import { resolveMissionSelection } from '@flying-pillow/mission-core/browser';
import type {
    AgentSessionContext,
    ArtifactContext,
    ContextGraph,
    MissionResolvedSelection,
    MissionSelectionTarget,
    MissionTowerTreeNode,
    OperatorStatus
} from '@flying-pillow/mission-core/types.js';

export type MissionControlComputedState = {
    domain?: ContextGraph;
    treeNodes: MissionTowerTreeNode[];
    visibleTreeNodes: MissionTowerTreeNode[];
    selectedNodeId?: string;
    selectedNode?: MissionTowerTreeNode;
    selectedTarget?: MissionSelectionTarget;
    resolvedSelection?: MissionResolvedSelection;
    activeArtifact?: ArtifactContext;
    activeArtifactPath?: string;
    activeSession?: AgentSessionContext;
    activeSessionId?: string;
};

export function createInitialCollapsedNodeIds(status: OperatorStatus): string[] {
    const collapsed = new Set<string>();
    const runningSessionTaskIds = new Set(
        (status.agentSessions ?? [])
            .filter((session) =>
                session.lifecycleState === 'running'
                || session.lifecycleState === 'starting'
                || session.lifecycleState === 'awaiting-input'
            )
            .map((session) => session.taskId)
            .filter((taskId): taskId is string => typeof taskId === 'string' && taskId.length > 0)
    );

    for (const stage of status.stages ?? []) {
        const stageNodeId = createStageNodeId(stage.stage);
        const hasExpandedTask = stage.tasks.some(
            (task) => task.status === 'queued' || task.status === 'running' || runningSessionTaskIds.has(task.taskId)
        );
        if (stage.status !== 'active' && !hasExpandedTask) {
            collapsed.add(stageNodeId);
        }

        for (const task of stage.tasks) {
            const taskNodeId = createTaskNodeId(task.taskId);
            if (task.status !== 'queued' && task.status !== 'running' && !runningSessionTaskIds.has(task.taskId)) {
                collapsed.add(taskNodeId);
            }
        }
    }

    return [...collapsed];
}

export function createInitialSelectedNodeId(
    status: OperatorStatus,
    currentSelectedNodeId?: string
): string | undefined {
    const treeNodes = status.tower?.treeNodes ?? [];
    if (currentSelectedNodeId && treeNodes.some((node) => node.id === currentSelectedNodeId)) {
        return currentSelectedNodeId;
    }

    const domain = status.system?.state.domain;
    const selectedNodeId = domain ? deriveNodeIdFromContextSelection(domain, treeNodes) : undefined;
    return selectedNodeId ?? treeNodes[0]?.id;
}

export function ensureNodeVisible(
    collapsedNodeIds: string[],
    treeNodes: MissionTowerTreeNode[],
    nodeId?: string
): string[] {
    if (!nodeId) {
        return collapsedNodeIds;
    }

    const node = treeNodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
        return collapsedNodeIds;
    }

    const next = new Set(collapsedNodeIds);
    if (node.kind !== 'stage' && node.stageId) {
        next.delete(createStageNodeId(node.stageId));
    }
    if ((node.kind === 'task-artifact' || node.kind === 'session') && node.taskId) {
        next.delete(createTaskNodeId(node.taskId));
    }

    return [...next];
}

export function toggleCollapsedNodeId(currentNodeIds: string[], nodeId: string): string[] {
    const next = new Set(currentNodeIds);
    if (next.has(nodeId)) {
        next.delete(nodeId);
    } else {
        next.add(nodeId);
    }
    return [...next];
}

export function buildVisibleTreeNodes(
    treeNodes: MissionTowerTreeNode[],
    collapsedNodeIds: string[]
): MissionTowerTreeNode[] {
    const collapsed = new Set(collapsedNodeIds);
    const visible: MissionTowerTreeNode[] = [];
    const hiddenBranches = new Set<string>();

    for (const node of treeNodes) {
        if (node.kind === 'stage') {
            visible.push(node);
            if (collapsed.has(node.id) && node.stageId) {
                hiddenBranches.add(`stage:${node.stageId}`);
            } else if (node.stageId) {
                hiddenBranches.delete(`stage:${node.stageId}`);
            }
            continue;
        }

        if (node.stageId && hiddenBranches.has(`stage:${node.stageId}`)) {
            continue;
        }

        if (node.kind === 'task') {
            visible.push(node);
            if (collapsed.has(node.id) && node.taskId) {
                hiddenBranches.add(`task:${node.taskId}`);
            } else if (node.taskId) {
                hiddenBranches.delete(`task:${node.taskId}`);
            }
            continue;
        }

        if (node.taskId && hiddenBranches.has(`task:${node.taskId}`)) {
            continue;
        }

        visible.push(node);
    }

    return visible;
}

export function computeMissionControlState(input: {
    status: OperatorStatus;
    selectedNodeId?: string;
    collapsedNodeIds?: string[];
}): MissionControlComputedState {
    const domain = input.status.system?.state.domain;
    const treeNodes = input.status.tower?.treeNodes ?? [];
    const collapsedNodeIds = ensureNodeVisible(
        input.collapsedNodeIds ?? [],
        treeNodes,
        input.selectedNodeId
    );
    const visibleTreeNodes = buildVisibleTreeNodes(treeNodes, collapsedNodeIds);
    const selectedNodeId = visibleTreeNodes.some((node) => node.id === input.selectedNodeId)
        ? input.selectedNodeId
        : createInitialSelectedNodeId(input.status, input.selectedNodeId);
    const selectedNode = treeNodes.find((node) => node.id === selectedNodeId);
    const selectedTarget = selectedNode ? toSelectionTarget(selectedNode) : undefined;
    const resolvedSelection = resolveMissionSelection({
        target: selectedTarget,
        domain,
        missionId: input.status.missionId
    });
    const activeArtifactPath = resolvedSelection?.activeMissionArtifactPath
        ?? resolvedSelection?.activeInstructionPath
        ?? resolvedSelection?.activeStageResultPath;
    const activeArtifact = activeArtifactPath && domain
        ? Object.values(domain.artifacts).find((artifact: ArtifactContext) => artifact.filePath === activeArtifactPath)
        : undefined;
    const activeSessionId = resolvedSelection?.activeAgentSessionId;
    const activeSession = activeSessionId && domain ? domain.agentSessions[activeSessionId] : undefined;

    return {
        domain,
        treeNodes,
        visibleTreeNodes,
        selectedNodeId,
        selectedNode,
        selectedTarget,
        resolvedSelection,
        activeArtifact,
        activeArtifactPath,
        activeSession,
        activeSessionId
    };
}

function deriveNodeIdFromContextSelection(
    domain: ContextGraph,
    treeNodes: MissionTowerTreeNode[]
): string | undefined {
    const selection = domain.selection;
    if (selection.agentSessionId) {
        const nodeId = createSessionNodeId(selection.agentSessionId);
        return treeNodes.some((node) => node.id === nodeId) ? nodeId : undefined;
    }

    if (selection.artifactId) {
        const artifact = domain.artifacts[selection.artifactId];
        if (artifact?.ownerTaskId) {
            const nodeId = `tree:task-artifact:${artifact.ownerTaskId}`;
            return treeNodes.find((node) =>
                node.id === nodeId && node.sourcePath === artifact.filePath
            )?.id;
        }
        if (selection.stageId) {
            const nodeId = `tree:stage-artifact:${selection.stageId}`;
            return treeNodes.find((node) =>
                node.id === nodeId && (!artifact?.filePath || node.sourcePath === artifact.filePath)
            )?.id;
        }

        return treeNodes.find((node) =>
            node.kind === 'mission-artifact' && node.sourcePath === artifact?.filePath
        )?.id;
    }

    if (selection.taskId) {
        const nodeId = createTaskNodeId(selection.taskId);
        return treeNodes.some((node) => node.id === nodeId) ? nodeId : undefined;
    }

    if (selection.stageId) {
        const nodeId = createStageNodeId(selection.stageId);
        return treeNodes.some((node) => node.id === nodeId) ? nodeId : undefined;
    }

    return undefined;
}

function toSelectionTarget(node: MissionTowerTreeNode): MissionSelectionTarget {
    return {
        kind: node.kind,
        label: node.label,
        ...(node.sourcePath ? { sourcePath: node.sourcePath } : {}),
        ...(node.stageId ? { stageId: node.stageId } : {}),
        ...(node.taskId ? { taskId: node.taskId } : {}),
        ...(node.sessionId ? { sessionId: node.sessionId } : {})
    };
}

function createStageNodeId(stageId: string): string {
    return `tree:stage:${stageId}`;
}

function createTaskNodeId(taskId: string): string {
    return `tree:task:${taskId}`;
}

function createSessionNodeId(sessionId: string): string {
    return `tree:session:${sessionId}`;
}