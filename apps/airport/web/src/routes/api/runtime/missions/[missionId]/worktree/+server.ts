import { error as kitError, json } from "@sveltejs/kit";
import { missionRuntimeRouteParamsSchema } from "@flying-pillow/mission-core";
import { z } from "zod";
import { readMissionFileTree } from "$lib/server/filesystem/mission-file-tree.server";
import type { RequestHandler } from "./$types";

const missionWorktreeQuerySchema = z.object({
	repositoryRootPath: z.string().trim().min(1).optional(),
});

export const GET: RequestHandler = async ({ params, url }) => {
	const { missionId } = missionRuntimeRouteParamsSchema.parse(params);
	const { repositoryRootPath } = missionWorktreeQuerySchema.parse({
		repositoryRootPath: url.searchParams.get("repositoryRootPath"),
	});

	try {
		return json(
			await readMissionFileTree({
				missionId,
				repositoryRootPath,
			}),
			{
				headers: {
					"cache-control": "no-store",
				},
			},
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw kitError(404, message);
	}
};