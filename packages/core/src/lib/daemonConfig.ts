import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { getMissionDirectoryPath } from './repoConfig.js';
import { readMissionConfig } from './config.js';
import { resolveGitWorkspaceRoot } from './workspacePaths.js';
import {
    COPILOT_CLI_AGENT_RUNNER_ID,
    PI_AGENT_RUNNER_ID
} from '../agent/runtimes/AgentRuntimeIds.js';
import {
    createDefaultRepositoryWorkflowSettingsDocument,
    normalizeRepositoryWorkflowSettingsDocument,
    type RepositoryWorkflowSettingsDocument as WorkflowSettingsDocument
} from '../entities/Repository/RepositorySettingsDocument.js';

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

export function resolveWorkflowSettingsDocument(input: unknown = {}): WorkflowSettingsDocument {
    const config = readMissionConfig();
    const source = isRecord(input) ? input : {};
    const runtime = isRecord(source['runtime']) ? source['runtime'] : {};
    const integration = isRecord(source['integration']) ? source['integration'] : {};
    const paths = isRecord(source['paths']) ? source['paths'] : {};
    const runtimeAgentRunner = asMissionAgentRunner(asString(runtime['agentRunner']));
    const runtimeDefaultAgentMode = normalizeOptionalAgentMode(asString(runtime['defaultAgentMode']) as MissionDefaultAgentMode | undefined);
    const runtimeDefaultModel = normalizeOptionalString(asString(runtime['defaultModel']));
    const runtimeTowerTheme = normalizeOptionalString(asString(runtime['towerTheme']));
    const configuredMissionWorkspaceRoot = normalizeOptionalString(asString(paths['missionWorkspaceRoot']))
        ?? normalizeOptionalString(config?.missionWorkspaceRoot);

    return normalizeRepositoryWorkflowSettingsDocument({
        ...source,
        runtime: {
            ...runtime,
            ...(runtimeAgentRunner
                ? { agentRunner: runtimeAgentRunner }
                : {}),
            ...(runtimeDefaultAgentMode
                ? { defaultAgentMode: runtimeDefaultAgentMode }
                : {}),
            ...(runtimeDefaultModel ? { defaultModel: runtimeDefaultModel } : {}),
            ...(runtimeTowerTheme ? { towerTheme: runtimeTowerTheme } : {})
        },
        integration: {
            ...integration,
            trackingProvider: integration['trackingProvider'] === 'github' ? 'github' : 'github'
        },
        paths: {
            ...paths,
            ...(configuredMissionWorkspaceRoot ? { missionWorkspaceRoot: configuredMissionWorkspaceRoot } : {})
        }
    },
    configuredMissionWorkspaceRoot
        ? { defaultMissionWorkspaceRoot: configuredMissionWorkspaceRoot }
        : undefined);
}

export function readWorkflowSettingsDocument(
    controlRoot = process.cwd(),
    options: MissionDaemonPathOptions = {}
): WorkflowSettingsDocument | undefined {
    const settingsPath = getWorkflowSettingsDocumentPath(controlRoot, options);
    try {
        const content = fs.readFileSync(settingsPath, 'utf8').trim();
        if (!content) {
            return undefined;
        }
        return resolveWorkflowSettingsDocument(JSON.parse(content) as unknown);
    } catch (error) {
		if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
			return undefined;
		}
		throw error;
    }
}

export async function ensureWorkflowSettingsDocument(controlRoot = process.cwd()): Promise<WorkflowSettingsDocument> {
    const currentDocument = readWorkflowSettingsDocument(controlRoot);
    if (currentDocument) {
        return currentDocument;
    }

    return writeWorkflowSettingsDocument(createDefaultRepositoryWorkflowSettingsDocument(), controlRoot);
}

export async function writeWorkflowSettingsDocument(
    document: WorkflowSettingsDocument,
    controlRoot = process.cwd(),
    options: MissionDaemonPathOptions = {}
): Promise<WorkflowSettingsDocument> {
    const settingsPath = getWorkflowSettingsDocumentPath(controlRoot, options);
    const nextDocument = resolveWorkflowSettingsDocument(document);
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

function normalizeOptionalString(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function asMissionAgentRunner(value: string | undefined): MissionAgentRunner | undefined {
    if (value === COPILOT_CLI_AGENT_RUNNER_ID || value === PI_AGENT_RUNNER_ID) {
        return value;
    }
    return undefined;
}

function normalizeOptionalAgentMode(
    value: MissionDefaultAgentMode | undefined
): MissionDefaultAgentMode | undefined {
    return value === 'interactive' || value === 'autonomous' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}
