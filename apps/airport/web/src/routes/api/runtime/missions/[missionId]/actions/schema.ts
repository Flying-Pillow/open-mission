import { isMissionStageId } from "@flying-pillow/mission-core/types.js";
import { z } from "zod";

export const missionActionQuerySchema = z.object({
    repositoryId: z.string().trim().min(1).optional(),
    repositoryRootPath: z.string().trim().min(1).optional(),
    stageId: z
        .string()
        .trim()
        .min(1)
        .refine(isMissionStageId, { error: "Invalid mission stage id." })
        .optional(),
    taskId: z.string().trim().min(1).optional(),
    artifactPath: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1).optional(),
});

export const missionActionExecuteSchema = z.object({
    actionId: z.string().trim().min(1),
    steps: z.array(
        z.union([
            z.object({
                kind: z.literal("selection"),
                stepId: z.string().trim().min(1),
                optionIds: z.array(z.string().trim().min(1)),
            }),
            z.object({
                kind: z.literal("text"),
                stepId: z.string().trim().min(1),
                value: z.string(),
            }),
        ]),
    ).optional(),
    terminalSessionName: z.string().trim().min(1).optional(),
});