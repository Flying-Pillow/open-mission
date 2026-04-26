import {
    findRegisteredRepositoryById,
    listRegisteredRepositories,
    registerMissionRepo
} from '../../lib/config.js';
import { Repository } from './Repository.js';

export class Repositories {
    public static async list(): Promise<Repository[]> {
        return (await listRegisteredRepositories()).map((candidate) =>
            Repository.open(candidate.repositoryRootPath, {
                label: candidate.label,
                description: candidate.description,
                ...(candidate.githubRepository ? { githubRepository: candidate.githubRepository } : {})
            })
        );
    }

    public static async find(repositoryId: string): Promise<Repository | undefined> {
        const candidate = await findRegisteredRepositoryById(repositoryId);
        return candidate
            ? Repository.open(candidate.repositoryRootPath, {
                label: candidate.label,
                description: candidate.description,
                ...(candidate.githubRepository ? { githubRepository: candidate.githubRepository } : {})
            })
            : undefined;
    }

    public static async register(repositoryPath: string): Promise<Repository> {
        const trimmedRepositoryPath = repositoryPath.trim();
        if (!trimmedRepositoryPath) {
            throw new Error('Repository path is required.');
        }

        await registerMissionRepo(trimmedRepositoryPath);
        const repositories = await Repositories.list();
        const registeredRepository = repositories.find(
            (repository) => repository.repositoryRootPath === Repository.open(trimmedRepositoryPath).repositoryRootPath
        );

        if (!registeredRepository) {
            throw new Error(`Mission could not register repository '${repositoryPath}'.`);
        }

        return registeredRepository;
    }
}