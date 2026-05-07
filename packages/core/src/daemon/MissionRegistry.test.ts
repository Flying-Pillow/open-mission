import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MissionDossierFilesystem } from '../entities/Mission/MissionDossierFilesystem.js';
import type { MissionDescriptor } from '../entities/Mission/MissionSchema.js';
import { Repository } from '../entities/Repository/Repository.js';
import { MissionRegistry } from './MissionRegistry.js';

const temporaryWorkspaceRoots = new Set<string>();

afterEach(async () => {
	await Promise.all(
		[...temporaryWorkspaceRoots].map(async (workspaceRoot) => {
			temporaryWorkspaceRoots.delete(workspaceRoot);
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		})
	);
});

describe('MissionRegistry', () => {
	it('continues startup hydration when a persisted mission fails strict loading', async () => {
		const workspaceRoot = await createTempWorkspace();
		const adapter = new MissionDossierFilesystem(workspaceRoot);
		await adapter.writeMissionDescriptor(adapter.getTrackedMissionDir('mission-good'), createDescriptor('mission-good'));
		await adapter.writeMissionDescriptor(adapter.getTrackedMissionDir('mission-bad'), createDescriptor('mission-bad'));
		const loadMission = vi.fn(async (input: { missionId: string }) => {
			if (input.missionId === 'mission-bad') {
				throw new Error('strict persisted mission failure');
			}
			return undefined;
		});
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		try {
			await expect(new MissionRegistry({ loadMission }).hydrateRepositoryMissions({
				surfacePath: workspaceRoot
			})).resolves.toBeUndefined();

			expect(loadMission).toHaveBeenCalledTimes(2);
			expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("Mission daemon could not hydrate mission 'mission-bad'"));
		} finally {
			consoleError.mockRestore();
		}
	});

	it('hydrates discovered Mission worktrees from the worktree Repository root', async () => {
		const repositoryRoot = await createTempWorkspace();
		const repositoryAdapter = new MissionDossierFilesystem(repositoryRoot);
		const missionWorktreeRoot = repositoryAdapter.getMissionWorktreePath('1-prepare-repo-for-mission');
		const missionAdapter = new MissionDossierFilesystem(missionWorktreeRoot);
		const missionDir = missionAdapter.getTrackedMissionDir('1-prepare-repo-for-mission', missionWorktreeRoot);
		await fs.mkdir(path.join(missionWorktreeRoot, '.mission'), { recursive: true });
		await fs.writeFile(
			path.join(missionWorktreeRoot, '.mission', 'settings.json'),
			`${JSON.stringify({
				missionsRoot: path.join(repositoryRoot, 'mission-worktrees'),
				trackingProvider: 'github',
				instructionsPath: '.agents',
				skillsPath: '.agents/skills',
				agentAdapter: 'copilot-cli'
			}, null, 2)}\n`,
			'utf8'
		);
		await missionAdapter.writeMissionDescriptor(missionDir, createDescriptor('1-prepare-repo-for-mission'));
		const loadMission = vi.fn(async () => undefined);

		await expect(new MissionRegistry({ loadMission }).hydrateRepositoryMissions({
			surfacePath: repositoryRoot
		})).resolves.toBeUndefined();

		expect(loadMission).toHaveBeenCalledWith(
			{
				missionId: '1-prepare-repo-for-mission',
				repositoryRootPath: missionWorktreeRoot
			},
			{ surfacePath: missionWorktreeRoot },
			undefined
		);
	});

	it('skips invalid discovered Repositories during daemon hydration', async () => {
		const workspaceRoot = await createTempWorkspace();
		const invalidRepositoryRoot = await createTempWorkspace();
		const invalidRepositoryAdapter = new MissionDossierFilesystem(invalidRepositoryRoot);
		await invalidRepositoryAdapter.writeMissionDescriptor(
			invalidRepositoryAdapter.getTrackedMissionDir('mission-invalid-repository'),
			createDescriptor('mission-invalid-repository')
		);
		const invalidRepository = Repository.create({
			repositoryRootPath: invalidRepositoryRoot,
			platformRepositoryRef: 'Flying-Pillow/invalid-repository'
		}).toData();
		const findRepositories = vi.spyOn(Repository, 'find').mockResolvedValue([
			{
				...invalidRepository,
				operationalMode: 'invalid',
				invalidState: {
					code: 'invalid-settings-document',
					path: path.join(invalidRepositoryRoot, '.mission', 'settings.json'),
					message: 'Invalid input'
				},
				isInitialized: false
			}
		]);
		const loadMission = vi.fn(async () => undefined);
		const logger = { info: vi.fn(), warn: vi.fn() };

		try {
			await expect(new MissionRegistry({ loadMission, logger }).hydrateDaemonMissions({
				surfacePath: workspaceRoot
			})).resolves.toBeUndefined();

			expect(loadMission).not.toHaveBeenCalled();
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("Mission daemon skipped invalid Repository 'repository:github/Flying-Pillow/invalid-repository'"),
				expect.objectContaining({ repositoryRootPath: invalidRepositoryRoot })
			);
		} finally {
			findRepositories.mockRestore();
		}
	});
});

async function createTempWorkspace(): Promise<string> {
	const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-service-'));
	temporaryWorkspaceRoots.add(workspaceRoot);
	await fs.mkdir(path.join(workspaceRoot, '.mission'), { recursive: true });
	await fs.writeFile(
		path.join(workspaceRoot, '.mission', 'settings.json'),
		`${JSON.stringify({
			missionsRoot: path.join(workspaceRoot, 'mission-worktrees'),
			trackingProvider: 'github',
			instructionsPath: '.agents',
			skillsPath: '.agents/skills',
			agentAdapter: 'copilot-cli'
		}, null, 2)}\n`,
		'utf8'
	);
	return workspaceRoot;
}

function createDescriptor(missionId: string): MissionDescriptor {
	return {
		missionId,
		missionDir: '',
		brief: {
			title: missionId,
			body: `${missionId} body`,
			type: 'task'
		},
		branchRef: 'HEAD',
		createdAt: '2026-04-27T13:00:00.000Z'
	};
}