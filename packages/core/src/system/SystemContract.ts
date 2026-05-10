import { z } from 'zod/v4';

export const githubSystemStateSchema = z.object({
    cliAvailable: z.boolean(),
    authenticated: z.boolean(),
    user: z.string().trim().min(1).optional(),
    email: z.string().trim().min(1).optional(),
    avatarUrl: z.string().trim().min(1).optional(),
    detail: z.string().trim().min(1).optional()
}).strict();

export const missionSystemConfigSchema = z.object({
    repositoriesRoot: z.string().trim().min(1)
}).strict();

export const systemStateSchema = z.object({
    github: githubSystemStateSchema,
    config: missionSystemConfigSchema
}).strict();

export type GithubSystemState = z.infer<typeof githubSystemStateSchema>;
export type MissionSystemConfig = z.infer<typeof missionSystemConfigSchema>;
export type SystemState = z.infer<typeof systemStateSchema>;