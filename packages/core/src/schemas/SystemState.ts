import { z } from 'zod/v4';

export const githubSystemStateSchema = z.object({
    cliAvailable: z.boolean(),
    authenticated: z.boolean(),
    user: z.string().trim().min(1).optional(),
    email: z.string().trim().min(1).optional(),
    avatarUrl: z.string().trim().min(1).optional(),
    detail: z.string().trim().min(1).optional()
}).strict();

export const systemStateSchema = z.object({
    github: githubSystemStateSchema
}).strict();

export type GithubSystemState = z.infer<typeof githubSystemStateSchema>;
export type SystemState = z.infer<typeof systemStateSchema>;