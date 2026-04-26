import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import {
    COPILOT_CLI_AGENT_RUNNER_ID,
    PI_AGENT_RUNNER_ID
} from '../agent/runtimes/AgentRuntimeIds.js';
import { getMissionDirectoryPath } from '../entities/Repository/RepositoryPaths.js';
import { resolveGitWorkspaceRoot } from './workspacePaths.js';
import {
    createDefaultRepositorySettings,
    RepositorySettingsSchema,
    type RepositorySettings
} from '../entities/Repository/RepositorySettings.js';
import type { RepositoryPlatformKind } from '../entities/Repository/PlatformAdapter.js';

export const MISSION_AGENT_RUNNERS = [COPILOT_CLI_AGENT_RUNNER_ID, PI_AGENT_RUNNER_ID] as const;

export type MissionAgentRunner = (typeof MISSION_AGENT_RUNNERS)[number];
export type MissionDefaultAgentMode = 'interactive' | 'autonomous';

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

export function getWorkflowSettingsDocumentPath(
    controlRoot = process.cwd(),
    options: MissionDaemonPathOptions = {}
): string {
    return path.join(getMissionDaemonRoot(controlRoot, options), 'workflow', 'workflow.json');
}

export function getRepositorySettingsPath(
    controlRoot = process.cwd(),
    options: MissionDaemonPathOptions = {}
): string {
    return path.join(getMissionDaemonRoot(controlRoot, options), 'settings.json');
}

export function readRepositoryPlatform(
    controlRoot = process.cwd(),
    options: MissionDaemonPathOptions = {}
): RepositoryPlatformKind | undefined {
    const settingsPath = getRepositorySettingsPath(controlRoot, options);
    try {
        const content = fs.readFileSync(settingsPath, 'utf8').trim();
        if (!content) {
            return undefined;
        }
        const source = JSON.parse(content) as unknown;
        if (!source || typeof source !== 'object' || Array.isArray(source)) {
            return undefined;
        }
        const platform = (source as { platform?: unknown }).platform;
        return platform === 'github' ? platform : undefined;
    } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}

export function resolveRepositorySettingsDocument(input: unknown = {}): RepositorySettings {
    return RepositorySettingsSchema.parse(input);
}

export function readRepositorySettingsDocument(
    controlRoot = process.cwd(),
    options: MissionDaemonPathOptions = {}
): RepositorySettings | undefined {
    const settingsPath = getRepositorySettingsPath(controlRoot, options);
    try {
        const content = fs.readFileSync(settingsPath, 'utf8').trim();
        if (!content) {
            return undefined;
        }
        return resolveRepositorySettingsDocument(JSON.parse(content) as unknown);
    } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}

export async function ensureRepositorySettingsDocument(controlRoot = process.cwd()): Promise<RepositorySettings> {
    const currentDocument = readRepositorySettingsDocument(controlRoot);
    if (currentDocument) {
        return currentDocument;
    }

    return writeRepositorySettingsDocument(createDefaultRepositorySettings(), controlRoot);
}

export async function writeRepositorySettingsDocument(
    document: RepositorySettings,
    controlRoot = process.cwd(),
    options: MissionDaemonPathOptions = {}
): Promise<RepositorySettings> {
    const settingsPath = getRepositorySettingsPath(controlRoot, options);
    const nextDocument = resolveRepositorySettingsDocument(document);
    const temporarySettingsPath = `${settingsPath}.${process.pid.toString(36)}.${Date.now().toString(36)}.tmp`;
    await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
    await fsp.writeFile(temporarySettingsPath, `${JSON.stringify(nextDocument, null, 2)}\n`, 'utf8');
    await fsp.rename(temporarySettingsPath, settingsPath);
    return nextDocument;
}

function resolveMissionControlRoot(controlRoot: string): string {
    const normalizedRoot = controlRoot.trim();
    const resolvedRoot = resolveGitWorkspaceRoot(normalizedRoot);
    return resolvedRoot ?? path.resolve(normalizedRoot);
}
