import { getMissionGitHubCliBinary, listRegisteredRepositories, registerMissionRepo } from '../../lib/config.js';
import { Repository } from '../Repository/Repository.js';
import {
	createRepositoryPlatformAdapter,
	type RepositoryPlatformAdapter
} from '../Repository/PlatformAdapter.js';
import {
	type GitHubRepositoryClonePayload,
	type GitHubRepositoryFindPayload,
	gitHubRepositoryClonePayloadSchema,
	gitHubRepositoryFindPayloadSchema
} from '../../schemas/GitHubRepository.js';

export class GitHubRepository {
	public static async find(
		input: GitHubRepositoryFindPayload = {},
		context?: { authToken?: string; surfacePath?: string }
	) {
		gitHubRepositoryFindPayloadSchema.parse(input);
		const adapter = this.createPlatformAdapter(context);
		return await adapter.listVisibleRepositories();
	}

	public static async clone(
		input: GitHubRepositoryClonePayload,
		context?: { authToken?: string; surfacePath?: string }
	) {
		const payload = gitHubRepositoryClonePayloadSchema.parse(input);
		const adapter = this.createPlatformAdapter(context);
		const repositoryRootPath = await adapter.cloneRepository({
			repository: payload.githubRepository,
			destinationPath: payload.destinationPath
		});

		await registerMissionRepo(repositoryRootPath);
		const registeredRepository = (await listRegisteredRepositories()).find(
			(candidate) => candidate.repositoryRootPath === repositoryRootPath
		);
		if (!registeredRepository) {
			throw new Error(`Mission could not register cloned repository '${payload.githubRepository}'.`);
		}

		const repository = Repository.open(registeredRepository.repositoryRootPath, {
			label: registeredRepository.label,
			description: registeredRepository.description,
			...(registeredRepository.githubRepository
				? { githubRepository: registeredRepository.githubRepository }
				: {})
		});
		return await repository.read({
			repositoryId: repository.repositoryId,
			repositoryRootPath: repository.repositoryRootPath
		});
	}

	private static createPlatformAdapter(context?: {
		authToken?: string;
		surfacePath?: string;
	}): RepositoryPlatformAdapter {
		const ghBinary = getMissionGitHubCliBinary();
		return createRepositoryPlatformAdapter({
			platform: 'github',
			workspaceRoot: context?.surfacePath?.trim() || process.cwd(),
			...(context?.authToken ? { authToken: context.authToken } : {}),
			...(ghBinary ? { ghBinary } : {})
		});
	}
}