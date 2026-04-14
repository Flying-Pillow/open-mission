import type {
	AgentSessionContext,
	ArtifactContext,
	ContextGraph,
	ContextSelection,
	MissionResolvedSelection,
	MissionSelectionTarget,
	MissionStageId,
	TaskContext,
} from '../types.js';
import { getMissionStageDefinition } from '../workflow/manifest.js';

export function resolveMissionSelection(input: {
	target: MissionSelectionTarget | undefined;
	domain: ContextGraph | undefined;
	missionId?: string;
}): MissionResolvedSelection | undefined {
	const missionId = input.missionId?.trim() || undefined;
	const { target, domain } = input;
	if (!target || !domain) {
		return missionId ? { missionId } : undefined;
	}

	switch (target.kind) {
		case 'session':
			return resolveSessionTarget(target, domain, missionId);
		case 'task':
		case 'task-artifact':
			return resolveTaskTarget(target, domain, missionId);
		case 'stage':
		case 'stage-artifact':
			return resolveStageTarget(target, domain, missionId);
	}

	return missionId ? { missionId } : undefined;
}

export function resolveMissionSelectionFromContext(input: {
	selection: ContextSelection;
	domain: ContextGraph;
}): MissionResolvedSelection | undefined {
	const { selection, domain } = input;
	if (selection.artifactId) {
		const artifact = domain.artifacts[selection.artifactId];
		if (artifact?.ownerTaskId) {
			const missionId = selection.missionId?.trim();
			return resolveMissionSelection({
				target: {
					kind: 'task-artifact',
					taskId: artifact.ownerTaskId,
					...(selection.stageId ? { stageId: selection.stageId } : {}),
					sourcePath: artifact.filePath
				},
				domain,
				...(missionId ? { missionId } : {})
			});
		}
		if (selection.stageId) {
			const missionId = selection.missionId?.trim();
			return resolveMissionSelection({
				target: {
					kind: 'stage-artifact',
					stageId: selection.stageId,
					...(artifact?.filePath ? { sourcePath: artifact.filePath } : {})
				},
				domain,
				...(missionId ? { missionId } : {})
			});
		}
	}
	if (selection.agentSessionId) {
		const missionId = selection.missionId?.trim();
		return resolveMissionSelection({
			target: {
				kind: 'session',
				sessionId: selection.agentSessionId,
				...(selection.taskId ? { taskId: selection.taskId } : {}),
				...(selection.stageId ? { stageId: selection.stageId } : {})
			},
			domain,
			...(missionId ? { missionId } : {})
		});
	}
	if (selection.taskId) {
		const missionId = selection.missionId?.trim();
		return resolveMissionSelection({
			target: {
				kind: 'task',
				taskId: selection.taskId,
				...(selection.stageId ? { stageId: selection.stageId } : {})
			},
			domain,
			...(missionId ? { missionId } : {})
		});
	}
	if (selection.stageId) {
		const missionId = selection.missionId?.trim();
		return resolveMissionSelection({
			target: {
				kind: 'stage',
				stageId: selection.stageId
			},
			domain,
			...(missionId ? { missionId } : {})
		});
	}
	return selection.missionId ? { missionId: selection.missionId } : undefined;
}

function resolveSessionTarget(
	target: MissionSelectionTarget,
	domain: ContextGraph,
	missionId: string | undefined
): MissionResolvedSelection | undefined {
	const explicitSessionId = target.sessionId?.trim();
	const session = explicitSessionId ? domain.agentSessions[explicitSessionId] : undefined;
	const taskId = session?.taskId ?? target.taskId;
	const task = taskId ? domain.tasks[taskId] : undefined;
	const instruction = task ? resolveTaskInstructionArtifact(task, domain) : undefined;
	const resolvedMissionId = missionId ?? session?.missionId ?? task?.missionId;
	return {
		...(resolvedMissionId ? { missionId: resolvedMissionId } : {}),
		...(task?.stageId ?? target.stageId ? { stageId: (task?.stageId ?? target.stageId)! } : {}),
		...(taskId ? { taskId } : {}),
		...(instruction ? { activeInstructionArtifactId: instruction.artifactId, activeInstructionPath: instruction.filePath } : {}),
		...(explicitSessionId ? { activeAgentSessionId: explicitSessionId } : {})
	};
}

