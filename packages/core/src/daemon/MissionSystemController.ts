import {
	planAirportSubstrateEffects,
	type AirportProjectionSet,
	type AirportSubstrateEffect,
	type AirportSubstrateState,
	type BindAirportPaneParams,
	type ConnectAirportClientParams,
	type PaneBinding,
	type AirportPaneId
} from '../../../airport/build/index.js';
import type {
	ContextGraph,
	ContextSelection,
	MissionSystemSnapshot,
	MissionSystemState
} from '../types.js';
import { MissionControl } from './system/MissionControl.js';
import { deriveSystemAirportProjections } from './system/ProjectionService.js';
import { RepositoryAirportRegistry } from './system/RepositoryAirportRegistry.js';
import { WorkspaceManager } from './WorkspaceManager.js';

type MissionSystemCommand =
	| {
		kind: 'workspace.synchronized';
		surfacePath?: string;
		workspaceRoot?: string;
		selectionHint?: Partial<ContextSelection>;
	}
	| {
		kind: 'airport.client.connected';
		params: ConnectAirportClientParams & { surfacePath?: string; terminalSessionName?: string };
	}
	| {
		kind: 'airport.client.disconnected';
		clientId: string;
	}
	| {
		kind: 'airport.client.observed';
		params: {
			clientId: string;
			focusedPaneId?: AirportPaneId;
			intentPaneId?: AirportPaneId;
			repositoryId?: string;
			surfacePath?: string;
			terminalPaneId?: number;
			terminalSessionName?: string;
		};
	}
	| {
		kind: 'airport.pane.bound';
		params: BindAirportPaneParams;
	}
	| {
		kind: 'airport.substrate.observed';
		repositoryId: string;
		substrate: AirportSubstrateState;
	};

export class MissionSystemController {
	private readonly missionControl = new MissionControl();
	private readonly airportRegistry = new RepositoryAirportRegistry();
	private version = 0;
	private serializedState = '';

	public constructor(private readonly workspaceManager: WorkspaceManager) {
		this.serializedState = this.serializeSystemState();
	}

	public getSnapshot(): MissionSystemSnapshot {
		return this.buildSnapshot();
	}

	public async scopeAirportToSurfacePath(surfacePath?: string): Promise<MissionSystemSnapshot> {
		return this.dispatch({
			kind: 'workspace.synchronized',
			...(surfacePath?.trim() ? { surfacePath: surfacePath.trim() } : {})
		});
	}

	public async synchronizeWorkspace(input: {
		surfacePath?: string;
		workspaceRoot?: string;
		selectionHint?: Partial<ContextSelection>;
	}): Promise<MissionSystemSnapshot> {
		return this.dispatch({
			kind: 'workspace.synchronized',
			...(input.surfacePath?.trim() ? { surfacePath: input.surfacePath.trim() } : {}),
			...(input.workspaceRoot?.trim() ? { workspaceRoot: input.workspaceRoot.trim() } : {}),
			...(input.selectionHint ? { selectionHint: input.selectionHint } : {})
		});
	}

	public async connectAirportClient(params: {
		clientId: string;
		label?: string;
		surfacePath?: string;
		paneId: AirportPaneId;
		panelProcessId?: string;
		terminalPaneId?: number;
		terminalSessionName?: string;
	}): Promise<MissionSystemSnapshot> {
		return this.dispatch({ kind: 'airport.client.connected', params });
	}

	public async disconnectAirportClient(clientId: string): Promise<MissionSystemSnapshot | undefined> {
		if (!this.airportRegistry.getRepositoryIdForClient(clientId)) {
			return undefined;
		}
		return this.dispatch({ kind: 'airport.client.disconnected', clientId });
	}

	public async observeAirportClient(params: {
		clientId: string;
		focusedPaneId?: AirportPaneId;
		intentPaneId?: AirportPaneId;
		repositoryId?: string;
		surfacePath?: string;
		terminalPaneId?: number;
		terminalSessionName?: string;
	}): Promise<MissionSystemSnapshot> {
		return this.dispatch({ kind: 'airport.client.observed', params });
	}

	public async bindAirportPane(params: {
		paneId: AirportPaneId;
		binding: PaneBinding;
	}): Promise<MissionSystemSnapshot> {
		return this.dispatch({ kind: 'airport.pane.bound', params });
	}

	private async dispatch(
		command: MissionSystemCommand,
		options: { applyEffects?: boolean } = {}
	): Promise<MissionSystemSnapshot> {
		const touchedRepositoryIds = await this.reduceCommand(command);
		const plannedEffects = this.planEffects(touchedRepositoryIds);
		await this.commit(touchedRepositoryIds);

		if (options.applyEffects === false || command.kind === 'airport.substrate.observed') {
			return this.buildSnapshot();
		}

		await this.applyEffects(plannedEffects);
		const followUpCommands = await this.collectSubstrateObservations(touchedRepositoryIds);
		for (const followUpCommand of followUpCommands) {
			await this.dispatch(followUpCommand, { applyEffects: false });
		}

		return this.buildSnapshot();
	}

