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

export type MissionUserRegisteredRepository = {
	checkoutPath: string;
};

export type MissionUserConfig = {
	version: 1;
	missionWorkspaceRoot?: string;
	ghBinary?: string;
	registeredRepositories?: MissionUserRegisteredRepository[];
};

export function getMissionUserConfigDirectory(): string {
	const configuredPath = resolveConfiguredMissionConfigDirectory();
	if (configuredPath) {
		return configuredPath;
	}

	const xdgConfigHome = process.env['XDG_CONFIG_HOME']?.trim();
	return xdgConfigHome
		? path.join(xdgConfigHome, MISSION_USER_CONFIG_DIRECTORY)
		: path.join(os.homedir(), '.config', MISSION_USER_CONFIG_DIRECTORY);
}

export function getMissionUserConfigPath(): string {
	return path.join(getMissionUserConfigDirectory(), MISSION_USER_CONFIG_FILE);
}

export function getMissionRuntimeDirectory(): string {
	return path.join(getMissionUserConfigDirectory(), 'runtime');
}

export function getDefaultMissionUserConfig(overrides: Partial<MissionUserConfig> = {}): MissionUserConfig {
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
	const configuredBinary = normalizeOptionalString(readMissionUserConfig()?.ghBinary);
	if (!configuredBinary) {
		return undefined;
	}
	if ((path.isAbsolute(configuredBinary) || configuredBinary.includes(path.sep)) && !fs.existsSync(configuredBinary)) {
		return undefined;
	}
	return configuredBinary;
}

export function readMissionUserConfig(): MissionUserConfig | undefined {
	return loadMissionUserConfig().config;
}

export async function ensureMissionUserConfig(): Promise<MissionUserConfig> {
	const currentConfig = loadMissionUserConfig();
	if (currentConfig.config) {
		if (currentConfig.needsRewrite) {
			return writeMissionUserConfig(currentConfig.config);
		}
		return currentConfig.config;
	}
	return writeMissionUserConfig(getDefaultMissionUserConfig());
}

export async function writeMissionUserConfig(config: Partial<MissionUserConfig>): Promise<MissionUserConfig> {
	const configPath = getMissionUserConfigPath();
	const nextConfig = getDefaultMissionUserConfig(config);
	const temporaryPath = `${configPath}.${process.pid.toString(36)}.${Date.now().toString(36)}.tmp`;
	await fsp.mkdir(path.dirname(configPath), { recursive: true });
	await fsp.writeFile(temporaryPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');
	await fsp.rename(temporaryPath, configPath);
	return nextConfig;
}

export async function registerMissionUserRepo(workspacePath: string): Promise<MissionUserConfig> {
	const controlRoot = resolveGitWorkspaceRoot(workspacePath);
	if (!controlRoot) {
		throw new Error(`Mission could not resolve a Git repository from '${workspacePath}'.`);
	}

	const config = await ensureMissionUserConfig();
	const currentEntries = normalizeRegisteredRepositories(config.registeredRepositories) ?? [];
	if (currentEntries.some((entry) => entry.checkoutPath === controlRoot)) {
		return config;
	}

	const nextConfig = await writeMissionUserConfig({
		...config,
		registeredRepositories: [...currentEntries, { checkoutPath: controlRoot }]
	});
	return nextConfig;
}

export async function listRegisteredUserRepositories(): Promise<RepositoryCandidate[]> {
	const config = await ensureMissionUserConfig();
	return (normalizeRegisteredRepositories(config.registeredRepositories) ?? [])
		.map((entry) => buildRepositoryCandidate(entry.checkoutPath))
		.filter((entry): entry is RepositoryCandidate => entry !== undefined)
		.sort((left, right) => left.label.localeCompare(right.label));
}

export async function findRegisteredUserRepositoryById(repositoryId: string): Promise<RepositoryCandidate | undefined> {
	const normalizedRepositoryId = repositoryId.trim();
	if (!normalizedRepositoryId) {
		return undefined;
	}
	return (await listRegisteredUserRepositories()).find((candidate) => candidate.repositoryId === normalizedRepositoryId);
}

function loadMissionUserConfig(): {
	config: MissionUserConfig | undefined;
	needsRewrite: boolean;
} {
	const configPath = getMissionUserConfigPath();
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

function normalizeResolvedConfig(rawConfig: unknown): MissionUserConfig | undefined {
	if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
		return undefined;
	}
	const candidate = rawConfig as Record<string, unknown>;
	return getDefaultMissionUserConfig({
		...(typeof candidate['missionWorkspaceRoot'] === 'string'
			? { missionWorkspaceRoot: candidate['missionWorkspaceRoot'] }
			: {}),
		...(typeof candidate['ghBinary'] === 'string'
			? { ghBinary: candidate['ghBinary'] }
			: {}),
		...(Array.isArray(candidate['registeredRepositories'])
			? { registeredRepositories: candidate['registeredRepositories'] as MissionUserRegisteredRepository[] }
			: {})
	});
}

function normalizeRegisteredRepositories(
	value: MissionUserRegisteredRepository[] | undefined
): MissionUserRegisteredRepository[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const normalizedEntries = value
		.map((record) => {
			const checkoutPath = normalizeOptionalString(record?.checkoutPath);
			if (!checkoutPath) {
				return undefined;
			}
			const resolvedCheckoutPath = path.resolve(checkoutPath);
			if (!fs.existsSync(resolvedCheckoutPath)) {
				return undefined;
			}
			const controlRoot = resolveGitWorkspaceRoot(resolvedCheckoutPath);
			if (!controlRoot) {
				return undefined;
			}
			return { checkoutPath: path.resolve(controlRoot) };
		})
		.filter((entry): entry is MissionUserRegisteredRepository => entry !== undefined);
	const deduplicated = normalizedEntries.filter(
		(entry, index, entries) => entries.findIndex((candidate) => candidate.checkoutPath === entry.checkoutPath) === index
	);
	return deduplicated.length > 0 ? deduplicated : undefined;
}

function buildRepositoryCandidate(
	workspacePath: string
): RepositoryCandidate | undefined {
	const controlRoot = resolveGitWorkspaceRoot(workspacePath);
	if (!controlRoot) {
		return undefined;
	}
	if (!fs.existsSync(controlRoot)) {
		return undefined;
	}
	const githubRepository = resolveGitHubRepositoryFromWorkspace(controlRoot);
	const label = githubRepository ? githubRepository.split('/').pop() ?? path.basename(controlRoot) : path.basename(controlRoot);
	const repositoryIdentity = deriveRepositoryIdentity(controlRoot);
	return {
		repositoryId: repositoryIdentity.repositoryId,
		repositoryRootPath: controlRoot,
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