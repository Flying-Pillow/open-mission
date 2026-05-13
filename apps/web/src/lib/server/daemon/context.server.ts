// /apps/web/src/lib/server/daemon/context.server.ts: Resolves request-scoped auth and surface path for the Open Mission web daemon gateway.
export function resolveRequestAuthToken(locals?: App.Locals): string | undefined {
    const authToken = locals?.githubAuthToken?.trim();
    return authToken && authToken.length > 0 ? authToken : undefined;
}

export function resolveSurfacePath(): string {
    const configuredSurfacePath = process.env['OPEN_MISSION_SURFACE_PATH']?.trim();
    if (configuredSurfacePath && configuredSurfacePath.length > 0) {
        return configuredSurfacePath;
    }

    return process.cwd();
}