import type { FrontmatterValue } from '../lib/frontmatter.js';
import { FilesystemAdapter } from '../lib/FilesystemAdapter.js';
import {
	MISSION_ARTIFACTS,
	MISSION_STAGE_FOLDERS,
	type MissionArtifactKey,
	type MissionStageId,
	type MissionTaskAgent,
	type MissionTaskStatus
} from '../types.js';
import { getMissionArtifactDefinition } from '../workflow/manifest.js';

export type ArtifactKind = 'mission' | 'stage' | 'task';

export type Artifact = {
	artifactId: string;
	kind: ArtifactKind;
	label: string;
	fileName: string;
	key?: MissionArtifactKey;
	stageId?: MissionStageId;
	taskId?: string;
	filePath?: string;
	relativePath?: string;
};

export type ArtifactEntityKind = ArtifactKind;
export type ArtifactEntity = Artifact;

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

class ArtifactRuntime {
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
			const stageFolder = definition.stageId ? MISSION_STAGE_FOLDERS[definition.stageId] : undefined;
			return stageFolder
				? `${stageFolder}/${MISSION_ARTIFACTS[this.definition.key]}`
				: MISSION_ARTIFACTS[this.definition.key];
		}

		return `${MISSION_STAGE_FOLDERS[this.definition.stageId]}/tasks/${this.definition.fileName}`;
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

export const Artifact = ArtifactRuntime;

export function createMissionArtifactEntity(input: {
	artifactKey: MissionArtifactKey;
	missionRootDir?: string;
	filePath?: string;
	stageId?: MissionStageId;
}): ArtifactEntity {
	const definition = getMissionArtifactDefinition(input.artifactKey);
	const relativePath = definition.stageId
		? `${MISSION_STAGE_FOLDERS[definition.stageId]}/${definition.fileName}`
		: definition.fileName;
	return {
		artifactId: definition.stageId
			? `stage:${definition.stageId}:${definition.key}`
			: `mission:${definition.key}`,
		kind: definition.stageId ? 'stage' : 'mission',
		key: definition.key,
		label: definition.label,
		fileName: definition.fileName,
		...(input.stageId ?? definition.stageId ? { stageId: input.stageId ?? definition.stageId } : {}),
		...(input.filePath ? { filePath: input.filePath } : {}),
		...(input.filePath || input.missionRootDir ? { relativePath } : {})
	};
}

export function createTaskArtifactEntity(input: {
	taskId: string;
	stageId: MissionStageId;
	fileName: string;
	label?: string;
	filePath?: string;
	relativePath?: string;
}): ArtifactEntity {
	return {
		artifactId: `task:${input.taskId}`,
		kind: 'task',
		label: input.label ?? input.fileName,
		fileName: input.fileName,
		stageId: input.stageId,
		taskId: input.taskId,
		...(input.filePath ? { filePath: input.filePath } : {}),
		...(input.relativePath ? { relativePath: input.relativePath } : {})
	};
}
