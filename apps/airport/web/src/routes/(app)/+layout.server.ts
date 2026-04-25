import type { LayoutServerLoad } from "./$types";
import { AirportWebGateway } from "$lib/server/gateway/AirportWebGateway.server";

export const load: LayoutServerLoad = async ({ locals }) => {
    const gateway = new AirportWebGateway(locals);

    return {
        appContext: locals.appContext,
        airportRouteData: {
            loginHref: '/login?redirectTo=/airport',
            airportHome: await gateway.airport.getHomeSnapshot()
        },
    };
};