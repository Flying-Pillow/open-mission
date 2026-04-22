import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveGitHubRepositoryFromWorkspace } from '../platforms/GitHubPlatformAdapter.js';
import { resolveGitWorkspaceRoot } from './workspacePaths.js';
import { deriveRepositoryIdentity } from './repositoryIdentity.js';
import type { RepositoryCandidate } from '../types.js';

export const MISSION_USER_CONFIG_DIRECTORY = 'mission';
export const MISSION_USER_CONFIG_FILE = 'config.json';

export type MissionRegisteredRepository = {
	repositoryId: string;
	repositoryRootPath: string;
};

export type MissionConfig = {
	version: 1;
	missionWorkspaceRoot?: string;
	ghBinary?: string;
	registeredRepositories?: MissionRegisteredRepository[];
};

export function getMissionConfigDirectory(): string {
	const configuredPath = resolveConfiguredMissionConfigDirectory();
	if (configuredPath) {
		return configuredPath;
	}

	const xdgConfigHome = process.env['XDG_CONFIG_HOME']?.trim();
	return xdgConfigHome
		? path.join(xdgConfigHome, MISSION_USER_CONFIG_DIRECTORY)
		: path.join(os.homedir(), '.config', MISSION_USER_CONFIG_DIRECTORY);
}

export function getMissionConfigPath(): string {
	return path.join(getMissionConfigDirectory(), MISSION_USER_CONFIG_FILE);
}

export function getMissionRuntimeDirectory(): string {
	return path.join(getMissionConfigDirectory(), 'runtime');
}

export function getDefaultMissionConfig(overrides: Partial<MissionConfig> = {}): MissionConfig {
	const missionWorkspaceRoot = normalizeOptionalString(overrides.missionWorkspaceRoot);
	const ghBinary = normalizeOptionalString(overrides.ghBinary);
	const registeredRepositories = normalizeRegisteredRepositories(overrides.registeredRepositories);
	return {
		version: 1,
		missionWorkspaceRoot: missionWorkspaceRoot ?? 'missions',
		...(ghBinary ? { ghBinary } : {}),
		...(registeredRepositories ? { registeredRepositories } : {})
	};
}

export function getMissionGitHubCliBinary(): string | undefined {
	const configuredBinary = normalizeOptionalString(readMissionConfig()?.ghBinary);
	if (!configuredBinary) {
		return undefined;
	}
	if ((path.isAbsolute(configuredBinary) || configuredBinary.includes(path.sep)) && !fs.existsSync(configuredBinary)) {
		return undefined;
	}
	return configuredBinary;
}

export function readMissionConfig(): MissionConfig | undefined {
	return loadMissionConfig().config;
}

export async function ensureMissionConfig(): Promise<MissionConfig> {
	const currentConfig = loadMissionConfig();
	if (currentConfig.config) {
		if (currentConfig.needsRewrite) {
			return writeMissionConfig(currentConfig.config);
		}
		return currentConfig.config;
	}
	return writeMissionConfig(getDefaultMissionConfig());
}