function resolveTaskTarget(
	target: MissionSelectionTarget,
	domain: ContextGraph,
	missionId: string | undefined
): MissionResolvedSelection | undefined {
	const taskId = target.taskId?.trim();
	if (!taskId) {
		return missionId ? { missionId } : undefined;
	}
	const task = domain.tasks[taskId];
	const instruction = resolveTaskInstructionArtifact(task, domain, target.sourcePath);
	const preferredSession = resolvePreferredTaskSession(taskId, task, domain);
	const resolvedMissionId = missionId ?? task?.missionId ?? preferredSession?.missionId;
	return {
		...(resolvedMissionId ? { missionId: resolvedMissionId } : {}),
		...(task?.stageId ?? target.stageId ? { stageId: (task?.stageId ?? target.stageId)! } : {}),
		taskId,
		...(instruction ? { activeInstructionArtifactId: instruction.artifactId, activeInstructionPath: instruction.filePath } : {}),
		...(preferredSession?.sessionId ? { activeAgentSessionId: preferredSession.sessionId } : {})
	};
}

function resolveStageTarget(
	target: MissionSelectionTarget,
	domain: ContextGraph,
	missionId: string | undefined
): MissionResolvedSelection | undefined {
	const stageId = target.stageId;
	if (!stageId) {
		return missionId ? { missionId } : undefined;
	}
	const stageArtifact = resolveStageResultArtifact(stageId, domain, missionId, target.sourcePath);
	return {
		...(missionId ? { missionId } : stageArtifact?.missionId ? { missionId: stageArtifact.missionId } : {}),
		stageId,
		...(stageArtifact ? { activeStageResultArtifactId: stageArtifact.artifactId, activeStageResultPath: stageArtifact.filePath } : {})
	};
}

function resolveTaskInstructionArtifact(
	task: TaskContext | undefined,
	domain: ContextGraph,
	explicitPath?: string
): ArtifactContext | undefined {
	const normalizedPath = explicitPath?.trim();
	if (normalizedPath) {
		const explicitArtifact = Object.values(domain.artifacts).find((artifact) =>
			artifact.filePath === normalizedPath && (!task?.taskId || artifact.ownerTaskId === task.taskId)
		);
		if (explicitArtifact) {
			return explicitArtifact;
		}
	}
	if (task?.primaryArtifactId) {
		const primaryArtifact = domain.artifacts[task.primaryArtifactId];
		if (primaryArtifact) {
			return primaryArtifact;
		}
	}
	if (!task?.taskId) {
		return undefined;
	}
	return Object.values(domain.artifacts).find((artifact) => artifact.ownerTaskId === task.taskId);
}

function resolveStageResultArtifact(
	stageId: MissionStageId,
	domain: ContextGraph,
	missionId: string | undefined,
	explicitPath?: string
): ArtifactContext | undefined {
	const normalizedPath = explicitPath?.trim();
	if (normalizedPath) {
		const explicitArtifact = Object.values(domain.artifacts).find((artifact) => artifact.filePath === normalizedPath);
		if (explicitArtifact) {
			return explicitArtifact;
		}
	}
	const stageArtifactKeys = getMissionStageDefinition(stageId).artifacts;
	for (const artifactKey of stageArtifactKeys) {
		const artifact = Object.values(domain.artifacts).find((candidate) =>
			candidate.logicalKind === artifactKey && (!missionId || candidate.missionId === missionId)
		);
		if (artifact) {
			return artifact;
		}
	}
	return undefined;
}

function resolvePreferredTaskSession(
	taskId: string,
	task: TaskContext | undefined,
	domain: ContextGraph
): AgentSessionContext | undefined {
	const candidateSessionIds = task?.agentSessionIds?.length
		? task.agentSessionIds
		: Object.values(domain.agentSessions)
			.filter((session) => session.taskId === taskId)
			.map((session) => session.sessionId);
	const sessions = candidateSessionIds
		.map((sessionId) => domain.agentSessions[sessionId])
		.filter((session): session is AgentSessionContext => Boolean(session));
	return sessions.sort(compareAgentSessionsByRecencyDesc)[0];
}

function compareAgentSessionsByRecencyDesc(left: AgentSessionContext, right: AgentSessionContext): number {
	const leftUpdated = left.lastUpdatedAt ?? left.createdAt ?? '';
	const rightUpdated = right.lastUpdatedAt ?? right.createdAt ?? '';
	if (leftUpdated !== rightUpdated) {
		return rightUpdated.localeCompare(leftUpdated);
	}
	const leftCreated = left.createdAt ?? '';
	const rightCreated = right.createdAt ?? '';
	if (leftCreated !== rightCreated) {
		return rightCreated.localeCompare(leftCreated);
	}
	return right.sessionId.localeCompare(left.sessionId);
}