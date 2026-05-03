import { Repository, type RepositoryScaffolding } from '../../entities/Repository/Repository.js';
import type { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import type { MissionDescriptor } from '../../types.js';

export class RepositoryPreparationOperation {
    public constructor(private readonly adapter: FilesystemAdapter) { }

    public async execute(input: { descriptor: MissionDescriptor }): Promise<RepositoryScaffolding | undefined> {
        if (typeof this.adapter.getMissionWorkspacePath !== 'function') {
            return undefined;
        }
        const missionWorktreeRoot = this.adapter.getMissionWorkspacePath(input.descriptor.missionDir);
        if (Repository.readSettingsDocument(missionWorktreeRoot)) {
            return undefined;
        }
        return Repository.initializeScaffolding(missionWorktreeRoot);
    }
}
