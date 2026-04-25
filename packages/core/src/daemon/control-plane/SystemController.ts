// /packages/core/src/daemon/control-plane/SystemController.ts: Maintains the daemon's authoritative mission and airport snapshot state.
import {
	type AirportProjectionSet,
	type AirportSubstrateState,
	type BindAirportPaneParams,
	type ConnectAirportClientParams,
	type PaneBinding,
	type AirportPaneId
} from '../../airport/index.js';
import { planAirportSubstrateEffects, type AirportSubstrateEffect } from './AirportTerminalSubstrate.js';
import path from 'node:path';
import type {
	ContextGraph,
	ContextSelection,
	SystemSnapshot,
	SystemState,
	OperatorStatus
} from '../../types.js';
import { peekCachedSystemStatus } from '../../system/SystemStatus.js';
import { ContextGraphController } from './ContextGraphControl.js';
import { deriveSystemAirportProjections } from './AirportProjectionService.js';
import { RepositoryLayoutRegistry } from './RepositoryLayoutRegistry.js';
import { RepositoryManager } from '../../entities/Repository/RepositoryManager.js';
import { deriveRepositoryIdentity } from '../../lib/repositoryIdentity.js';
import { findRegisteredRepositoryById } from '../../lib/config.js';
import type { ControlSource } from './types.js';

type SystemCommand =
	| {
		kind: 'workspace.synchronized';
		surfacePath?: string;
		workspaceRoot?: string;
		sourceHint?: ControlSource;
		selectionHint?: Partial<ContextSelection>;
		missionStatusHint?: OperatorStatus;
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
		params: BindAirportPaneParams & { surfacePath?: string };
	}
	| {
		kind: 'airport.substrate.observed';
		repositoryId: string;
		substrate: AirportSubstrateState;
	};

export class SystemController {
	private readonly contextGraphController = new ContextGraphController();
	private readonly airportRegistry = new RepositoryLayoutRegistry();
	private version = 0;
	private serializedState = '';

	public constructor(private readonly repositoryManager: RepositoryManager) {
		this.serializedState = this.serializeSystemState();
	}

	public getSnapshot(): SystemSnapshot {
		return this.buildSnapshot();
	}

	public async scopeAirportToSurfacePath(surfacePath?: string): Promise<SystemSnapshot> {
		return this.dispatch({
			kind: 'workspace.synchronized',
			...(surfacePath?.trim() ? { surfacePath: surfacePath.trim() } : {})
		});
	}

	public async synchronizeWorkspace(input: {
		surfacePath?: string;
		workspaceRoot?: string;
		sourceHint?: ControlSource;
		selectionHint?: Partial<ContextSelection>;
		missionStatusHint?: OperatorStatus;
	}): Promise<SystemSnapshot> {
		return this.dispatch({
			kind: 'workspace.synchronized',
			...(input.surfacePath?.trim() ? { surfacePath: input.surfacePath.trim() } : {}),
			...(input.workspaceRoot?.trim() ? { workspaceRoot: input.workspaceRoot.trim() } : {}),
			...(input.sourceHint ? { sourceHint: input.sourceHint } : {}),
			...(input.selectionHint ? { selectionHint: input.selectionHint } : {}),
			...(input.missionStatusHint ? { missionStatusHint: input.missionStatusHint } : {})
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
	}): Promise<SystemSnapshot> {
		return this.dispatch({ kind: 'airport.client.connected', params });
	}

	public async disconnectAirportClient(clientId: string): Promise<SystemSnapshot | undefined> {
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
	}): Promise<SystemSnapshot> {
		return this.dispatch({ kind: 'airport.client.observed', params });
	}

	public async bindAirportPane(params: {
		paneId: Exclude<AirportPaneId, 'tower'>;
		binding: PaneBinding;
		surfacePath?: string;
	}): Promise<SystemSnapshot> {
		return this.dispatch({ kind: 'airport.pane.bound', params });
	}

