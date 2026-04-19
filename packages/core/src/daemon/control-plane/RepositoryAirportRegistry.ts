import { createHash } from 'node:crypto';
import path from 'node:path';
import {
	AirportControl,
	type BindAirportPaneParams,
	type ConnectAirportClientParams,
	type AirportSubstrateState,
	type PaneBinding,
	type AirportPaneId
} from '../../airport/index.js';
import {
	TerminalManagerSubstrateController,
	type AirportSubstrateEffect
} from './AirportTerminalSubstrate.js';

type RepositoryAirportRecord = {
	repositoryId: string;
	repositoryRootPath: string;
	control: AirportControl;
	substrateController: TerminalManagerSubstrateController;
};

export class RepositoryAirportRegistry {
	private readonly airportRegistry = new Map<string, RepositoryAirportRecord>();
	private readonly clientRepositoryIndex = new Map<string, string>();
	private activeRepositoryId?: string;

	public getActiveRepositoryId(): string | undefined {
		return this.activeRepositoryId;
	}

	public getActiveAirport(): RepositoryAirportRecord {
		if (!this.activeRepositoryId) {
			throw new Error('Airport state is not scoped to a repository.');
		}
		const activeAirport = this.airportRegistry.get(this.activeRepositoryId);
		if (!activeAirport) {
			throw new Error(`Airport '${this.activeRepositoryId}' is not loaded.`);
		}
		return activeAirport;
	}

	public listAirportRecords(): Array<[string, RepositoryAirportRecord]> {
		return [...this.airportRegistry.entries()].sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
	}

	public getRepositoryIdForClient(clientId: string): string | undefined {
		return this.clientRepositoryIndex.get(clientId);
	}

	public async activateRepository(repositoryId: string, repositoryRootPath: string): Promise<RepositoryAirportRecord> {
		const airport = await this.ensureAirportForRepository(repositoryId, repositoryRootPath);
		this.activeRepositoryId = repositoryId;
		const activeSessionName = airport.control.getState().substrate.sessionName;
		airport.control.scopeToRepository({
			repositoryId,
			repositoryRootPath,
			airportId: deriveRepositoryAirportIdentity(repositoryId, repositoryRootPath).airportId,
			sessionName: activeSessionName
		});
		return airport;
	}

	public async resolveAirportForRequest(clientId: string, repositoryId?: string, repositoryRootPath?: string): Promise<RepositoryAirportRecord> {
		if (repositoryId && repositoryRootPath) {
			this.activeRepositoryId = repositoryId;
			return this.ensureAirportForRepository(repositoryId, repositoryRootPath);
		}
		const indexedRepositoryId = this.clientRepositoryIndex.get(clientId);
		if (!indexedRepositoryId) {
			throw new Error('Airport request requires a repository-scoped surface path, explicit repository id, or an already scoped client binding.');
		}
		const airport = this.airportRegistry.get(indexedRepositoryId);
		if (!airport) {
			throw new Error(`Airport '${indexedRepositoryId}' is not loaded.`);
		}
		this.activeRepositoryId = indexedRepositoryId;
		return airport;
	}

	public connectClient(repositoryId: string, params: ConnectAirportClientParams): void {
		const airport = this.requireAirport(repositoryId);
		this.activeRepositoryId = repositoryId;
		this.clientRepositoryIndex.set(params.clientId, repositoryId);
		airport.control.connectClient(params);
	}

	public setTerminalSessionName(repositoryId: string, terminalSessionName: string): void {
		const airport = this.requireAirport(repositoryId);
		const normalizedSessionName = terminalSessionName.trim();
		if (!normalizedSessionName) {
			return;
		}
		if (airport.control.getState().substrate.sessionName === normalizedSessionName) {
			return;
		}
		airport.substrateController = new TerminalManagerSubstrateController({
			sessionName: normalizedSessionName
		});
		airport.control.scopeToRepository({
			repositoryId: airport.repositoryId,
			repositoryRootPath: airport.repositoryRootPath,
			airportId: airport.control.getState().airportId,
			sessionName: normalizedSessionName
		});
	}

	public disconnectClient(clientId: string): string | undefined {
		const repositoryId = this.clientRepositoryIndex.get(clientId);
		if (!repositoryId) {
			return undefined;
		}
		const airport = this.airportRegistry.get(repositoryId);
		if (!airport) {
			this.clientRepositoryIndex.delete(clientId);
			return undefined;
		}
		airport.control.disconnectClient(clientId);
		this.clientRepositoryIndex.delete(clientId);
		return repositoryId;
	}

	public observeClient(repositoryId: string, params: Parameters<AirportControl['observeClient']>[0]): void {
		const airport = this.requireAirport(repositoryId);
		this.activeRepositoryId = repositoryId;
		this.clientRepositoryIndex.set(params.clientId, repositoryId);
		airport.control.observeClient(params);
	}

	public bindPane(repositoryId: string, params: BindAirportPaneParams): void {
		const airport = this.requireAirport(repositoryId);
		this.activeRepositoryId = repositoryId;
		airport.control.bindPane(params);
	}

	public applyDefaultBindings(
		repositoryId: string,
		bindings: Partial<Record<AirportPaneId, PaneBinding>>,
		options: { focusIntent?: AirportPaneId } = {}
	): void {
		const airport = this.requireAirport(repositoryId);
		this.activeRepositoryId = repositoryId;
		airport.control.applyDefaultBindings(bindings, options);
	}

	public observeSubstrate(repositoryId: string, substrate: AirportSubstrateState): void {
		const airport = this.requireAirport(repositoryId);
		airport.control.observeSubstrate(substrate);
	}

	public async sampleSubstrate(repositoryId: string): Promise<AirportSubstrateState> {
		const airport = this.requireAirport(repositoryId);
		return airport.substrateController.observe(airport.control.getState());
	}

	public async applyEffects(repositoryId: string, effects: AirportSubstrateEffect[]): Promise<AirportSubstrateState> {
		const airport = this.requireAirport(repositoryId);
		return airport.substrateController.applyEffects(effects);
	}

	private requireAirport(repositoryId: string): RepositoryAirportRecord {
		const airport = this.airportRegistry.get(repositoryId);
		if (!airport) {
			throw new Error(`Airport '${repositoryId}' is not loaded.`);
		}
		return airport;
	}

	private async ensureAirportForRepository(repositoryId: string, repositoryRootPath: string): Promise<RepositoryAirportRecord> {
		const existing = this.airportRegistry.get(repositoryId);
		if (existing) {
			return existing;
		}

		const identity = deriveRepositoryAirportIdentity(repositoryId, repositoryRootPath);
		const substrateController = new TerminalManagerSubstrateController({
			sessionName: identity.sessionName
		});
		const control = new AirportControl({
			airportId: identity.airportId,
			repositoryId,
			repositoryRootPath,
			terminalSessionName: identity.sessionName,
			initialSubstrateState: substrateController.getState()
		});
		const record: RepositoryAirportRecord = {
			repositoryId,
			repositoryRootPath,
			control,
			substrateController
		};
		this.airportRegistry.set(repositoryId, record);
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