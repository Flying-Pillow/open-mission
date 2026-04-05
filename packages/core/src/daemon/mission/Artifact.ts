import type { FrontmatterValue } from '../../lib/frontmatter.js';
import { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import {
	MISSION_ARTIFACTS,
	MISSION_TASK_STAGE_DIRECTORIES,
	type MissionArtifactKey,
	type MissionStageId,
	type MissionTaskAgent,
	type MissionTaskStatus
} from '../../types.js';
import { getMissionArtifactDefinition } from '../../workflow/manifest.js';

type ProductArtifactDefinition = {
	kind: 'product';
	key: MissionArtifactKey;
	body: string;
	attributes?: Record<string, FrontmatterValue>;
};

type TaskArtifactDefinition = {
	kind: 'task';
	stageId: MissionStageId;
	fileName: string;
	subject: string;
	instruction: string;
	dependsOn?: string[];
	agent: MissionTaskAgent;
	status?: MissionTaskStatus;
	retries?: number;
};

export class Artifact {
	public constructor(
		private readonly missionDir: string,
		private readonly definition: ProductArtifactDefinition | TaskArtifactDefinition
	) { }

	public getFileName(): string {
		return this.definition.kind === 'product'
			? MISSION_ARTIFACTS[this.definition.key]
			: this.definition.fileName;
	}

	public getRelativePath(): string {
		if (this.definition.kind === 'product') {
			const definition = getMissionArtifactDefinition(this.definition.key);
			return definition.stageId
				? `flight-deck/${MISSION_TASK_STAGE_DIRECTORIES[definition.stageId]}/${MISSION_ARTIFACTS[this.definition.key]}`
				: `flight-deck/${MISSION_ARTIFACTS[this.definition.key]}`;
		}

		return `flight-deck/${MISSION_TASK_STAGE_DIRECTORIES[this.definition.stageId]}/tasks/${this.definition.fileName}`;
	}

	public async exists(adapter: FilesystemAdapter): Promise<boolean> {
		return this.definition.kind === 'product'
			? adapter.artifactExists(this.missionDir, this.definition.key)
			: adapter.taskExists(this.missionDir, this.definition.stageId, this.definition.fileName);
	}

	public async materialize(adapter: FilesystemAdapter): Promise<void> {
		if (await this.exists(adapter)) {
			return;
		}

		if (this.definition.kind === 'product') {
			await adapter.writeArtifactRecord(this.missionDir, this.definition.key, {
				...(this.definition.attributes ? { attributes: this.definition.attributes } : {}),
				body: this.definition.body
			});
			return;
		}

		await adapter.writeTaskRecord(this.missionDir, this.definition.stageId, this.definition.fileName, {
			subject: this.definition.subject,
			instruction: this.definition.instruction,
			...(this.definition.dependsOn ? { dependsOn: this.definition.dependsOn } : {}),
			agent: this.definition.agent,
			...(this.definition.status ? { status: this.definition.status } : {}),
			...(this.definition.retries !== undefined ? { retries: this.definition.retries } : {})
		});
	}
}