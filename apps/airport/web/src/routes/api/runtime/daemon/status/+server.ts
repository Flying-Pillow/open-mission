import { json, type RequestHandler } from "@sveltejs/kit";
import { readCachedDaemonSystemStatus } from "$lib/server/daemon/health.server";

export const GET: RequestHandler = async ({ locals }) => {
    const systemState = await readCachedDaemonSystemStatus({
        locals,
        timeoutMs: 1_000,
    });

    return json({
        systemState: systemState ?? null,
    });
};