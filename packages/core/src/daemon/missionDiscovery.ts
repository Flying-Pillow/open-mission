import * as path from 'node:path';
import { resolveGitWorkspaceRoot } from '../lib/workspacePaths.js';

export type SurfaceDiscovery = {
    surfacePath: string;
    primaryControlRoot: string;
    controlRoots: string[];
};

export async function discoverSurface(surfacePath: string): Promise<SurfaceDiscovery> {
    const normalizedSurfacePath = path.resolve(surfacePath);
    const primaryControlRoot =
        resolveControlRootFromMissionPath(normalizedSurfacePath)
        ?? resolveGitWorkspaceRoot(normalizedSurfacePath)
        ?? normalizedSurfacePath;
    return {
        surfacePath: normalizedSurfacePath,
        primaryControlRoot,
        controlRoots: [primaryControlRoot]
    };
}

function resolveControlRootFromMissionPath(surfacePath: string): string | undefined {
    const parts = path.resolve(surfacePath).split(path.sep).filter(Boolean);
    const missionsIndex = parts.lastIndexOf('.missions');
    if (missionsIndex < 0) {
        return undefined;
    }
    if (parts[missionsIndex + 1] !== 'active') {
        return undefined;
    }
    if (!parts[missionsIndex + 2]) {
        return undefined;
    }
    const prefix = parts.slice(0, missionsIndex);
    return path.resolve(path.sep, ...prefix);
}