	private async reduceCommand(command: MissionSystemCommand): Promise<string[]> {
		switch (command.kind) {
			case 'workspace.synchronized':
				return this.reduceWorkspaceSynchronization(command);
			case 'airport.client.connected':
				return this.reduceAirportClientConnected(command.params);
			case 'airport.client.disconnected':
				return this.reduceAirportClientDisconnected(command.clientId);
			case 'airport.client.observed':
				return this.reduceAirportClientObserved(command.params);
			case 'airport.pane.bound':
				return this.reduceAirportPaneBound(command.params);
			case 'airport.substrate.observed':
				this.airportRegistry.observeSubstrate(command.repositoryId, command.substrate);
				return [command.repositoryId];
		}
	}

	private async reduceWorkspaceSynchronization(
		command: Extract<MissionSystemCommand, { kind: 'workspace.synchronized' }>
	): Promise<string[]> {
		const currentSelection = this.missionControl.getState().selection;
		const selectedMissionId = command.selectionHint?.missionId?.trim()
			|| currentSelection.missionId?.trim();
		const source = await this.workspaceManager.readMissionControlSource({
			...(command.surfacePath?.trim() ? { surfacePath: command.surfacePath.trim() } : {}),
			...(command.workspaceRoot?.trim() ? { workspaceRoot: command.workspaceRoot.trim() } : {}),
			...(selectedMissionId ? { selectedMissionId } : {})
		});
		await this.airportRegistry.activateRepository(source.repositoryId, source.repositoryRootPath);
		const airportRecord = this.airportRegistry.getActiveAirport();
		const domain = this.missionControl.synchronize(source, command.selectionHint);
		this.airportRegistry.applyDefaultBindings(
			source.repositoryId,
			derivePaneBindings(domain, airportRecord.control.getState().panes.runway, domain.agentSessions)
		);
		return [source.repositoryId];
	}

	private async reduceAirportClientConnected(
		params: ConnectAirportClientParams & { surfacePath?: string; terminalSessionName?: string }
	): Promise<string[]> {
		const repositoryId = await this.resolveRepositoryId(params.clientId, params.surfacePath);
		if (params.terminalSessionName?.trim()) {
			this.airportRegistry.setTerminalSessionName(repositoryId, params.terminalSessionName.trim());
		}
		this.airportRegistry.connectClient(repositoryId, params);
		return [repositoryId];
	}

	private reduceAirportClientDisconnected(clientId: string): string[] {
		const repositoryId = this.airportRegistry.disconnectClient(clientId);
		return repositoryId ? [repositoryId] : [];
	}

	private async reduceAirportClientObserved(
		params: Extract<MissionSystemCommand, { kind: 'airport.client.observed' }>['params']
	): Promise<string[]> {
		const repositoryId = await this.resolveRepositoryId(params.clientId, params.surfacePath);
		if (params.terminalSessionName?.trim()) {
			this.airportRegistry.setTerminalSessionName(repositoryId, params.terminalSessionName.trim());
		}
		this.airportRegistry.observeClient(repositoryId, {
			clientId: params.clientId,
			...(params.focusedPaneId ? { focusedPaneId: params.focusedPaneId } : {}),
			...(params.intentPaneId ? { intentPaneId: params.intentPaneId } : {}),
			...(Number.isInteger(params.terminalPaneId) && (params.terminalPaneId as number) >= 0 ? { terminalPaneId: params.terminalPaneId } : {}),
			...(params.surfacePath ? { surfacePath: params.surfacePath } : {})
		});
		const airportRecord = this.airportRegistry.getActiveAirport();
		const domain = this.missionControl.getState();
		const nextBindings = derivePaneBindings(
			domain,
			airportRecord.control.getState().panes.runway,
			domain.agentSessions
		);
		if (params.intentPaneId) {
			this.airportRegistry.applyDefaultBindings(repositoryId, nextBindings, {
				focusIntent: params.intentPaneId
			});
			return [repositoryId];
		}
		this.airportRegistry.applyDefaultBindings(repositoryId, nextBindings);
		return [repositoryId];
	}

	private reduceAirportPaneBound(params: BindAirportPaneParams): string[] {
		const repositoryId = this.airportRegistry.getActiveAirport().repositoryId;
		this.airportRegistry.bindPane(repositoryId, params);
		return [repositoryId];
	}

	private planEffects(touchedRepositoryIds: string[]): Array<{ repositoryId: string; effects: AirportSubstrateEffect[] }> {
		return [...new Set(touchedRepositoryIds)].map((repositoryId) => {
			const record = this.airportRegistry.listAirportRecords().find(([candidateRepositoryId]) => candidateRepositoryId === repositoryId)?.[1];
			return {
				repositoryId,
				effects: record ? planAirportSubstrateEffects(record.control.getState()) : []
			};
		});
	}

