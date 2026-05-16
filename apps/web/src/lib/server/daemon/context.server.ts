// /apps/web/src/lib/server/daemon/context.server.ts: Resolves request-scoped auth and surface path for the Open Mission web daemon gateway.
export function resolveRequestAuthToken(locals?: App.Locals): string | undefined {
    const authToken = locals?.githubAuthToken?.trim();
    return authToken && authToken.length > 0 ? authToken : undefined;
}

export function resolveSurfacePath(): string {
    const repositoryRootPath = process.env['OPEN_MISSION_REPOSITORY_ROOT']?.trim();
    if (repositoryRootPath && repositoryRootPath.length > 0) {
        return repositoryRootPath;
    }

    return process.cwd();
}