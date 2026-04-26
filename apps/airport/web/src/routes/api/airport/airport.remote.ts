import { command, getRequestEvent, query } from '$app/server';
import { z } from 'zod/v4';
import {
    airportHomeSnapshotSchema
} from '@flying-pillow/mission-core/schemas';

const airportRouteQuerySchema = z.object({});

const airportRouteDataSchema = z.object({
    loginHref: z.string().trim().min(1),
    airportHome: airportHomeSnapshotSchema
});

const airportLogoutResultSchema = z.object({
    redirectTo: z.string().trim().min(1)
});

export type AirportRouteData = z.infer<typeof airportRouteDataSchema>;

export const getAirportRouteData = query(airportRouteQuerySchema, async () => {
    const event = getRequestEvent();
    const { DaemonGateway } = await import('$lib/server/daemon/daemon-gateway');
    const gateway = new DaemonGateway(event.locals);

    return airportRouteDataSchema.parse({
        loginHref: '/login?redirectTo=/airport',
        airportHome: await gateway.getAirportHomeSnapshot()
    });
});

export const logoutAirportSession = command(z.object({}), async () => {
    const event = getRequestEvent();
    const { clearGithubAuthSession } = await import('$lib/server/github-auth.server');
    await clearGithubAuthSession(event.cookies);
    event.locals.githubAuthToken = undefined;

    return airportLogoutResultSchema.parse({
        redirectTo: '/'
    });
});