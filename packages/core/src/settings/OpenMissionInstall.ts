import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	parseSystemAgentSettings,
	type SystemAgentSettingsType
} from '../entities/System/SystemSchema.js';

export const OPEN_MISSION_CONFIG_DIRECTORY = 'open-mission';
export const OPEN_MISSION_CONFIG_FILE = 'config.json';

export type OpenMissionConfig = {
	version: 1;
	missionsRoot: string;
	repositoriesRoot: string;
	ghBinary?: string;
} & SystemAgentSettingsType;

export function getOpenMissionConfigDirectory(): string {
	const configuredPath = resolveConfiguredOpenMissionConfigDirectory();
	if (configuredPath) {
		return configuredPath;
	}

	const xdgConfigHome = process.env['XDG_CONFIG_HOME']?.trim();
	return xdgConfigHome
		? path.join(xdgConfigHome, OPEN_MISSION_CONFIG_DIRECTORY)
		: path.join(os.homedir(), '.config', OPEN_MISSION_CONFIG_DIRECTORY);
}

export function getOpenMissionConfigPath(): string {
	return path.join(getOpenMissionConfigDirectory(), OPEN_MISSION_CONFIG_FILE);
}

export function getOpenMissionRuntimeDirectory(): string {
	return path.join(getOpenMissionConfigDirectory(), 'runtime');
}

export function getOpenMissionManagedDependenciesRoot(): string {
	return path.join(getOpenMissionConfigDirectory(), 'dependencies');
}

export function getDefaultOpenMissionConfig(overrides: Partial<OpenMissionConfig> = {}): OpenMissionConfig {
	const missionsRoot = normalizeOptionalString(overrides.missionsRoot);
	const repositoriesRoot = normalizeOptionalString(overrides.repositoriesRoot);
	const ghBinary = normalizeOptionalString(overrides.ghBinary);
	const systemAgentSettings = parseSystemAgentSettings({
		...(overrides.defaultAgentAdapter !== undefined ? { defaultAgentAdapter: overrides.defaultAgentAdapter } : {}),
		...(overrides.enabledAgentAdapters !== undefined ? { enabledAgentAdapters: overrides.enabledAgentAdapters } : {}),
		...(overrides.defaultAgentMode !== undefined ? { defaultAgentMode: overrides.defaultAgentMode } : {}),
		...(overrides.defaultModel !== undefined ? { defaultModel: overrides.defaultModel } : {}),
		...(overrides.defaultReasoningEffort !== undefined ? { defaultReasoningEffort: overrides.defaultReasoningEffort } : {})
	});
	return {
		version: 1,
		missionsRoot: missionsRoot ?? defaultRootPath('MISSIONS_PATH', 'missions'),
		repositoriesRoot: repositoriesRoot ?? defaultRootPath('REPOSITORIES_PATH', 'repositories'),
		...systemAgentSettings,
		...(ghBinary ? { ghBinary } : {})
	};
}

export function resolveMissionsRoot(config: OpenMissionConfig = getDefaultOpenMissionConfig()): string {
	return path.resolve(config.missionsRoot);
}

export function resolveRepositoriesRoot(config: OpenMissionConfig = getDefaultOpenMissionConfig()): string {
	return path.resolve(config.repositoriesRoot);
}

export function getOpenMissionGitHubCliBinary(): string | undefined {
	const configuredBinary = normalizeOptionalString(readOpenMissionConfig()?.ghBinary);
	if (!configuredBinary) {
		return undefined;
	}
	if ((path.isAbsolute(configuredBinary) || configuredBinary.includes(path.sep)) && !fs.existsSync(configuredBinary)) {
		return undefined;
	}
	return configuredBinary;
}

export function readOpenMissionConfig(): OpenMissionConfig | undefined {
	return loadOpenMissionConfig().config;
}

export async function ensureOpenMissionConfig(): Promise<OpenMissionConfig> {
	const currentConfig = loadOpenMissionConfig();
	if (currentConfig.config) {
		if (currentConfig.needsRewrite) {
			return writeOpenMissionConfig(currentConfig.config);
		}
		return currentConfig.config;
	}
	return writeOpenMissionConfig(getDefaultOpenMissionConfig());
}

export async function writeOpenMissionConfig(config: Partial<OpenMissionConfig>): Promise<OpenMissionConfig> {
	const configPath = getOpenMissionConfigPath();
	const nextConfig = getDefaultOpenMissionConfig(config);
	const temporaryPath = `${configPath}.${process.pid.toString(36)}.${Date.now().toString(36)}.tmp`;
	await fsp.mkdir(path.dirname(configPath), { recursive: true });
	await fsp.writeFile(temporaryPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');
	await fsp.rename(temporaryPath, configPath);
	return nextConfig;
}

function loadOpenMissionConfig(): {
	config: OpenMissionConfig | undefined;
	needsRewrite: boolean;
} {
	const configPath = getOpenMissionConfigPath();
	try {
		const content = fs.readFileSync(configPath, 'utf8').trim();
		if (!content) {
			return { config: undefined, needsRewrite: false };
		}
		const rawConfig = JSON.parse(content) as unknown;
		const config = normalizeResolvedOpenMissionConfig(rawConfig);
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

function normalizeResolvedOpenMissionConfig(rawConfig: unknown): OpenMissionConfig | undefined {
	if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
		return undefined;
	}
	const candidate = rawConfig as Record<string, unknown>;
	if (typeof candidate['missionsRoot'] !== 'string' || typeof candidate['repositoriesRoot'] !== 'string') {
		return undefined;
	}
	const enabledAgentAdapters = Array.isArray(candidate['enabledAgentAdapters']) && candidate['enabledAgentAdapters'].every((value) => typeof value === 'string')
		? candidate['enabledAgentAdapters']
		: undefined;
	const defaultAgentMode = candidate['defaultAgentMode'] === 'autonomous'
		? 'print'
		: candidate['defaultAgentMode'];
	const defaultReasoningEffort = candidate['defaultReasoningEffort'];
	const systemAgentSettings = parseSystemAgentSettings({
		...(typeof candidate['defaultAgentAdapter'] === 'string'
			? { defaultAgentAdapter: candidate['defaultAgentAdapter'] }
			: {}),
		...(enabledAgentAdapters ? { enabledAgentAdapters } : {}),
		...(defaultAgentMode === 'interactive' || defaultAgentMode === 'print'
			? { defaultAgentMode }
			: {}),
		...(typeof candidate['defaultModel'] === 'string'
			? { defaultModel: candidate['defaultModel'] }
			: {}),
		...(defaultReasoningEffort === 'low' || defaultReasoningEffort === 'medium' || defaultReasoningEffort === 'high' || defaultReasoningEffort === 'xhigh'
			? { defaultReasoningEffort }
			: {})
	});
	return getDefaultOpenMissionConfig({
		missionsRoot: candidate['missionsRoot'],
		repositoriesRoot: candidate['repositoriesRoot'],
		...systemAgentSettings,
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

function resolveConfiguredOpenMissionConfigDirectory(): string | undefined {
	const configuredPath = normalizeOptionalString(process.env['OPEN_MISSION_CONFIG_PATH']);
	if (!configuredPath) {
		return undefined;
	}

	const resolvedPath = path.resolve(configuredPath);
	return path.basename(resolvedPath) === OPEN_MISSION_CONFIG_DIRECTORY
		? resolvedPath
		: path.join(resolvedPath, OPEN_MISSION_CONFIG_DIRECTORY);
}