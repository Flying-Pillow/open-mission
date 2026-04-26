import { z } from 'zod/v4';

const DEFAULT_MISSION_WORKSPACE_ROOT = 'missions';

const airportPaneIdSchema = z.enum(['tower', 'briefingRoom', 'runway']);
const paneTargetKindSchema = z.enum([
    'empty',
    'repository',
    'mission',
    'task',
    'artifact',
    'agentSession'
]);
const paneModeSchema = z.enum(['view', 'control']);

const paneBindingSchema = z.object({
    targetKind: paneTargetKindSchema,
    targetId: z.string().trim().min(1).optional(),
    mode: paneModeSchema.optional()
}).strict();

const repositoryAirportIntentSchema = z.object({
    panes: z.object({
        briefingRoom: paneBindingSchema.optional(),
        runway: paneBindingSchema.optional()
    }).strict().optional(),
    focus: z.object({
        intentPaneId: airportPaneIdSchema.optional()
    }).strict().optional()
}).strict();

export const RepositorySettingsSchema = z.object({
    missionWorkspaceRoot: z.string().trim().min(1),
    trackingProvider: z.literal('github'),
    instructionsPath: z.string().trim().min(1),
    skillsPath: z.string().trim().min(1),
    agentRunner: z.enum(['copilot-cli', 'pi']),
    defaultAgentMode: z.enum(['interactive', 'autonomous']).optional(),
    defaultModel: z.string().trim().min(1).optional(),
    towerTheme: z.string().trim().min(1).optional(),
    airport: repositoryAirportIntentSchema.optional()
}).strict();

export type RepositorySettings = z.infer<typeof RepositorySettingsSchema>;

const DEFAULT_REPOSITORY_SETTINGS: RepositorySettings = {
    missionWorkspaceRoot: DEFAULT_MISSION_WORKSPACE_ROOT,
    trackingProvider: 'github',
    instructionsPath: '.agents',
    skillsPath: '.agents/skills',
    agentRunner: 'copilot-cli'
};

export function createDefaultRepositorySettings(): RepositorySettings {
    return structuredClone(DEFAULT_REPOSITORY_SETTINGS);
}