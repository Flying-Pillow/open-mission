/**
 * @file packages/core/src/lib/repoConfig.ts
 * @description Defines repo-local Mission configuration defaults and helpers.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export const MISSION_DIRECTORY = '.mission';
export const MISSION_SETTINGS_FILE = 'settings.json';

export const MISSION_AGENT_RUNNERS = ['copilot'] as const;

export type MissionAgentRunner = (typeof MISSION_AGENT_RUNNERS)[number];
export type MissionDefaultAgentMode = 'interactive' | 'autonomous';

export type MissionRepoSettings = {
	agentRunner?: MissionAgentRunner;
	defaultAgentMode?: MissionDefaultAgentMode;
	defaultModel?: string;
	trackingProvider?: 'github';
	instructionsPath?: string;
	skillsPath?: string;
};

export function getMissionDirectoryPath(repoRoot: string): string {
	return path.join(repoRoot, MISSION_DIRECTORY);
}

export function getMissionSettingsPath(repoRoot: string): string {
	return path.join(getMissionDirectoryPath(repoRoot), MISSION_SETTINGS_FILE);
}

export function getMissionWorktreesPath(repoRoot: string): string {
	return path.join(getMissionDirectoryPath(repoRoot), 'worktrees');
}

export function getDefaultMissionRepoSettings(): MissionRepoSettings {
	return getDefaultMissionRepoSettingsWithOverrides();
}

export function getDefaultMissionRepoSettingsWithOverrides(
	overrides: MissionRepoSettings = {}
): MissionRepoSettings {
	const agentRunner = normalizeOptionalAgentRunner(overrides.agentRunner);
	const defaultAgentMode = normalizeOptionalAgentMode(overrides.defaultAgentMode);
	const defaultModel = normalizeOptionalString(overrides.defaultModel);
	const instructionsPath = normalizeOptionalString(overrides.instructionsPath);
	const skillsPath = normalizeOptionalString(overrides.skillsPath);
	return {
		trackingProvider: 'github',
		instructionsPath: '.agents',
		skillsPath: '.agents/skills',
		...(agentRunner ? { agentRunner } : {}),
		...(defaultAgentMode ? { defaultAgentMode } : {}),
		...(defaultModel ? { defaultModel } : {}),
		...(overrides.trackingProvider ? { trackingProvider: overrides.trackingProvider } : {}),
		...(instructionsPath ? { instructionsPath } : {}),
		...(skillsPath ? { skillsPath } : {})
	};
}

export function readMissionRepoSettings(repoRoot: string): MissionRepoSettings | undefined {
	const settingsPath = getMissionSettingsPath(repoRoot);
	try {
		const content = fs.readFileSync(settingsPath, 'utf8').trim();
		if (!content) {
			return undefined;
		}

		return JSON.parse(content) as MissionRepoSettings;
	} catch {
		return undefined;
	}
}

function normalizeOptionalString(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalAgentRunner(value: MissionAgentRunner | undefined): MissionAgentRunner | undefined {
	return value === 'copilot' ? value : undefined;
}

function normalizeOptionalAgentMode(
	value: MissionDefaultAgentMode | undefined
): MissionDefaultAgentMode | undefined {
	return value === 'interactive' || value === 'autonomous' ? value : undefined;
}

export async function writeMissionRepoSettings(
	repoRoot: string,
	settings: MissionRepoSettings
): Promise<MissionRepoSettings> {
	const settingsPath = getMissionSettingsPath(repoRoot);
	const nextSettings = getDefaultMissionRepoSettingsWithOverrides(settings);
	await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
	await fsp.writeFile(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, 'utf8');
	return nextSettings;
}