	private async applyEffects(plannedEffects: Array<{ repositoryId: string; effects: AirportSubstrateEffect[] }>): Promise<void> {
		for (const plan of plannedEffects) {
			if (plan.effects.length === 0) {
				continue;
			}
			await this.airportRegistry.applyEffects(plan.repositoryId, plan.effects);
		}
	}

	private async collectSubstrateObservations(touchedRepositoryIds: string[]): Promise<MissionSystemCommand[]> {
		const followUpCommands: MissionSystemCommand[] = [];
		for (const repositoryId of new Set(touchedRepositoryIds)) {
			const substrate = await this.airportRegistry.sampleSubstrate(repositoryId);
			followUpCommands.push({
				kind: 'airport.substrate.observed',
				repositoryId,
				substrate
			});
		}
		return followUpCommands;
	}

	private async commit(touchedRepositoryIds: string[] = []): Promise<void> {
		const serializedState = this.serializeSystemState();
		if (serializedState !== this.serializedState) {
			this.serializedState = serializedState;
			this.version += 1;
		}
		await this.airportRegistry.persistTouchedAirportIntents(touchedRepositoryIds);
	}

	private buildSnapshot(): MissionSystemSnapshot {
		const activeAirport = this.airportRegistry.getActiveAirport();
		const domain = this.missionControl.getState();
		const missionOperatorViews = this.missionControl.getMissionOperatorViews();
		const airportRegistryState = Object.fromEntries(
			this.airportRegistry.listAirportRecords().map(([repositoryId, record]) => [
				repositoryId,
				{
					repositoryId,
					repositoryRootPath: record.repositoryRootPath,
					airport: record.control.getState(),
					persistedIntent: record.control.getPersistedIntent()
				}
			])
		);
		const activeRepositoryId = this.airportRegistry.getActiveRepositoryId();
		const state: MissionSystemState = {
			version: this.version,
			domain,
			missionOperatorViews,
			airport: activeAirport.control.getState(),
			airports: {
				repositories: airportRegistryState,
				...(activeRepositoryId ? { activeRepositoryId } : {})
			}
		};
		const airportProjections: AirportProjectionSet = deriveSystemAirportProjections(domain, missionOperatorViews, activeAirport.control.getState());
		const airportRegistryProjections = Object.fromEntries(
			this.airportRegistry.listAirportRecords().map(([repositoryId, record]) => [
				repositoryId,
				deriveSystemAirportProjections(domain, missionOperatorViews, record.control.getState())
			])
		);
		return { state, airportProjections, airportRegistryProjections };
	}

	private serializeSystemState(): string {
		return JSON.stringify({
			domain: this.missionControl.getState(),
			missionOperatorViews: this.missionControl.getMissionOperatorViews(),
			activeRepositoryId: this.airportRegistry.getActiveRepositoryId(),
			airports: Object.fromEntries(
				this.airportRegistry.listAirportRecords().map(([repositoryId, record]) => [repositoryId, record.control.getState()])
			)
		});
	}

	private async resolveRepositoryId(clientId: string, surfacePath?: string): Promise<string> {
		if (surfacePath?.trim()) {
			const repositoryRootPath = this.workspaceManager.resolveWorkspaceRootForSurfacePath(surfacePath.trim());
			await this.airportRegistry.activateRepository(repositoryRootPath, repositoryRootPath);
			return repositoryRootPath;
		}
		const airport = await this.airportRegistry.resolveAirportForRequest(clientId);
		return airport.repositoryId;
	}
}

function derivePaneBindings(
	graph: ContextGraph,
	currentRunwayBinding: PaneBinding,
	agentSessions: ContextGraph['agentSessions']
): Partial<Record<AirportPaneId, PaneBinding>> {
	const { repositoryId, missionId, artifactId, agentSessionId } = graph.selection;
	const nextBindings: Partial<Record<AirportPaneId, PaneBinding>> = {
		tower: missionId
			? { targetKind: 'mission', targetId: missionId, mode: 'control' }
			: repositoryId
				? { targetKind: 'repository', targetId: repositoryId, mode: 'control' }
				: { targetKind: 'empty' },
		briefingRoom: artifactId
			? { targetKind: 'artifact', targetId: artifactId, mode: 'view' }
			: missionId
				? { targetKind: 'mission', targetId: missionId, mode: 'view' }
				: repositoryId
					? { targetKind: 'repository', targetId: repositoryId, mode: 'view' }
					: { targetKind: 'empty' }
	};

	if (agentSessionId) {
		nextBindings['runway'] = {
			targetKind: 'agentSession',
			targetId: agentSessionId,
			mode: 'control'
		};
		return nextBindings;
	}

	if (
		currentRunwayBinding.targetKind === 'agentSession'
		&& currentRunwayBinding.targetId
		&& !(currentRunwayBinding.targetId in agentSessions)
	) {
		nextBindings['runway'] = { targetKind: 'empty' };
	}

	return nextBindings;
}