	private async dispatch(
		command: SystemCommand,
		options: { applyEffects?: boolean } = {}
	): Promise<SystemSnapshot> {
		const startedAt = command.kind === 'workspace.synchronized' ? performance.now() : 0;
		const touchedRepositoryIds = await this.reduceCommand(command);
		const plannedEffects = this.planEffects(touchedRepositoryIds);
		await this.commit();

		if (options.applyEffects === false || command.kind === 'airport.substrate.observed') {
			const snapshotStartedAt = command.kind === 'workspace.synchronized' ? performance.now() : 0;
			const snapshot = this.buildSnapshot();
			if (command.kind === 'workspace.synchronized') {
				const snapshotDurationMs = performance.now() - snapshotStartedAt;
				const totalDurationMs = performance.now() - startedAt;
				process.stdout.write(
					`${new Date().toISOString().slice(11, 19)} system.dispatch workspace.synchronized total=${totalDurationMs.toFixed(1)}ms buildSnapshot=${snapshotDurationMs.toFixed(1)}ms mode=follow-up\n`
				);
			}
			return snapshot;
		}

		const effectsStartedAt = command.kind === 'workspace.synchronized' ? performance.now() : 0;
		await this.applyEffects(plannedEffects);
		const effectsDurationMs = command.kind === 'workspace.synchronized'
			? performance.now() - effectsStartedAt
			: 0;
		const substrateStartedAt = command.kind === 'workspace.synchronized' ? performance.now() : 0;
		const followUpCommands = await this.collectSubstrateObservations(touchedRepositoryIds);
		const substrateDurationMs = command.kind === 'workspace.synchronized'
			? performance.now() - substrateStartedAt
			: 0;
		const followUpDispatchStartedAt = command.kind === 'workspace.synchronized' ? performance.now() : 0;
		for (const followUpCommand of followUpCommands) {
			await this.dispatch(followUpCommand, { applyEffects: false });
		}
		const followUpDispatchDurationMs = command.kind === 'workspace.synchronized'
			? performance.now() - followUpDispatchStartedAt
			: 0;
		const snapshotStartedAt = command.kind === 'workspace.synchronized' ? performance.now() : 0;
		const snapshot = this.buildSnapshot();
		if (command.kind === 'workspace.synchronized') {
			const snapshotDurationMs = performance.now() - snapshotStartedAt;
			const totalDurationMs = performance.now() - startedAt;
			process.stdout.write(
				`${new Date().toISOString().slice(11, 19)} system.dispatch workspace.synchronized total=${totalDurationMs.toFixed(1)}ms applyEffects=${effectsDurationMs.toFixed(1)}ms collectSubstrate=${substrateDurationMs.toFixed(1)}ms followUpDispatch=${followUpDispatchDurationMs.toFixed(1)}ms buildSnapshot=${snapshotDurationMs.toFixed(1)}ms\n`
			);
		}

		return snapshot;
	}

