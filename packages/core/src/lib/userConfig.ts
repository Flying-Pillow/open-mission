import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveGitHubRepositoryFromWorkspace } from '../platforms/GitHubPlatformAdapter.js';
import { resolveGitWorkspaceRoot } from './workspacePaths.js';
import type { MissionRepositoryCandidate } from '../types.js';

export const MISSION_USER_CONFIG_DIRECTORY = 'mission';
export const MISSION_USER_CONFIG_FILE = 'config.json';

export type MissionUserRegisteredRepository = {
	checkoutPath: string;
};

export type MissionUserConfig = {
	version: 1;
	missionWorkspaceRoot?: string;
	terminalBinary?: string;
	editorBinary?: string;
	registeredRepositories?: MissionUserRegisteredRepository[];
};

export function getMissionUserConfigDirectory(): string {
	const xdgConfigHome = process.env['XDG_CONFIG_HOME']?.trim();
	return xdgConfigHome
		? path.join(xdgConfigHome, MISSION_USER_CONFIG_DIRECTORY)
		: path.join(os.homedir(), '.config', MISSION_USER_CONFIG_DIRECTORY);
}

export function getMissionUserConfigPath(): string {
	return path.join(getMissionUserConfigDirectory(), MISSION_USER_CONFIG_FILE);
}

export function getDefaultMissionUserConfig(overrides: Partial<MissionUserConfig> = {}): MissionUserConfig {
	const missionWorkspaceRoot = normalizeOptionalString(overrides.missionWorkspaceRoot);
	const terminalBinary = normalizeOptionalString(overrides.terminalBinary);
	const editorBinary = normalizeOptionalString(overrides.editorBinary);
	const registeredRepositories = normalizeRegisteredRepositories(overrides.registeredRepositories);
	return {
		version: 1,
		missionWorkspaceRoot: missionWorkspaceRoot ?? 'missions',
		terminalBinary: terminalBinary ?? 'zellij',
		editorBinary: editorBinary ?? 'micro',
		...(registeredRepositories ? { registeredRepositories } : {})
	};
}

export function readMissionUserConfig(): MissionUserConfig | undefined {
	const configPath = getMissionUserConfigPath();
	try {
		const content = fs.readFileSync(configPath, 'utf8').trim();
		if (!content) {
			return undefined;
		}
		return normalizeResolvedConfig(JSON.parse(content) as unknown);
	} catch {
		return undefined;
	}
}

export async function ensureMissionUserConfig(): Promise<MissionUserConfig> {
	const currentConfig = readMissionUserConfig();
	if (currentConfig) {
		return currentConfig;
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

export async function listRegisteredMissionUserRepos(): Promise<MissionRepositoryCandidate[]> {
	const config = await ensureMissionUserConfig();
	return (normalizeRegisteredRepositories(config.registeredRepositories) ?? [])
		.map((entry) => buildMissionRepositoryCandidate(entry.checkoutPath))
		.filter((entry): entry is MissionRepositoryCandidate => entry !== undefined)
		.sort((left, right) => left.label.localeCompare(right.label));
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
		...(typeof candidate['terminalBinary'] === 'string'
			? { terminalBinary: candidate['terminalBinary'] }
			: {}),
		...(typeof candidate['editorBinary'] === 'string'
			? { editorBinary: candidate['editorBinary'] }
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
			return { checkoutPath: path.resolve(checkoutPath) };
		})
		.filter((entry): entry is MissionUserRegisteredRepository => entry !== undefined);
	const deduplicated = normalizedEntries.filter(
		(entry, index, entries) => entries.findIndex((candidate) => candidate.checkoutPath === entry.checkoutPath) === index
	);
	return deduplicated.length > 0 ? deduplicated : undefined;
}

function buildMissionRepositoryCandidate(
	workspacePath: string
): MissionRepositoryCandidate | undefined {
	const controlRoot = resolveGitWorkspaceRoot(workspacePath);
	if (!controlRoot) {
		return undefined;
	}
	if (!fs.existsSync(controlRoot)) {
		return undefined;
	}
	const githubRepository = resolveGitHubRepositoryFromWorkspace(controlRoot);
	const label = githubRepository ? githubRepository.split('/').pop() ?? path.basename(controlRoot) : path.basename(controlRoot);
	return {
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