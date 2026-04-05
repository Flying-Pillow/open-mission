import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { getMissionDirectoryPath } from './repoConfig.js';
import { resolveGitWorkspaceRoot } from './workspacePaths.js';

export const MISSION_DAEMON_SETTINGS_FILE = 'settings.json';

export const MISSION_AGENT_RUNNERS = ['copilot'] as const;

export type MissionAgentRunner = (typeof MISSION_AGENT_RUNNERS)[number];
export type MissionDefaultAgentMode = 'interactive' | 'autonomous';

export type MissionDaemonSettings = {
    agentRunner?: MissionAgentRunner;
    defaultAgentMode?: MissionDefaultAgentMode;
    defaultModel?: string;
    cockpitTheme?: string;
    trackingProvider?: 'github';
    instructionsPath?: string;
    skillsPath?: string;
};

export function getMissionDaemonRoot(controlRoot = process.cwd()): string {
    return getMissionDirectoryPath(resolveMissionControlRoot(controlRoot));
}

export function getMissionDaemonSettingsPath(controlRoot = process.cwd()): string {
    return path.join(getMissionDaemonRoot(controlRoot), MISSION_DAEMON_SETTINGS_FILE);
}

export function getDefaultMissionDaemonSettings(): MissionDaemonSettings {
    return getDefaultMissionDaemonSettingsWithOverrides();
}

export function getDefaultMissionDaemonSettingsWithOverrides(
    overrides: MissionDaemonSettings = {}
): MissionDaemonSettings {
    const agentRunner = normalizeOptionalAgentRunner(overrides.agentRunner);
    const defaultAgentMode = normalizeOptionalAgentMode(overrides.defaultAgentMode);
    const defaultModel = normalizeOptionalString(overrides.defaultModel);
    const cockpitTheme = normalizeOptionalString(overrides.cockpitTheme);
    const instructionsPath = normalizeOptionalString(overrides.instructionsPath);
    const skillsPath = normalizeOptionalString(overrides.skillsPath);
    return {
        trackingProvider: 'github',
        instructionsPath: '.agents',
        skillsPath: '.agents/skills',
        ...(agentRunner ? { agentRunner } : {}),
        ...(defaultAgentMode ? { defaultAgentMode } : {}),
        ...(defaultModel ? { defaultModel } : {}),
        ...(cockpitTheme ? { cockpitTheme } : {}),
        ...(overrides.trackingProvider ? { trackingProvider: overrides.trackingProvider } : {}),
        ...(instructionsPath ? { instructionsPath } : {}),
        ...(skillsPath ? { skillsPath } : {})
    };
}

export function readMissionDaemonSettings(controlRoot = process.cwd()): MissionDaemonSettings | undefined {
    const settingsPath = getMissionDaemonSettingsPath(controlRoot);
    try {
        const content = fs.readFileSync(settingsPath, 'utf8').trim();
        if (!content) {
            return undefined;
        }

        return JSON.parse(content) as MissionDaemonSettings;
    } catch {
        return undefined;
    }
}

export async function ensureMissionDaemonSettings(controlRoot = process.cwd()): Promise<MissionDaemonSettings> {
    const currentSettings = readMissionDaemonSettings(controlRoot);
    if (currentSettings) {
        return currentSettings;
    }

    return writeMissionDaemonSettings(getDefaultMissionDaemonSettings(), controlRoot);
}

export async function writeMissionDaemonSettings(
    settings: MissionDaemonSettings,
    controlRoot = process.cwd()
): Promise<MissionDaemonSettings> {
    const settingsPath = getMissionDaemonSettingsPath(controlRoot);
    const nextSettings = getDefaultMissionDaemonSettingsWithOverrides(settings);
    await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
    await fsp.writeFile(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, 'utf8');
    return nextSettings;
}

function resolveMissionControlRoot(controlRoot: string): string {
    const normalizedRoot = controlRoot.trim();
    const resolvedRoot = resolveGitWorkspaceRoot(normalizedRoot);
    return resolvedRoot ?? path.resolve(normalizedRoot);
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
