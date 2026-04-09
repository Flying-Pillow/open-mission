import {
	planAirportSubstrateEffects,
	type AirportProjectionSet,
	type AirportSubstrateEffect,
	type AirportSubstrateState,
	type BindAirportGateParams,
	type ConnectAirportClientParams,
	type GateBinding,
	type GateId
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
		params: ConnectAirportClientParams & { surfacePath?: string };
	}
	| {
		kind: 'airport.client.disconnected';
		clientId: string;
	}
	| {
		kind: 'airport.client.observed';
		params: {
			clientId: string;
			focusedGateId?: GateId;
			intentGateId?: GateId;
			repositoryId?: string;
			surfacePath?: string;
		};
	}
	| {
		kind: 'airport.gate.bound';
		params: BindAirportGateParams;
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
		gateId: GateId;
		panelProcessId?: string;
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
		focusedGateId?: GateId;
		intentGateId?: GateId;
		repositoryId?: string;
		surfacePath?: string;
	}): Promise<MissionSystemSnapshot> {
		return this.dispatch({ kind: 'airport.client.observed', params });
	}

	public async bindAirportGate(params: {
		gateId: GateId;
		binding: GateBinding;
	}): Promise<MissionSystemSnapshot> {
		return this.dispatch({ kind: 'airport.gate.bound', params });
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
			case 'airport.gate.bound':
				return this.reduceAirportGateBound(command.params);
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
			deriveGateBindings(domain, airportRecord.control.getState().gates.agentSession, domain.agentSessions),
			{ focusIntent: deriveFocusIntent(domain) }
		);
		return [source.repositoryId];
	}

	private async reduceAirportClientConnected(
		params: ConnectAirportClientParams & { surfacePath?: string }
	): Promise<string[]> {
		const repositoryId = await this.resolveRepositoryId(params.clientId, params.surfacePath);
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
		this.airportRegistry.observeClient(repositoryId, {
			clientId: params.clientId,
			...(params.focusedGateId ? { focusedGateId: params.focusedGateId } : {}),
			...(params.intentGateId ? { intentGateId: params.intentGateId } : {}),
			...(params.surfacePath ? { surfacePath: params.surfacePath } : {})
		});
		const airportRecord = this.airportRegistry.getActiveAirport();
		const domain = this.missionControl.getState();
		this.airportRegistry.applyDefaultBindings(
			repositoryId,
			deriveGateBindings(domain, airportRecord.control.getState().gates.agentSession, domain.agentSessions),
			{ focusIntent: params.intentGateId ?? deriveFocusIntent(domain) }
		);
		return [repositoryId];
	}

	private reduceAirportGateBound(params: BindAirportGateParams): string[] {
		const repositoryId = this.airportRegistry.getActiveAirport().repositoryId;
		this.airportRegistry.bindGate(repositoryId, params);
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
			airport: activeAirport.control.getState(),
			airports: {
				repositories: airportRegistryState,
				...(activeRepositoryId ? { activeRepositoryId } : {})
			}
		};
		const airportProjections: AirportProjectionSet = deriveSystemAirportProjections(domain, activeAirport.control.getState());
		const airportRegistryProjections = Object.fromEntries(
			this.airportRegistry.listAirportRecords().map(([repositoryId, record]) => [
				repositoryId,
				deriveSystemAirportProjections(domain, record.control.getState())
			])
		);
		return { state, airportProjections, airportRegistryProjections };
	}

	private serializeSystemState(): string {
		return JSON.stringify({
			domain: this.missionControl.getState(),
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

function deriveGateBindings(
	graph: ContextGraph,
	currentAgentSessionBinding: GateBinding,
	agentSessions: ContextGraph['agentSessions']
): Partial<Record<GateId, GateBinding>> {
	const { repositoryId, missionId, artifactId, agentSessionId } = graph.selection;
	const nextBindings: Partial<Record<GateId, GateBinding>> = {
		dashboard: missionId
			? { targetKind: 'mission', targetId: missionId, mode: 'control' }
			: repositoryId
				? { targetKind: 'repository', targetId: repositoryId, mode: 'control' }
				: { targetKind: 'empty' },
		editor: artifactId
			? { targetKind: 'artifact', targetId: artifactId, mode: 'view' }
			: missionId
				? { targetKind: 'mission', targetId: missionId, mode: 'view' }
				: repositoryId
					? { targetKind: 'repository', targetId: repositoryId, mode: 'view' }
					: { targetKind: 'empty' }
	};

	if (agentSessionId && agentSessionId in agentSessions) {
		nextBindings.agentSession = {
			targetKind: 'agentSession',
			targetId: agentSessionId,
			mode: 'control'
		};
		return nextBindings;
	}

	if (
		currentAgentSessionBinding.targetKind === 'agentSession'
		&& currentAgentSessionBinding.targetId
		&& !(currentAgentSessionBinding.targetId in agentSessions)
	) {
		nextBindings.agentSession = { targetKind: 'empty' };
	}

	return nextBindings;
}

function deriveFocusIntent(graph: ContextGraph): GateId {
	return graph.selection.agentSessionId ? 'agentSession' : 'dashboard';
}
