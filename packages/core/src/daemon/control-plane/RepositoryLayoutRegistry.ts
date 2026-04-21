import { createHash } from 'node:crypto';
import path from 'node:path';
import {
	type BindAirportPaneParams,
	type ConnectAirportClientParams,
	type AirportSubstrateState,
	type PaneBinding,
	type AirportPaneId
} from '../../airport/types.js';
import { RepositoryLayoutController } from './RepositoryLayoutController.js';
import {
	ClientReportedSubstrateController,
	type AirportSubstrateEffect
} from './AirportTerminalSubstrate.js';

type RepositoryLayoutRecord = {
	repositoryId: string;
	repositoryRootPath: string;
	layoutController: RepositoryLayoutController;
	substrateController: ClientReportedSubstrateController;
};

export class RepositoryLayoutRegistry {
	private readonly layoutRegistry = new Map<string, RepositoryLayoutRecord>();
	private readonly clientRepositoryIndex = new Map<string, string>();
	private activeRepositoryId?: string;

	public getActiveRepositoryId(): string | undefined {
		return this.activeRepositoryId;
	}

	public getActiveLayout(): RepositoryLayoutRecord {
		if (!this.activeRepositoryId) {
			throw new Error('Airport state is not scoped to a repository.');
		}
		const activeLayout = this.layoutRegistry.get(this.activeRepositoryId);
		if (!activeLayout) {
			throw new Error(`Airport '${this.activeRepositoryId}' is not loaded.`);
		}
		return activeLayout;
	}

	public listLayoutRecords(): Array<[string, RepositoryLayoutRecord]> {
		return [...this.layoutRegistry.entries()].sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
	}

	public getRepositoryIdForClient(clientId: string): string | undefined {
		return this.clientRepositoryIndex.get(clientId);
	}

	public async activateRepository(repositoryId: string, repositoryRootPath: string): Promise<RepositoryLayoutRecord> {
		const layout = await this.ensureLayoutForRepository(repositoryId, repositoryRootPath);
		this.activeRepositoryId = repositoryId;
		const activeSessionName = layout.layoutController.getState().substrate.sessionName;
		layout.layoutController.scopeToRepository({
			repositoryId,
			repositoryRootPath,
			airportId: deriveRepositoryAirportIdentity(repositoryId, repositoryRootPath).airportId,
			sessionName: activeSessionName
		});
		return layout;
	}

	public async resolveLayoutForRequest(clientId: string, repositoryId?: string, repositoryRootPath?: string): Promise<RepositoryLayoutRecord> {
		if (repositoryId && repositoryRootPath) {
			this.activeRepositoryId = repositoryId;
			return this.ensureLayoutForRepository(repositoryId, repositoryRootPath);
		}
		const indexedRepositoryId = this.clientRepositoryIndex.get(clientId);
		if (!indexedRepositoryId) {
			throw new Error('Airport request requires a repository-scoped surface path, explicit repository id, or an already scoped client binding.');
		}
		const layout = this.layoutRegistry.get(indexedRepositoryId);
		if (!layout) {
			throw new Error(`Airport '${indexedRepositoryId}' is not loaded.`);
		}
		this.activeRepositoryId = indexedRepositoryId;
		return layout;
	}

	public connectClient(repositoryId: string, params: ConnectAirportClientParams): void {
		const layout = this.requireLayout(repositoryId);
		this.activeRepositoryId = repositoryId;
		this.clientRepositoryIndex.set(params.clientId, repositoryId);
		layout.layoutController.connectClient(params);
	}

	public setTerminalSessionName(repositoryId: string, terminalSessionName: string): void {
		const layout = this.requireLayout(repositoryId);
		const normalizedSessionName = terminalSessionName.trim();
		if (!normalizedSessionName) {
			return;
		}
		if (layout.layoutController.getState().substrate.sessionName === normalizedSessionName) {
			return;
		}
		layout.substrateController = new ClientReportedSubstrateController({
			sessionName: normalizedSessionName
		});
		layout.layoutController.scopeToRepository({
			repositoryId: layout.repositoryId,
			repositoryRootPath: layout.repositoryRootPath,
			airportId: layout.layoutController.getState().airportId,
			sessionName: normalizedSessionName
		});
	}

