import { RepositoryDataSchema } from '@flying-pillow/open-mission-core/entities/Repository/RepositorySchema';
import { EntityProxy } from '$lib/server/daemon/entity-proxy';

export async function resolveRepositoryRootPath(input: {
    repositoryId?: string;
    repositoryRootPath?: string;
    locals?: App.Locals;
}): Promise<string | undefined> {
    const repositoryRootPath = input.repositoryRootPath?.trim();
    if (repositoryRootPath) {
        return repositoryRootPath;
    }

    const repositoryId = input.repositoryId?.trim();
    if (!repositoryId) {
        return undefined;
    }

    try {
        const repository = RepositoryDataSchema.parse(await new EntityProxy(input.locals).executeEntityQuery({
            entity: 'Repository',
            method: 'read',
            payload: { id: repositoryId }
        }));
        return repository.repositoryRootPath;
    } catch (error) {
        if (error instanceof Error && /not found/i.test(error.message)) {
            throw new Error(`Repository '${repositoryId}' could not be resolved in Open Mission.`);
        }
        throw error;
    }
}
