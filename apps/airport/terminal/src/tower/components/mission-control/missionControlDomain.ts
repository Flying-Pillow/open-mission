import type {
	ContextGraph,
	MissionTowerTreeNode,
	MissionAgentSessionRecord,
	MissionSelectionCandidate,
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
		tasks.find((task) => task.status === 'running') ??
		tasks.find((task) => task.status === 'queued') ??
		tasks.find((task) => task.status === 'ready' && task.blockedBy.length === 0) ??
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

	return collapsed;
}

function clampIndex(index: number, length: number): number {
	return Math.max(0, Math.min(length - 1, index));
}

function createStageNodeId(stage: MissionStageId): string {
	return `tree:stage:${stage}`;
}

function createTaskNodeId(taskId: string): string {
	return `tree:task:${taskId}`;
}

export function buildProjectedStageStatuses(
	domain: ContextGraph | undefined,
	stageRail: Array<{ id: string; label: string; state: string }> | undefined
): MissionStageStatus[] {
	if (!domain) {
		return [];
	}

	const tasksByStage = new Map<MissionStageId, MissionTaskState[]>();
	for (const taskContext of Object.values(domain.tasks)) {
		const blockedBy = taskContext.dependencyIds.filter((dependencyId) => domain.tasks[dependencyId]?.lifecycleState !== 'completed');
		const tasks = tasksByStage.get(taskContext.stageId) ?? [];
		tasks.push({
			taskId: taskContext.taskId,
			stage: taskContext.stageId,
			sequence: tasks.length + 1,
			subject: taskContext.subject,
			instruction: taskContext.instructionSummary,
			body: taskContext.instructionSummary,
			dependsOn: [...taskContext.dependencyIds],
			blockedBy,
			status: taskContext.lifecycleState,
			agent: 'projected',
			retries: 0,
			fileName: `${taskContext.taskId}.md`,
			filePath: taskContext.taskId,
			relativePath: taskContext.taskId
		});
		tasksByStage.set(taskContext.stageId, tasks);
	}

	const orderedStageIds = new Set<MissionStageId>();
	for (const item of stageRail ?? []) {
		if (item.id) {
			orderedStageIds.add(item.id as MissionStageId);
		}
	}
	for (const stageId of tasksByStage.keys()) {
		orderedStageIds.add(stageId);
	}

	return [...orderedStageIds].map((stageId) => {
		const tasks = (tasksByStage.get(stageId) ?? []).sort((left, right) => left.sequence - right.sequence || left.taskId.localeCompare(right.taskId));
		const activeTaskIds = tasks
			.filter((task) => task.status === 'queued' || task.status === 'running')
			.map((task) => task.taskId);
		const readyTaskIds = tasks.filter((task) => task.status === 'ready' && task.blockedBy.length === 0).map((task) => task.taskId);
		const completedTaskCount = tasks.filter((task) => task.status === 'completed').length;
		const railState = stageRail?.find((item) => item.id === stageId)?.state;
		const status = railState === 'completed' || railState === 'active' || railState === 'blocked' || railState === 'ready' || railState === 'pending'
			? railState
			: activeTaskIds.length > 0
				? 'active'
				: completedTaskCount === tasks.length && tasks.length > 0
					? 'completed'
					: tasks.some((task) => task.status === 'blocked' || task.status === 'failed' || task.status === 'cancelled' || task.blockedBy.length > 0)
						? 'blocked'
						: readyTaskIds.length > 0
							? 'ready'
						: 'pending';
		return {
			stage: stageId,
			folderName: stageId,
			status,
			taskCount: tasks.length,
			completedTaskCount,
			activeTaskIds,
			readyTaskIds,
			tasks
		};
	});
}

export function buildProjectedSessionRecords(
	domain: ContextGraph | undefined
): MissionAgentSessionRecord[] {
	if (!domain) {
		return [];
	}

	return Object.values(domain.agentSessions)
		.map((session) => ({
			sessionId: session.sessionId,
			runnerId: session.runnerId,
			runnerLabel: session.runnerId,
			lifecycleState: session.lifecycleState as MissionAgentSessionRecord['lifecycleState'],
			...(session.taskId ? { taskId: session.taskId } : {}),
			...(session.taskId ? { assignmentLabel: domain.tasks[session.taskId]?.subject ?? session.taskId } : {}),
			...(session.workingDirectory ? { workingDirectory: session.workingDirectory } : {}),
			...(session.promptTitle ? { currentTurnTitle: session.promptTitle } : {}),
			...(session.transportId ? { transportId: session.transportId } : {}),
			...(session.terminalSessionName ? { terminalSessionName: session.terminalSessionName } : {}),
			...(session.terminalPaneId ? { terminalPaneId: session.terminalPaneId } : {}),
			createdAt: '',
			lastUpdatedAt: ''
		}))
		.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
}

export function buildProjectedMissionCandidates(
	domain: ContextGraph | undefined
): MissionSelectionCandidate[] {
	return Object.values(domain?.missions ?? {})
		.map((mission) => ({
			missionId: mission.missionId,
			title: mission.briefSummary,
			branchRef: mission.branchRef ?? mission.missionId,
			createdAt: mission.createdAt ?? '',
			...(mission.issueId !== undefined ? { issueId: mission.issueId } : {})
		} satisfies MissionSelectionCandidate))
		.sort((left, right) => left.missionId.localeCompare(right.missionId));
}