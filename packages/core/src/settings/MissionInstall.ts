import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export const MISSION_CONFIG_DIRECTORY = 'mission';
export const MISSION_CONFIG_FILE = 'config.json';

export type MissionConfig = {
	version: 1;
	missionsRoot: string;
	repositoriesRoot: string;
	ghBinary?: string;
};

export function getMissionConfigDirectory(): string {
	const configuredPath = resolveConfiguredMissionConfigDirectory();
	if (configuredPath) {
		return configuredPath;
	}

	const xdgConfigHome = process.env['XDG_CONFIG_HOME']?.trim();
	return xdgConfigHome
		? path.join(xdgConfigHome, MISSION_CONFIG_DIRECTORY)
		: path.join(os.homedir(), '.config', MISSION_CONFIG_DIRECTORY);
}

export function getMissionConfigPath(): string {
	return path.join(getMissionConfigDirectory(), MISSION_CONFIG_FILE);
}

export function getMissionDaemonDirectory(): string {
	return path.join(getMissionConfigDirectory(), 'runtime');
}

export function getMissionManagedDependenciesRoot(): string {
	return path.join(getMissionConfigDirectory(), 'dependencies');
}

export function getDefaultMissionConfig(overrides: Partial<MissionConfig> = {}): MissionConfig {
	const missionsRoot = normalizeOptionalString(overrides.missionsRoot);
	const repositoriesRoot = normalizeOptionalString(overrides.repositoriesRoot);
	const ghBinary = normalizeOptionalString(overrides.ghBinary);
	return {
		version: 1,
		missionsRoot: missionsRoot ?? defaultRootPath('MISSIONS_PATH', 'missions'),
		repositoriesRoot: repositoriesRoot ?? defaultRootPath('REPOSITORIES_PATH', 'repositories'),
		...(ghBinary ? { ghBinary } : {})
	};
}

export function resolveMissionsRoot(config: MissionConfig = getDefaultMissionConfig()): string {
	return path.resolve(config.missionsRoot);
}

export function resolveRepositoriesRoot(config: MissionConfig = getDefaultMissionConfig()): string {
	return path.resolve(config.repositoriesRoot);
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
	if (typeof candidate['missionsRoot'] !== 'string' || typeof candidate['repositoriesRoot'] !== 'string') {
		return undefined;
	}
	return getDefaultMissionConfig({
		missionsRoot: candidate['missionsRoot'],
		repositoriesRoot: candidate['repositoriesRoot'],
		...(typeof candidate['ghBinary'] === 'string'
			? { ghBinary: candidate['ghBinary'] }
			: {})
	});
}

function defaultRootPath(environmentVariableName: string, directoryName: string): string {
	const configuredRoot = normalizeOptionalString(process.env[environmentVariableName]);
	return configuredRoot ?? path.join(os.homedir(), directoryName);
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
	return path.basename(resolvedPath) === MISSION_CONFIG_DIRECTORY
		? resolvedPath
		: path.join(resolvedPath, MISSION_CONFIG_DIRECTORY);
}