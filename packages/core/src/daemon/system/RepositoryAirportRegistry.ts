import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
	AirportControl,
	TerminalManagerSubstrateController,
	createDefaultGateBindings,
	type AirportSubstrateState,
	type BindAirportGateParams,
	type ConnectAirportClientParams,
	type GateBinding,
	type GateId,
	type PersistedAirportIntent
} from '../../../../airport/build/index.js';
import {
	getMissionDaemonSettingsPath,
	readMissionDaemonSettings,
	writeMissionDaemonSettings
} from '../../lib/daemonConfig.js';

type RepositoryAirportRecord = {
	repositoryId: string;
	repositoryRootPath: string;
	control: AirportControl;
	substrateController: TerminalManagerSubstrateController;
	serializedPersistedIntent?: string;
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
		airport.control.scopeToRepository({
			repositoryId,
			repositoryRootPath,
			airportId: deriveRepositoryAirportIdentity(repositoryId, repositoryRootPath).airportId,
			sessionName: deriveRepositoryAirportIdentity(repositoryId, repositoryRootPath).sessionName
		});
		return airport;
	}

	public async resolveAirportForRequest(clientId: string, repositoryId?: string, repositoryRootPath?: string): Promise<RepositoryAirportRecord> {
		if (repositoryId && repositoryRootPath) {
			this.activeRepositoryId = repositoryId;
			return this.ensureAirportForRepository(repositoryId, repositoryRootPath);
		}
		const indexedRepositoryId = this.clientRepositoryIndex.get(clientId) ?? this.activeRepositoryId;
		if (!indexedRepositoryId) {
			throw new Error('Airport request requires a repository-scoped surface path or active airport selection.');
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

	public bindGate(repositoryId: string, params: BindAirportGateParams): void {
		const airport = this.requireAirport(repositoryId);
		this.activeRepositoryId = repositoryId;
		airport.control.bindGate(params);
	}

	public applyDefaultBindings(
		repositoryId: string,
		bindings: Partial<Record<GateId, GateBinding>>,
		options: { focusIntent?: GateId } = {}
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

	public async persistTouchedAirportIntents(repositoryIds: string[]): Promise<void> {
		for (const repositoryId of new Set(repositoryIds)) {
			const airport = this.airportRegistry.get(repositoryId);
			if (!airport) {
				continue;
			}

			const nextPersistedIntent = toPersistableAirportIntent(airport);
			const serializedPersistedIntent = serializePersistedAirportIntent(nextPersistedIntent);
			if (serializedPersistedIntent === airport.serializedPersistedIntent) {
				continue;
			}
			if (!(await daemonSettingsExist(airport.repositoryRootPath))) {
				airport.serializedPersistedIntent = serializedPersistedIntent;
				continue;
			}

			const currentSettings = readMissionDaemonSettings(airport.repositoryRootPath) ?? {};
			const { airport: _currentAirport, ...baseSettings } = currentSettings;
			await writeMissionDaemonSettings(
				{
					...baseSettings,
					...(nextPersistedIntent ? { airport: nextPersistedIntent } : {})
				},
				airport.repositoryRootPath
			);
			airport.serializedPersistedIntent = serializedPersistedIntent;
		}
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
		const persistedIntent = this.readPersistedAirportIntent(repositoryRootPath);
		const substrateController = new TerminalManagerSubstrateController({
			sessionName: identity.sessionName
		});
		const control = new AirportControl({
			airportId: identity.airportId,
			repositoryId,
			repositoryRootPath,
			...(persistedIntent ? { persistedIntent } : {}),
			initialSubstrateState: substrateController.getState()
		});
		const record: RepositoryAirportRecord = {
			repositoryId,
			repositoryRootPath,
			control,
			substrateController,
			serializedPersistedIntent: serializePersistedAirportIntent(persistedIntent)
		};
		this.airportRegistry.set(repositoryId, record);
		return record;
	}

	private readPersistedAirportIntent(repositoryRootPath: string): PersistedAirportIntent | undefined {
		const settings = readMissionDaemonSettings(repositoryRootPath);
		return settings?.airport;
	}
}

export function deriveRepositoryAirportIdentity(repositoryId: string, repositoryRootPath: string) {
	const repositoryLabel = slugifyRepositoryLabel(path.basename(repositoryRootPath) || 'repository');
	const repositoryHash = hashRepositoryScope(repositoryRootPath);
	return {
		repositoryId,
		repositoryRootPath,
		airportId: `airport:${repositoryLabel}:${repositoryHash}`,
		sessionName: process.env['MISSION_TERMINAL_SESSION']?.trim()
			|| process.env['MISSION_TERMINAL_SESSION_NAME']?.trim()
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

function serializePersistedAirportIntent(intent: PersistedAirportIntent | undefined): string {
	return JSON.stringify(intent ?? null);
}

function toPersistableAirportIntent(record: RepositoryAirportRecord): PersistedAirportIntent | undefined {
	const currentIntent = record.control.getPersistedIntent();
	const defaultIntent: PersistedAirportIntent = {
		gates: createDefaultGateBindings(record.repositoryId)
	};
	return serializePersistedAirportIntent(currentIntent) === serializePersistedAirportIntent(defaultIntent)
		? undefined
		: currentIntent;
}

async function daemonSettingsExist(repositoryRootPath: string): Promise<boolean> {
	try {
		await fs.access(getMissionDaemonSettingsPath(repositoryRootPath));
		return true;
	} catch {
		return false;
	}
}