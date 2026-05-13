import type { LayoutServerLoad } from "./$types";
import { DaemonGateway } from "$lib/server/daemon/daemon-gateway";

export const load: LayoutServerLoad = async ({ locals }) => {
    return await new DaemonGateway(locals).getSystemState();
};