export async function writeMissionConfig(config: Partial<MissionConfig>): Promise<MissionConfig> {
	const configPath = getMissionConfigPath();
	const nextConfig = getDefaultMissionConfig(config);
	const temporaryPath = `${configPath}.${process.pid.toString(36)}.${Date.now().toString(36)}.tmp`;
	await fsp.mkdir(path.dirname(configPath), { recursive: true });
	await fsp.writeFile(temporaryPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');
	await fsp.rename(temporaryPath, configPath);
	return nextConfig;
}

export async function registerMissionRepo(workspacePath: string): Promise<MissionConfig> {
	const controlRoot = resolveGitWorkspaceRoot(workspacePath);
	if (!controlRoot) {
		throw new Error(`Mission could not resolve a Git repository from '${workspacePath}'.`);
	}
	const repositoryIdentity = deriveRepositoryIdentity(controlRoot);

	const config = await ensureMissionConfig();
	const currentEntries = normalizeRegisteredRepositories(config.registeredRepositories) ?? [];
	if (
		currentEntries.some(
			(entry) => entry.repositoryId === repositoryIdentity.repositoryId || entry.repositoryRootPath === controlRoot
		)
	) {
		return config;
	}

	const nextConfig = await writeMissionConfig({
		...config,
		registeredRepositories: [
			...currentEntries,
			{
				repositoryId: repositoryIdentity.repositoryId,
				repositoryRootPath: repositoryIdentity.repositoryRootPath
			}
		]
	});
	return nextConfig;
}

export async function listRegisteredRepositories(): Promise<RepositoryCandidate[]> {
	const config = await ensureMissionConfig();
	return (normalizeRegisteredRepositories(config.registeredRepositories) ?? [])
		.map((entry) => buildRepositoryCandidate(entry))
		.filter((entry): entry is RepositoryCandidate => entry !== undefined)
		.sort((left, right) => left.label.localeCompare(right.label));
}

export async function findRegisteredRepositoryById(repositoryId: string): Promise<RepositoryCandidate | undefined> {
	const normalizedRepositoryId = repositoryId.trim();
	if (!normalizedRepositoryId) {
		return undefined;
	}
	return (await listRegisteredRepositories()).find((candidate) => candidate.repositoryId === normalizedRepositoryId);
}

function loadMissionConfig(): {
	config: MissionConfig | undefined;
	needsRewrite: boolean;
} {
	const configPath = getMissionConfigPath();
	try {
		const content = fs.readFileSync(configPath, 'utf8').trim();
		if (!content) {
			return { config: undefined, needsRewrite: false };
		}
		const rawConfig = JSON.parse(content) as unknown;
		const config = normalizeResolvedConfig(rawConfig);
		if (!config) {
			return { config: undefined, needsRewrite: false };
		}
		return {
			config,
			needsRewrite: JSON.stringify(rawConfig) !== JSON.stringify(config)
		};
	} catch {
		return { config: undefined, needsRewrite: false };
	}
}

function normalizeResolvedConfig(rawConfig: unknown): MissionConfig | undefined {
	if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
		return undefined;
	}
	const candidate = rawConfig as Record<string, unknown>;
	return getDefaultMissionConfig({
		...(typeof candidate['missionWorkspaceRoot'] === 'string'
			? { missionWorkspaceRoot: candidate['missionWorkspaceRoot'] }
			: {}),
		...(typeof candidate['ghBinary'] === 'string'
			? { ghBinary: candidate['ghBinary'] }
			: {}),
		...(Array.isArray(candidate['registeredRepositories'])
			? { registeredRepositories: candidate['registeredRepositories'] as MissionRegisteredRepository[] }
			: {})
	});
}

function normalizeRegisteredRepositories(
	value: MissionRegisteredRepository[] | undefined
): MissionRegisteredRepository[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const normalizedEntries = value
		.map((record) => {
			const recordCandidate = record as Partial<MissionRegisteredRepository> & {
				checkoutPath?: string;
			};
			const repositoryRootPath = normalizeOptionalString(recordCandidate.repositoryRootPath)
				?? normalizeOptionalString(recordCandidate.checkoutPath);
			if (!repositoryRootPath) {
				return undefined;
			}
			const resolvedRepositoryRootPath = path.resolve(repositoryRootPath);
			if (!fs.existsSync(resolvedRepositoryRootPath)) {
				return undefined;
			}
			const controlRoot = resolveGitWorkspaceRoot(resolvedRepositoryRootPath);
			if (!controlRoot) {
				return undefined;
			}
			const repositoryIdentity = deriveRepositoryIdentity(controlRoot);
			return {
				repositoryId: repositoryIdentity.repositoryId,
				repositoryRootPath: repositoryIdentity.repositoryRootPath
			};
		})
		.filter((entry): entry is MissionRegisteredRepository => entry !== undefined);
	const deduplicated = normalizedEntries.filter(
		(entry, index, entries) => entries.findIndex((candidate) => candidate.repositoryRootPath === entry.repositoryRootPath) === index
	);
	return deduplicated.length > 0 ? deduplicated : undefined;
}

function buildRepositoryCandidate(
	repository: MissionRegisteredRepository
): RepositoryCandidate | undefined {
	const controlRoot = resolveGitWorkspaceRoot(repository.repositoryRootPath);
	if (!controlRoot) {
		return undefined;
	}
	if (!fs.existsSync(controlRoot)) {
		return undefined;
	}
	const githubRepository = resolveGitHubRepositoryFromWorkspace(controlRoot);
	const label = githubRepository ? githubRepository.split('/').pop() ?? path.basename(controlRoot) : path.basename(controlRoot);
	return {
		repositoryId: repository.repositoryId,
		repositoryRootPath: repository.repositoryRootPath,
		label,
		description: githubRepository ?? controlRoot,
		...(githubRepository ? { githubRepository } : {})
	};
}

function normalizeOptionalString(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function resolveConfiguredMissionConfigDirectory(): string | undefined {
	const configuredPath = normalizeOptionalString(process.env['MISSION_CONFIG_PATH']);
	if (!configuredPath) {
		return undefined;
	}

	const resolvedPath = path.resolve(configuredPath);
	return path.basename(resolvedPath) === MISSION_USER_CONFIG_DIRECTORY
		? resolvedPath
		: path.join(resolvedPath, MISSION_USER_CONFIG_DIRECTORY);
}