	public disconnectClient(clientId: string): string | undefined {
		const repositoryId = this.clientRepositoryIndex.get(clientId);
		if (!repositoryId) {
			return undefined;
		}
		const layout = this.layoutRegistry.get(repositoryId);
		if (!layout) {
			this.clientRepositoryIndex.delete(clientId);
			return undefined;
		}
		layout.layoutController.disconnectClient(clientId);
		this.clientRepositoryIndex.delete(clientId);
		return repositoryId;
	}

	public observeClient(repositoryId: string, params: Parameters<RepositoryLayoutController['observeClient']>[0]): void {
		const layout = this.requireLayout(repositoryId);
		this.activeRepositoryId = repositoryId;
		this.clientRepositoryIndex.set(params.clientId, repositoryId);
		layout.layoutController.observeClient(params);
	}

	public bindPane(repositoryId: string, params: BindAirportPaneParams): void {
		const layout = this.requireLayout(repositoryId);
		this.activeRepositoryId = repositoryId;
		layout.layoutController.bindPane(params);
	}

	public applyDefaultBindings(
		repositoryId: string,
		bindings: Partial<Record<AirportPaneId, PaneBinding>>,
		options: { focusIntent?: AirportPaneId } = {}
	): void {
		const layout = this.requireLayout(repositoryId);
		this.activeRepositoryId = repositoryId;
		layout.layoutController.applyDefaultBindings(bindings, options);
	}

	public observeSubstrate(repositoryId: string, substrate: AirportSubstrateState): void {
		const layout = this.requireLayout(repositoryId);
		layout.layoutController.observeSubstrate(substrate);
	}

	public async sampleSubstrate(repositoryId: string): Promise<AirportSubstrateState> {
		const layout = this.requireLayout(repositoryId);
		return layout.substrateController.observe(layout.layoutController.getState());
	}

	public async applyEffects(repositoryId: string, effects: AirportSubstrateEffect[]): Promise<AirportSubstrateState> {
		const layout = this.requireLayout(repositoryId);
		return layout.substrateController.applyEffects(effects);
	}

	private requireLayout(repositoryId: string): RepositoryLayoutRecord {
		const layout = this.layoutRegistry.get(repositoryId);
		if (!layout) {
			throw new Error(`Airport '${repositoryId}' is not loaded.`);
		}
		return layout;
	}

	private async ensureLayoutForRepository(repositoryId: string, repositoryRootPath: string): Promise<RepositoryLayoutRecord> {
		const existing = this.layoutRegistry.get(repositoryId);
		if (existing) {
			return existing;
		}

		const identity = deriveRepositoryAirportIdentity(repositoryId, repositoryRootPath);
		const substrateController = new ClientReportedSubstrateController({
			sessionName: identity.sessionName
		});
		const layoutController = new RepositoryLayoutController({
			airportId: identity.airportId,
			repositoryId,
			repositoryRootPath,
			terminalSessionName: identity.sessionName,
			initialSubstrateState: substrateController.getState()
		});
		const record: RepositoryLayoutRecord = {
			repositoryId,
			repositoryRootPath,
			layoutController,
			substrateController
		};
		this.layoutRegistry.set(repositoryId, record);
		return record;
	}
}

export function deriveRepositoryAirportIdentity(repositoryId: string, repositoryRootPath: string) {
	const repositoryLabel = slugifyRepositoryLabel(path.basename(repositoryRootPath) || 'repository');
	const repositoryHash = hashRepositoryScope(repositoryRootPath);
	return {
		repositoryId,
		repositoryRootPath,
		airportId: `airport:${repositoryLabel}:${repositoryHash}`,
		sessionName: process.env['AIRPORT_TERMINAL_SESSION']?.trim()
			|| process.env['AIRPORT_TERMINAL_SESSION_NAME']?.trim()
			|| `mission-control-${repositoryLabel}-${repositoryHash}`
	};
}

function hashRepositoryScope(repositoryRootPath: string): string {
	return createHash('sha1').update(repositoryRootPath).digest('hex').slice(0, 8);
}

function slugifyRepositoryLabel(value: string): string {
	const normalizedValue = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return normalizedValue || 'repository';
}