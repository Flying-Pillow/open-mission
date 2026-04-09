import path from 'node:path';
import type { AirportProjectionSet, AirportState, GateBinding, GateId } from '../../../../airport/build/index.js';
import type {
	ContextGraph,
	MissionStageId,
	MissionSystemActionProjections,
	OperatorActionTargetContext
} from '../../types.js';
import { resolveAvailableActionsForTargetContext } from '../../lib/operatorActionTargeting.js';

export function deriveSystemAirportProjections(
	domain: ContextGraph,
	airportState: AirportState
): AirportProjectionSet {
	return {
		dashboard: deriveDashboardProjection(domain, airportState),
		editor: deriveEditorProjection(domain, airportState),
		agentSession: deriveAgentSessionProjection(domain, airportState)
	};
}

export function deriveSystemActionProjections(
	domain: ContextGraph,
	airportProjections: AirportProjectionSet
): MissionSystemActionProjections {
	const targetContext = deriveActionTargetContext(airportProjections.dashboard.commandContext);
	return {
		dashboard: {
			targetContext,
			availableActions: resolveAvailableActionsForTargetContext(domain.availableActions, targetContext)
		}
	};
}

function deriveDashboardProjection(domain: ContextGraph, airportState: AirportState): AirportProjectionSet['dashboard'] {
	const base = createGateProjectionBase(airportState, 'dashboard');
	const repositoryId = airportState.repositoryId ?? domain.selection.repositoryId;
	const repositoryContext = repositoryId ? domain.repositories[repositoryId] : undefined;
	const requestedMissionId = base.binding.targetKind === 'mission'
		? base.binding.targetId
		: domain.selection.missionId;
	const requestedMissionContext = requestedMissionId ? domain.missions[requestedMissionId] : undefined;
	const missionId = requestedMissionContext?.tower ? requestedMissionId : undefined;
	const missionContext = missionId ? requestedMissionContext : undefined;
	const commandContext = deriveDashboardCommandContext(domain, repositoryContext, missionContext);
	return {
		...base,
		surfaceMode: missionId ? 'mission' : 'repository',
		centerRoute: missionId ? 'mission-control' : 'repository-flow',
		...(repositoryId ? { repositoryId } : {}),
		repositoryLabel: repositoryContext?.displayLabel
			|| path.basename(airportState.repositoryRootPath || repositoryId || 'repository')
			|| 'Repository',
		...(missionId ? { missionId } : {}),
		...(missionContext?.briefSummary ? { missionLabel: missionContext.briefSummary } : missionId ? { missionLabel: missionId } : {}),
		...(commandContext.stageId ? { selectedStageId: commandContext.stageId } : {}),
		...(domain.selection.taskId ? { selectedTaskId: domain.selection.taskId } : {}),
		...(domain.selection.agentSessionId ? { selectedSessionId: domain.selection.agentSessionId } : {}),
		commandContext,
		stageRail: missionContext?.tower?.stageRail.map((item) => ({ ...item })) ?? [],
		treeNodes: missionContext?.tower?.treeNodes.map((node) => ({ ...node })) ?? [],
		subtitle: missionContext?.briefSummary
			|| missionId
			|| repositoryContext?.displayLabel
			|| airportState.repositoryRootPath
			|| 'Repository overview',
		emptyLabel: missionId
			? 'Mission control is ready.'
			: 'Repository mode is ready.'
	};
}

function deriveEditorProjection(domain: ContextGraph, airportState: AirportState): AirportProjectionSet['editor'] {
	const base = createGateProjectionBase(airportState, 'editor');
	const artifactId = base.binding.targetKind === 'artifact'
		? base.binding.targetId
		: domain.selection.artifactId;
	const artifactContext = artifactId ? domain.artifacts[artifactId] : undefined;
	const missionContext = artifactContext?.missionId ? domain.missions[artifactContext.missionId] : undefined;
	const repositoryContext = airportState.repositoryId ? domain.repositories[airportState.repositoryId] : undefined;
	const launchPath = artifactContext?.filePath
		|| missionContext?.workspacePath
		|| repositoryContext?.rootPath
		|| airportState.repositoryRootPath;
	return {
		...base,
		subtitle: artifactContext?.displayLabel
			|| artifactContext?.filePath
			|| base.subtitle,
		...(artifactId ? { artifactId } : {}),
		...(artifactContext?.filePath ? { artifactPath: artifactContext.filePath } : {}),
		...(artifactContext?.displayLabel ? { resourceLabel: artifactContext.displayLabel } : {}),
		...(launchPath ? { launchPath } : {}),
		emptyLabel: artifactContext?.filePath
			? 'Editor gate is ready.'
			: 'Editor gate is waiting for an artifact binding.'
	};
}

