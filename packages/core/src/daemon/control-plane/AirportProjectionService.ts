// /packages/core/src/daemon/control-plane/AirportProjectionService.ts: Derives panel-facing airport projections from daemon state and system status.
import path from 'node:path';
import type {
	AirportProjectionSet,
	AirportState,
	PaneBinding,
	AirportPaneId
} from '../../airport/types.js';
import type { ContextGraph, SystemStatus } from '../../types.js';

export function deriveSystemAirportProjections(
	domain: ContextGraph,
	airportState: AirportState,
	systemStatus?: SystemStatus
): AirportProjectionSet {
	return {
		tower: deriveTowerProjection(domain, airportState, systemStatus),
		briefingRoom: deriveBriefingRoomProjection(domain, airportState),
		runway: deriveRunwayProjection(domain, airportState)
	};
}

function deriveTowerProjection(
	domain: ContextGraph,
	airportState: AirportState,
	systemStatus?: SystemStatus
): AirportProjectionSet['tower'] {
	const base = createPaneProjectionBase(airportState, 'tower');
	const repositoryId = airportState.repositoryId ?? domain.selection.repositoryId;
	const repositoryContext = repositoryId ? domain.repositories[repositoryId] : undefined;
	const githubStatus = systemStatus?.github;
	return {
		...base,
		...(repositoryId ? { repositoryId } : {}),
		repositoryLabel: repositoryContext?.displayLabel
			|| path.basename(airportState.repositoryRootPath || repositoryId || 'repository')
			|| 'Repository',
		subtitle: repositoryContext?.displayLabel
			|| airportState.repositoryRootPath
			|| 'Repository overview',
		emptyLabel: 'Tower is ready.',
		github: {
			cliAvailable: githubStatus?.cliAvailable ?? false,
			authenticated: githubStatus?.authenticated ?? false,
			...(githubStatus?.user ? { user: githubStatus.user } : {}),
			...(githubStatus?.detail ? { detail: githubStatus.detail } : {})
		}
	};
}

function deriveBriefingRoomProjection(domain: ContextGraph, airportState: AirportState): AirportProjectionSet['briefingRoom'] {
	const base = createPaneProjectionBase(airportState, 'briefingRoom');
	const artifactId = base.binding.targetKind === 'artifact'
		? base.binding.targetId
		: undefined;
	const artifactContext = artifactId ? domain.artifacts[artifactId] : undefined;
	const directArtifactPath = artifactId && !artifactContext ? artifactId : undefined;
	const missionContext = artifactContext?.missionId ? domain.missions[artifactContext.missionId] : undefined;
	const repositoryContext = airportState.repositoryId ? domain.repositories[airportState.repositoryId] : undefined;
	const launchPath = artifactContext?.filePath
		|| directArtifactPath
		|| missionContext?.workspacePath
		|| repositoryContext?.rootPath
		|| airportState.repositoryRootPath;
	return {
		...base,
		subtitle: artifactContext?.displayLabel
			|| artifactContext?.filePath
			|| directArtifactPath
			|| base.subtitle,
		...(artifactId ? { artifactId } : {}),
		...(artifactContext?.filePath
			? { artifactPath: artifactContext.filePath }
			: directArtifactPath
				? { artifactPath: directArtifactPath }
				: {}),
		...(artifactContext?.displayLabel ? { resourceLabel: artifactContext.displayLabel } : {}),
		...(launchPath ? { launchPath } : {}),
		emptyLabel: artifactContext?.filePath || directArtifactPath
			? 'Briefing Room is ready.'
			: 'Briefing Room is waiting for an artifact binding.'
	};
}

function deriveRunwayProjection(domain: ContextGraph, airportState: AirportState): AirportProjectionSet['runway'] {
	const base = createPaneProjectionBase(airportState, 'runway');
	const sessionId = base.binding.targetKind === 'agentSession'
		? base.binding.targetId
		: undefined;
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
			? 'Runway is bound and waiting for the session surface.'
			: 'Runway is idle.'
	};
}

function createPaneProjectionBase(
	airportState: AirportState,
	paneId: AirportPaneId
): AirportProjectionSet[keyof AirportProjectionSet] {
	const binding = airportState.panes[paneId];
	const terminalPane = airportState.substrate.panes[paneId];
	return {
		paneId,
		binding: structuredClone(binding),
		connectedClientIds: Object.values(airportState.clients)
			.filter((client) => client.connected && client.claimedPaneId === paneId)
			.map((client) => client.clientId),
		title: formatPaneTitle(paneId),
		subtitle: formatPaneSubtitle(binding),
		intentFocused: airportState.focus.intentPaneId === paneId,
		observedFocused: airportState.focus.observedPaneId === paneId,
		...(terminalPane ? { terminalPane: { ...terminalPane } } : {})
	} as AirportProjectionSet[keyof AirportProjectionSet];
}

function formatPaneTitle(paneId: AirportPaneId): string {
	switch (paneId) {
		case 'tower':
			return 'Tower';
		case 'briefingRoom':
			return 'Briefing Room';
		case 'runway':
			return 'Runway';
	}
	return paneId;
}

function formatPaneSubtitle(binding: PaneBinding): string {
	if (binding.targetKind === 'empty') {
		return 'No target bound';
	}

	const targetLabel = binding.targetId?.trim() || 'unresolved';
	return binding.mode ? `${binding.targetKind}:${targetLabel} (${binding.mode})` : `${binding.targetKind}:${targetLabel}`;
}