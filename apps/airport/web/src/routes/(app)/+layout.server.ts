import type { LayoutServerLoad } from "./$types";
import { AirportWebGateway } from "$lib/server/gateway/AirportWebGateway.server";

export const load: LayoutServerLoad = async ({ locals }) => {
    return await new AirportWebGateway(locals).getSystemState();
};