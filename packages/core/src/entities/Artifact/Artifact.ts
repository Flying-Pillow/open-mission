import * as path from 'node:path';
import type { FrontmatterValue } from '../../lib/frontmatter.js';
import { Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import {
	MISSION_ARTIFACTS,
	MISSION_STAGE_FOLDERS,
	type MissionArtifactKey,
	type MissionStageId,
	type MissionTaskAgent,
	type MissionTaskStatus
} from '../../types.js';
import { getMissionArtifactDefinition } from '../../workflow/mission/manifest.js';
import {
	ArtifactDocumentDataSchema,
	ArtifactLocatorSchema,
	ArtifactWriteDocumentInputSchema,
	ArtifactDataSchema,
	artifactEntityName,
	type ArtifactDataType
} from './ArtifactSchema.js';
import type { MissionSnapshotType } from '../Mission/MissionSchema.js';

export type ArtifactKind = 'mission' | 'stage' | 'task';

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

export class ArtifactRuntime {
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

export class Artifact extends Entity<ArtifactDataType, string> {
	public static override readonly entityName = artifactEntityName;

	public constructor(data: ArtifactDataType) {
		super(ArtifactDataSchema.parse(data));
	}

	public get id(): string {
		return this.data.artifactId;
	}

	public static async read(payload: unknown, context: EntityExecutionContext) {
		const input = ArtifactLocatorSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			return Artifact.requireData(await mission.buildMissionSnapshot(), input.artifactId);
		} finally {
			mission.dispose();
		}
	}

	public static requireData(snapshot: MissionSnapshotType, artifactId: string) {
		const artifact = snapshot.artifacts.find((candidate) => candidate.artifactId === artifactId);
		if (!artifact) {
			throw new Error(`Artifact '${artifactId}' could not be resolved in Mission '${snapshot.mission.missionId}'.`);
		}
		return ArtifactDataSchema.parse(artifact);
	}

	public static resolveDocumentPath(snapshot: MissionSnapshotType, artifactId: string): string {
		const artifact = Artifact.requireData(snapshot, artifactId);
		if (artifact.filePath) {
			return artifact.filePath;
		}
		if (artifact.relativePath && snapshot.mission.missionRootDir) {
			return path.join(snapshot.mission.missionRootDir, artifact.relativePath);
		}
		throw new Error(`Artifact '${artifactId}' does not have a readable document path.`);
	}

	public static async readDocument(payload: unknown, context: EntityExecutionContext) {
		const input = ArtifactLocatorSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			const filePath = Artifact.resolveDocumentPath(await mission.buildMissionSnapshot(), input.artifactId);
			await service.assertMissionDocumentPath(filePath, 'read', service.resolveControlRoot(input, context));
			return ArtifactDocumentDataSchema.parse(await service.readMissionDocument(filePath));
		} finally {
			mission.dispose();
		}
	}

	public static async writeDocument(payload: unknown, context: EntityExecutionContext) {
		const input = ArtifactWriteDocumentInputSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			const filePath = Artifact.resolveDocumentPath(await mission.buildMissionSnapshot(), input.artifactId);
			await service.assertMissionDocumentPath(filePath, 'write', service.resolveControlRoot(input, context));
			return ArtifactDocumentDataSchema.parse(await service.writeMissionDocument(filePath, input.content));
		} finally {
			mission.dispose();
		}
	}

}

async function loadMissionRegistry(context: EntityExecutionContext) {
	const { requireMissionRegistry } = await import('../../daemon/MissionRegistry.js');
	return requireMissionRegistry(context);
}

export function createMissionArtifact(input: {
	artifactKey: MissionArtifactKey;
	missionRootDir?: string;
	filePath?: string;
	stageId?: MissionStageId;
}): ArtifactDataType {
	const definition = getMissionArtifactDefinition(input.artifactKey);
	const relativePath = definition.stageId
		? `${MISSION_STAGE_FOLDERS[definition.stageId]}/${definition.fileName}`
		: definition.fileName;
	return ArtifactDataSchema.parse({
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
	});
}

export function createTaskArtifact(input: {
	taskId: string;
	stageId: MissionStageId;
	fileName: string;
	label?: string;
	filePath?: string;
	relativePath?: string;
}): ArtifactDataType {
	return ArtifactDataSchema.parse({
		artifactId: `task:${input.taskId}`,
		kind: 'task',
		label: input.label ?? input.fileName,
		fileName: input.fileName,
		stageId: input.stageId,
		taskId: input.taskId,
		...(input.filePath ? { filePath: input.filePath } : {}),
		...(input.relativePath ? { relativePath: input.relativePath } : {})
	});
}

export async function collectArtifactFiles(input: {
	adapter: FilesystemAdapter;
	missionDir: string;
}): Promise<Partial<Record<MissionArtifactKey, string>>> {
	const entries = await Promise.all(
		(Object.keys(MISSION_ARTIFACTS) as MissionArtifactKey[]).map(async (artifact) => {
			const filePath = await input.adapter.readArtifactRecord(input.missionDir, artifact).then(
				(record) => record?.filePath
			);
			const exists = await input.adapter.artifactExists(input.missionDir, artifact);
			return exists && filePath ? ([artifact, filePath] as const) : undefined;
		})
	);

	const result: Partial<Record<MissionArtifactKey, string>> = {};
	for (const entry of entries) {
		if (!entry) {
			continue;
		}
		result[entry[0]] = entry[1];
	}
	return result;
}