	private async reduceCommand(command: SystemCommand): Promise<string[]> {
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
		command: Extract<SystemCommand, { kind: 'workspace.synchronized' }>
	): Promise<string[]> {
		const startedAt = performance.now();
		const currentSelection = this.contextGraphController.getState().selection;
		const scopedWorkspaceRoot = command.workspaceRoot?.trim()
			? path.resolve(command.workspaceRoot.trim())
			: command.surfacePath?.trim()
				? this.repositoryManager.resolveRepositoryRootForSurfacePath(command.surfacePath.trim())
				: undefined;
		const scopedRepositoryId = scopedWorkspaceRoot
			? deriveRepositoryIdentity(scopedWorkspaceRoot).repositoryId
			: undefined;
		const selectedMissionId = command.selectionHint?.missionId?.trim()
			|| (scopedRepositoryId && currentSelection.repositoryId === scopedRepositoryId
				? currentSelection.missionId?.trim()
				: undefined);
		const source = command.sourceHint
			? structuredClone(command.sourceHint)
			: await this.repositoryManager.readControlSource({
				...(command.surfacePath?.trim() ? { surfacePath: command.surfacePath.trim() } : {}),
				...(command.workspaceRoot?.trim() ? { repositoryRoot: command.workspaceRoot.trim() } : {}),
				...(selectedMissionId ? { selectedMissionId } : {}),
				...(command.missionStatusHint ? { missionStatusHint: command.missionStatusHint } : {})
			});
		const readSourceDurationMs = performance.now() - startedAt;
		const activateStartedAt = performance.now();
		await this.airportRegistry.activateRepository(source.repositoryId, source.repositoryRootPath);
		const activateDurationMs = performance.now() - activateStartedAt;
		const synchronizeStartedAt = performance.now();
		const domain = this.contextGraphController.synchronize(source, command.selectionHint);
		const synchronizeDurationMs = performance.now() - synchronizeStartedAt;
		const bindingsStartedAt = performance.now();
		this.airportRegistry.applyDefaultBindings(
			source.repositoryId,
			deriveAirportPaneBindings(domain)
		);
		const bindingsDurationMs = performance.now() - bindingsStartedAt;
		const totalDurationMs = performance.now() - startedAt;
		process.stdout.write(
			`${new Date().toISOString().slice(11, 19)} workspace.synchronized repository=${source.repositoryId} selectedMission=${selectedMissionId ?? 'none'} total=${totalDurationMs.toFixed(1)}ms readSource=${readSourceDurationMs.toFixed(1)}ms activate=${activateDurationMs.toFixed(1)}ms synchronize=${synchronizeDurationMs.toFixed(1)}ms defaultBindings=${bindingsDurationMs.toFixed(1)}ms\n`
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
		params: Extract<SystemCommand, { kind: 'airport.client.observed' }>['params']
	): Promise<string[]> {
		const repositoryId = await this.resolveRepositoryId(params.clientId, params.surfacePath, params.repositoryId);
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
		const domain = this.contextGraphController.getState();
		const nextBindings = deriveAirportPaneBindings(domain);
		if (params.intentPaneId) {
			this.airportRegistry.applyDefaultBindings(repositoryId, nextBindings, {
				focusIntent: params.intentPaneId
			});
			return [repositoryId];
		}
		this.airportRegistry.applyDefaultBindings(repositoryId, nextBindings);
		return [repositoryId];
	}

	private reduceAirportPaneBound(params: BindAirportPaneParams & { surfacePath?: string }): string[] {
		const repositoryId = params.surfacePath?.trim()
			? deriveRepositoryIdentity(this.repositoryManager.resolveRepositoryRootForSurfacePath(params.surfacePath.trim())).repositoryId
			: this.airportRegistry.getActiveLayout().repositoryId;
		this.airportRegistry.bindPane(repositoryId, params);
		return [repositoryId];
	}

	private planEffects(touchedRepositoryIds: string[]): Array<{ repositoryId: string; effects: AirportSubstrateEffect[] }> {
		return [...new Set(touchedRepositoryIds)].map((repositoryId) => {
			const record = this.airportRegistry.listLayoutRecords().find(([candidateRepositoryId]) => candidateRepositoryId === repositoryId)?.[1];
			return {
				repositoryId,
				effects: record ? planAirportSubstrateEffects(record.layoutController.getState()) : []
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

	private async collectSubstrateObservations(touchedRepositoryIds: string[]): Promise<SystemCommand[]> {
		const followUpCommands: SystemCommand[] = [];
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

	private async commit(): Promise<void> {
		const serializedState = this.serializeSystemState();
		if (serializedState !== this.serializedState) {
			this.serializedState = serializedState;
			this.version += 1;
		}
	}

	private buildSnapshot(): SystemSnapshot {
		const startedAt = performance.now();
		const activeAirport = this.airportRegistry.getActiveLayout();
		const activeLayoutDurationMs = performance.now() - startedAt;
		const domainStartedAt = performance.now();
		const domain = this.contextGraphController.getState();
		const missionOperatorViews = this.contextGraphController.getMissionOperatorViews();
		const domainDurationMs = performance.now() - domainStartedAt;
		const registryStateStartedAt = performance.now();
		const airportRegistryState = Object.fromEntries(
			this.airportRegistry.listLayoutRecords().map(([repositoryId, record]) => [
				repositoryId,
				{
					repositoryId,
					repositoryRootPath: record.repositoryRootPath,
					airport: record.layoutController.getState(),
					persistedIntent: record.layoutController.getPersistedIntent()
				}
			])
		);
		const registryStateDurationMs = performance.now() - registryStateStartedAt;
		const activeRepositoryId = this.airportRegistry.getActiveRepositoryId();
		const stateStartedAt = performance.now();
		const state: SystemState = {
			version: this.version,
			domain,
			missionOperatorViews,
			airport: activeAirport.layoutController.getState(),
			airports: {
				repositories: airportRegistryState,
				...(activeRepositoryId ? { activeRepositoryId } : {})
			}
		};
		const stateDurationMs = performance.now() - stateStartedAt;
		const systemStatusStartedAt = performance.now();
		const systemStatus = peekCachedSystemStatus({
			...(activeAirport.repositoryRootPath ? { cwd: activeAirport.repositoryRootPath } : {})
		});
		const systemStatusDurationMs = performance.now() - systemStatusStartedAt;
		const projectionsStartedAt = performance.now();
		const airportProjections: AirportProjectionSet = deriveSystemAirportProjections(
			domain,
			activeAirport.layoutController.getState(),
			systemStatus
		);
		const airportProjectionsDurationMs = performance.now() - projectionsStartedAt;
		const registryProjectionsStartedAt = performance.now();
		const airportRegistryProjections = Object.fromEntries(
			this.airportRegistry.listLayoutRecords().map(([repositoryId, record]) => [
				repositoryId,
				deriveSystemAirportProjections(
					domain,
					record.layoutController.getState(),
					peekCachedSystemStatus({
						...(record.repositoryRootPath ? { cwd: record.repositoryRootPath } : {})
					})
				)
			])
		);
		const registryProjectionsDurationMs = performance.now() - registryProjectionsStartedAt;
		const totalDurationMs = performance.now() - startedAt;
		process.stdout.write(
			`${new Date().toISOString().slice(11, 19)} system.buildSnapshot total=${totalDurationMs.toFixed(1)}ms activeLayout=${activeLayoutDurationMs.toFixed(1)}ms domain=${domainDurationMs.toFixed(1)}ms registryState=${registryStateDurationMs.toFixed(1)}ms state=${stateDurationMs.toFixed(1)}ms systemStatus=${systemStatusDurationMs.toFixed(1)}ms projections=${airportProjectionsDurationMs.toFixed(1)}ms registryProjections=${registryProjectionsDurationMs.toFixed(1)}ms\n`
		);
		return { state, airportProjections, airportRegistryProjections };
	}

	private serializeSystemState(): string {
		return JSON.stringify({
			domain: this.contextGraphController.getState(),
			missionOperatorViews: this.contextGraphController.getMissionOperatorViews(),
			activeRepositoryId: this.airportRegistry.getActiveRepositoryId(),
			airports: Object.fromEntries(
				this.airportRegistry.listLayoutRecords().map(([repositoryId, record]) => [repositoryId, record.layoutController.getState()])
			)
		});
	}

	private async resolveRepositoryId(clientId: string, surfacePath?: string, repositoryId?: string): Promise<string> {
		const explicitRepositoryId = repositoryId?.trim();
		if (explicitRepositoryId) {
			const registeredRepository = await findRegisteredRepositoryById(explicitRepositoryId);
			if (registeredRepository) {
				const repositoryRootPath = registeredRepository.repositoryRootPath;
				await this.airportRegistry.activateRepository(explicitRepositoryId, repositoryRootPath);
				return explicitRepositoryId;
			}
			if (path.isAbsolute(explicitRepositoryId)) {
				const repositoryRootPath = path.resolve(explicitRepositoryId);
				const resolvedRepositoryId = deriveRepositoryIdentity(repositoryRootPath).repositoryId;
				await this.airportRegistry.activateRepository(resolvedRepositoryId, repositoryRootPath);
				return resolvedRepositoryId;
			}
			throw new Error(`Unknown repository id: ${explicitRepositoryId}`);
		}
		if (surfacePath?.trim()) {
			const repositoryRootPath = this.repositoryManager.resolveRepositoryRootForSurfacePath(surfacePath.trim());
			const resolvedRepositoryId = deriveRepositoryIdentity(repositoryRootPath).repositoryId;
			await this.airportRegistry.activateRepository(resolvedRepositoryId, repositoryRootPath);
			return resolvedRepositoryId;
		}
		const airport = await this.airportRegistry.resolveLayoutForRequest(clientId);
		return airport.repositoryId;
	}
}

function deriveAirportPaneBindings(
	graph: ContextGraph
): Partial<Record<AirportPaneId, PaneBinding>> {
	const { repositoryId, missionId, artifactId, agentSessionId } = graph.selection;
	return {
		tower: missionId
			? { targetKind: 'mission', targetId: missionId, mode: 'control' }
			: repositoryId
				? { targetKind: 'repository', targetId: repositoryId, mode: 'control' }
				: { targetKind: 'empty' },
		briefingRoom: artifactId
			? { targetKind: 'artifact', targetId: artifactId, mode: 'view' }
			: missionId
				? { targetKind: 'mission', targetId: missionId, mode: 'view' }
				: { targetKind: 'empty' },
		runway: agentSessionId
			? { targetKind: 'agentSession', targetId: agentSessionId, mode: 'view' }
			: { targetKind: 'empty' }
	};
}