function deriveAgentSessionProjection(domain: ContextGraph, airportState: AirportState): AirportProjectionSet['agentSession'] {
	const base = createGateProjectionBase(airportState, 'agentSession');
	const sessionId = base.binding.targetKind === 'agentSession'
		? base.binding.targetId
		: domain.selection.agentSessionId;
	const sessionContext = sessionId ? domain.agentSessions[sessionId] : undefined;
	const taskId = sessionContext?.taskId || (base.binding.targetKind === 'task' ? base.binding.targetId : undefined);
	return {
		...base,
		subtitle: sessionContext?.promptTitle
			|| sessionId
			|| base.subtitle,
		...(sessionId ? { sessionId, sessionLabel: sessionId } : {}),
		...(taskId ? { taskId } : {}),
		...(sessionContext?.missionId ? { missionId: sessionContext.missionId } : {}),
		...(sessionContext?.workingDirectory ? { workingDirectory: sessionContext.workingDirectory } : {}),
		statusLabel: sessionContext?.lifecycleState || (sessionId ? 'bound' : 'idle'),
		emptyLabel: sessionId
			? 'Agent session gate is bound and waiting for the session surface.'
			: 'Agent session gate is idle.'
	};
}

function deriveDashboardCommandContext(
	domain: ContextGraph,
	repositoryContext: ContextGraph['repositories'][string] | undefined,
	missionContext: ContextGraph['missions'][string] | undefined
): AirportProjectionSet['dashboard']['commandContext'] {
	const sessionId = domain.selection.agentSessionId;
	if (sessionId) {
		const sessionContext = domain.agentSessions[sessionId];
		const sessionTask = sessionContext?.taskId ? domain.tasks[sessionContext.taskId] : undefined;
		return {
			...(sessionTask?.stageId ? { stageId: sessionTask.stageId } : {}),
			...(sessionContext?.taskId ? { taskId: sessionContext.taskId } : {}),
			sessionId,
			targetLabel: sessionContext?.promptTitle || sessionId,
			targetKind: 'session'
		};
	}

	const taskId = domain.selection.taskId;
	if (taskId) {
		const taskContext = domain.tasks[taskId];
		return {
			...(taskContext?.stageId ? { stageId: taskContext.stageId } : {}),
			taskId,
			targetLabel: taskContext?.subject || taskId,
			targetKind: 'task'
		};
	}

	const artifactId = domain.selection.artifactId;
	if (artifactId) {
		const artifactContext = domain.artifacts[artifactId];
		const artifactTask = artifactContext?.ownerTaskId ? domain.tasks[artifactContext.ownerTaskId] : undefined;
		return {
			...(artifactContext?.ownerTaskId ? { taskId: artifactContext.ownerTaskId } : {}),
			...(artifactTask?.stageId ? { stageId: artifactTask.stageId } : {}),
			targetLabel: artifactContext?.displayLabel || artifactId,
			targetKind: 'task-artifact'
		};
	}

	const stageId = domain.selection.stageId;
	if (stageId) {
		const stageLabel = missionContext?.tower?.stageRail.find((item) => item.id === stageId)?.label || stageId;
		return {
			stageId,
			targetLabel: stageLabel,
			targetKind: 'stage'
		};
	}

	if (missionContext) {
		return {
			...(missionContext.currentStage ? { stageId: missionContext.currentStage } : {}),
			targetLabel: missionContext.briefSummary,
			targetKind: 'mission'
		};
	}

	if (repositoryContext) {
		return {
			targetLabel: repositoryContext.displayLabel,
			targetKind: 'repository'
		};
	}

	return {};
}

function deriveActionTargetContext(
	commandContext: AirportProjectionSet['dashboard']['commandContext']
): OperatorActionTargetContext {
	return {
		...(commandContext.stageId ? { stageId: commandContext.stageId as MissionStageId } : {}),
		...(commandContext.taskId ? { taskId: commandContext.taskId } : {}),
		...(commandContext.sessionId ? { sessionId: commandContext.sessionId } : {})
	};
}

function createGateProjectionBase(
	airportState: AirportState,
	gateId: GateId
): AirportProjectionSet[keyof AirportProjectionSet] {
	const binding = airportState.gates[gateId];
	const pane = airportState.substrate.panesByGate[gateId];
	return {
		gateId,
		binding: structuredClone(binding),
		connectedClientIds: Object.values(airportState.clients)
			.filter((client) => client.connected && client.claimedGateId === gateId)
			.map((client) => client.clientId),
		title: formatGateTitle(gateId),
		subtitle: formatGateSubtitle(binding),
		intentFocused: airportState.focus.intentGateId === gateId,
		observedFocused: airportState.focus.observedGateId === gateId,
		...(pane ? { pane: { ...pane } } : {})
	} as AirportProjectionSet[keyof AirportProjectionSet];
}

function formatGateTitle(gateId: GateId): string {
	switch (gateId) {
		case 'dashboard':
			return 'Dashboard';
		case 'editor':
			return 'Editor';
		case 'agentSession':
			return 'Agent Session';
	}
	return gateId;
}

function formatGateSubtitle(binding: GateBinding): string {
	if (binding.targetKind === 'empty') {
		return 'No target bound';
	}

	const targetLabel = binding.targetId?.trim() || 'unresolved';
	return binding.mode ? `${binding.targetKind}:${targetLabel} (${binding.mode})` : `${binding.targetKind}:${targetLabel}`;
}