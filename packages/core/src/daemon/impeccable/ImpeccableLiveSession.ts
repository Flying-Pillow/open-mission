import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v4';
import { MissionDossierFilesystem } from '../../entities/Mission/MissionDossierFilesystem.js';
import { Repository } from '../../entities/Repository/Repository.js';

export const ImpeccableLiveSessionSchema = z.object({
    origin: z.string().trim().url()
}).strict();

export type ImpeccableLiveSessionType = z.infer<typeof ImpeccableLiveSessionSchema>;

export const ImpeccableLiveResolveParamsSchema = z.object({
    repositoryId: z.string().trim().min(1).optional(),
    missionId: z.string().trim().min(1).optional()
}).strict().refine(
    (input) => Boolean(input.repositoryId) !== Boolean(input.missionId),
    'Provide exactly one of repositoryId or missionId.'
);

export type ImpeccableLiveResolveParamsType = z.infer<typeof ImpeccableLiveResolveParamsSchema>;

export const PersistedImpeccableLiveServerInfoSchema = z.object({
    pid: z.number().int(),
    port: z.number().int().positive(),
    token: z.string().trim().min(1),
    origin: z.string().trim().url()
}).strict();

export type PersistedImpeccableLiveServerInfoType = z.infer<typeof PersistedImpeccableLiveServerInfoSchema>;

type ImpeccableLiveSurfacePathResolverDependencies = {
    resolveRepositoryRootPath(input: { repositoryId: string }): Promise<string>;
    resolveMissionSurfacePath(input: { missionId: string }): Promise<string>;
};

const defaultSurfacePathResolverDependencies: ImpeccableLiveSurfacePathResolverDependencies = {
    resolveRepositoryRootPath: async ({ repositoryId }) => {
        const repository = await Repository.resolve({ id: repositoryId });
        return repository.repositoryRootPath;
    },
    resolveMissionSurfacePath: async ({ missionId }) => {
        for (const repository of await Repository.find({})) {
            const resolvedMission = await new MissionDossierFilesystem(repository.repositoryRootPath).resolveKnownMission({ missionId });
            if (resolvedMission) {
                return resolvedMission.missionDir;
            }
        }

        throw new Error(`Mission '${missionId}' could not be resolved for Impeccable live.`);
    }
};

export function getLiveServerInfoCandidates(surfacePath: string): string[] {
    return [
        path.join(surfacePath, '.impeccable', 'live', 'server.json'),
        path.join(surfacePath, '.impeccable-live.json')
    ];
}

export async function readPersistedImpeccableLiveServerInfo(surfacePath: string): Promise<PersistedImpeccableLiveServerInfoType | undefined> {
    for (const filePath of getLiveServerInfoCandidates(surfacePath)) {
        try {
            return PersistedImpeccableLiveServerInfoSchema.parse(JSON.parse(await readFile(filePath, 'utf8')));
        } catch {
            // Try the next candidate path before surfacing a not-found error.
        }
    }

    return undefined;
}

export async function resolveImpeccableLiveSurfacePath(input: {
    params: unknown;
}, dependencies: ImpeccableLiveSurfacePathResolverDependencies = defaultSurfacePathResolverDependencies): Promise<string> {
    const selector = ImpeccableLiveResolveParamsSchema.parse(input.params);
    if (selector.repositoryId) {
        return dependencies.resolveRepositoryRootPath({ repositoryId: selector.repositoryId });
    }

    return dependencies.resolveMissionSurfacePath({ missionId: selector.missionId as string });
}

export async function resolveImpeccableLiveSession(input: {
    params: unknown;
}, dependencies: ImpeccableLiveSurfacePathResolverDependencies = defaultSurfacePathResolverDependencies): Promise<ImpeccableLiveSessionType> {
    const surfacePath = await resolveImpeccableLiveSurfacePath(input, dependencies);
    const serverInfo = await readPersistedImpeccableLiveServerInfo(surfacePath);
    if (serverInfo) {
        return ImpeccableLiveSessionSchema.parse({
            origin: serverInfo.origin
        });
    }

    throw new Error(`No running Impeccable live server found for '${surfacePath}'.`);
}