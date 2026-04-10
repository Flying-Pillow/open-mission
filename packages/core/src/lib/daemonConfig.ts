import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { getMissionDirectoryPath } from './repoConfig.js';
import { readMissionUserConfig } from './userConfig.js';
import { resolveGitWorkspaceRoot } from './workspacePaths.js';
import {
    createDefaultWorkflowSettings,
    type WorkflowGlobalSettings
} from '../workflow/engine/index.js';
import {
    COPILOT_CLI_AGENT_RUNTIME_ID,
    COPILOT_SDK_AGENT_RUNTIME_ID,
    isSupportedAgentRuntime
} from './agentRuntimes.js';
import {
    normalizePersistedAirportIntent,
    type PersistedAirportIntent
} from '../../../airport/build/index.js';
import { normalizeWorkflowSettings } from '../settings/validation.js';

export const MISSION_DAEMON_SETTINGS_FILE = 'settings.json';

export const MISSION_AGENT_RUNTIMES = [COPILOT_CLI_AGENT_RUNTIME_ID, COPILOT_SDK_AGENT_RUNTIME_ID] as const;

export type MissionAgentRuntime = (typeof MISSION_AGENT_RUNTIMES)[number];
export type MissionDefaultAgentMode = 'interactive' | 'autonomous';

export type MissionDaemonSettings = {
    agentRuntime?: MissionAgentRuntime;
    defaultAgentMode?: MissionDefaultAgentMode;
    defaultModel?: string;
    towerTheme?: string;
    missionWorkspaceRoot?: string;
    trackingProvider?: 'github';
    instructionsPath?: string;
    skillsPath?: string;
    workflow?: WorkflowGlobalSettings;
    airport?: PersistedAirportIntent;
};

type MissionDaemonPathOptions = {
    resolveWorkspaceRoot?: boolean;
};

export function getMissionDaemonRoot(
    controlRoot = process.cwd(),
    options: MissionDaemonPathOptions = {}
): string {
    const resolvedControlRoot = options.resolveWorkspaceRoot === false
        ? path.resolve(controlRoot.trim())
        : resolveMissionControlRoot(controlRoot);
    return getMissionDirectoryPath(resolvedControlRoot);
}

export function getMissionDaemonSettingsPath(
    controlRoot = process.cwd(),
    options: MissionDaemonPathOptions = {}
): string {
    return path.join(getMissionDaemonRoot(controlRoot, options), MISSION_DAEMON_SETTINGS_FILE);
}

export function getDefaultMissionDaemonSettings(): MissionDaemonSettings {
    return getDefaultMissionDaemonSettingsWithOverrides();
}

export function getDefaultMissionDaemonSettingsWithOverrides(
    overrides: MissionDaemonSettings = {}
): MissionDaemonSettings {
    const userConfig = readMissionUserConfig();
    const agentRuntime = normalizeOptionalAgentRuntime(overrides.agentRuntime) ?? COPILOT_CLI_AGENT_RUNTIME_ID;
    const defaultAgentMode = normalizeOptionalAgentMode(overrides.defaultAgentMode);
    const defaultModel = normalizeOptionalString(overrides.defaultModel);
    const towerTheme = normalizeOptionalString(overrides.towerTheme);
    const missionWorkspaceRoot = normalizeOptionalString(overrides.missionWorkspaceRoot)
        ?? normalizeOptionalString(userConfig?.missionWorkspaceRoot);
    const instructionsPath = normalizeOptionalString(overrides.instructionsPath);
    const skillsPath = normalizeOptionalString(overrides.skillsPath);
    const airport = normalizePersistedAirportIntent(overrides.airport);
    return {
        missionWorkspaceRoot: 'missions',
        trackingProvider: 'github',
        instructionsPath: '.agents',
        skillsPath: '.agents/skills',
        workflow: normalizeWorkflowSettings(overrides.workflow ?? createDefaultWorkflowSettings()),
		agentRuntime,
        ...(defaultAgentMode ? { defaultAgentMode } : {}),
        ...(defaultModel ? { defaultModel } : {}),
        ...(towerTheme ? { towerTheme } : {}),
        ...(missionWorkspaceRoot ? { missionWorkspaceRoot } : {}),
        ...(overrides.trackingProvider ? { trackingProvider: overrides.trackingProvider } : {}),
        ...(instructionsPath ? { instructionsPath } : {}),
        ...(skillsPath ? { skillsPath } : {}),
        ...(airport ? { airport } : {})
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
    controlRoot = process.cwd(),
    options: MissionDaemonPathOptions = {}
): Promise<MissionDaemonSettings> {
    const settingsPath = getMissionDaemonSettingsPath(controlRoot, options);
    const nextSettings = getDefaultMissionDaemonSettingsWithOverrides(settings);
    const temporarySettingsPath = `${settingsPath}.${process.pid.toString(36)}.${Date.now().toString(36)}.tmp`;
    await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
    await fsp.writeFile(temporarySettingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, 'utf8');
    await fsp.rename(temporarySettingsPath, settingsPath);
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

function normalizeOptionalAgentRuntime(value: MissionAgentRuntime | undefined): MissionAgentRuntime | undefined {
	return isSupportedAgentRuntime(value) ? value : undefined;
}

function normalizeOptionalAgentMode(
    value: MissionDefaultAgentMode | undefined
): MissionDefaultAgentMode | undefined {
    return value === 'interactive' || value === 'autonomous' ? value : undefined;
}
