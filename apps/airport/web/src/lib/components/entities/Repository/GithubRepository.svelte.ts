import { z } from 'zod/v4';
import {
	githubVisibleRepositorySchema,
	type GitHubVisibleRepository
} from '@flying-pillow/mission-core/schemas';
import {
	repositorySnapshotSchema,
	type RepositorySnapshot
} from '@flying-pillow/mission-core/schemas';
import { qry } from '../../../../routes/api/entities/remote/query.remote';
import { cmd } from '../../../../routes/api/entities/remote/command.remote';

export class GithubRepository {
	public static async find(): Promise<GitHubVisibleRepository[]> {
		return z.array(githubVisibleRepositorySchema).parse(
			await qry({
				entity: 'GitHubRepository',
				method: 'find',
				payload: {}
			}).run()
		);
	}

	public static async clone(input: {
		githubRepository: string;
		destinationPath: string;
	}): Promise<RepositorySnapshot> {
		return repositorySnapshotSchema.parse(
			await cmd({
				entity: 'GitHubRepository',
				method: 'clone',
				payload: input
			})
		);
	}
}