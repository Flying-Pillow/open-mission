import * as path from 'node:path';
import { createEntityId, Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import {
	MISSION_STAGE_FOLDERS,
	type MissionArtifactKey,
	type MissionStageId
} from '../../types.js';
import { getMissionArtifactDefinition } from '../../workflow/mission/manifest.js';
import {
	ArtifactCommandInputSchema,
	ArtifactCommandIds,
	ArtifactCommandAcknowledgementSchema,
	ArtifactBodySchema,
	ArtifactLocatorSchema,
	ArtifactDataSchema,
	artifactEntityName,
	type ArtifactDataType
} from './ArtifactSchema.js';
import type { MissionSnapshotType } from '../Mission/MissionSchema.js';

export type ArtifactKind = 'mission' | 'stage' | 'task';

export class Artifact extends Entity<ArtifactDataType, string> {
	public static override readonly entityName = artifactEntityName;

	public constructor(data: ArtifactDataType) {
		super(ArtifactDataSchema.parse(data));
	}

	public get id(): string {
		return this.data.id;
	}

	public static async read(payload: unknown, context: EntityExecutionContext) {
		const input = ArtifactLocatorSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			return Artifact.requireData(await mission.buildMissionSnapshot(), input.id);
		} finally {
			mission.dispose();
		}
	}

	public static requireData(snapshot: MissionSnapshotType, id: string) {
		const artifact = snapshot.artifacts.find((candidate) => candidate.id === id);
		if (!artifact) {
			throw new Error(`Artifact '${id}' could not be resolved in Mission '${snapshot.mission.missionId}'.`);
		}
		return ArtifactDataSchema.parse(artifact);
	}

	public static resolveBodyPath(snapshot: MissionSnapshotType, id: string): string {
		const artifact = Artifact.requireData(snapshot, id);
		if (artifact.filePath) {
			return artifact.filePath;
		}
		if (artifact.relativePath && snapshot.mission.missionRootDir) {
			return path.join(snapshot.mission.missionRootDir, artifact.relativePath);
		}
		throw new Error(`Artifact '${id}' does not have a readable body path.`);
	}

	public static async body(payload: unknown, context: EntityExecutionContext) {
		const input = ArtifactLocatorSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			const snapshot = await mission.buildMissionSnapshot();
			const filePath = Artifact.resolveBodyPath(snapshot, input.id);
			const adapter = Artifact.createFilesystemAdapter(input, context);
			await adapter.assertFilePath(filePath, 'read');
			return ArtifactBodySchema.parse({
				body: (await adapter.readFileBody(filePath)).body
			});
		} finally {
			mission.dispose();
		}
	}

	public static async command(payload: unknown, context: EntityExecutionContext) {
		const input = ArtifactCommandInputSchema.parse(payload);
		if (input.commandId !== ArtifactCommandIds.body) {
			throw new Error(`Artifact command '${input.commandId}' is not implemented in the daemon.`);
		}
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			const snapshot = await mission.buildMissionSnapshot();
			Artifact.requireData(snapshot, input.id);
			if (typeof input.input.body !== 'string') {
				throw new Error(`Artifact '${input.id}' only supports string body edits.`);
			}
			const filePath = Artifact.resolveBodyPath(snapshot, input.id);
			const adapter = Artifact.createFilesystemAdapter(input, context);
			await adapter.assertFilePath(filePath, 'write');
			await adapter.writeFileBody(filePath, input.input.body);
			return ArtifactCommandAcknowledgementSchema.parse({
				ok: true,
				entity: artifactEntityName,
				method: 'command',
				id: input.id,
				missionId: input.missionId,
				commandId: input.commandId
			});
		} finally {
			mission.dispose();
		}
	}

	public static createMissionArtifact(input: {
		missionId: string;
		artifactKey: MissionArtifactKey;
		missionRootDir?: string;
		filePath?: string;
		stageId?: MissionStageId;
	}): ArtifactDataType {
		const definition = getMissionArtifactDefinition(input.artifactKey);
		const relativePath = definition.stageId
			? `${MISSION_STAGE_FOLDERS[definition.stageId]}/${definition.fileName}`
			: definition.fileName;
		const id = definition.stageId
			? `stage:${definition.stageId}:${definition.key}`
			: `mission:${definition.key}`;
		return ArtifactDataSchema.parse({
			id: createArtifactEntityId(input.missionId, id),
			kind: definition.stageId ? 'stage' : 'mission',
			key: definition.key,
			label: definition.label,
			fileName: definition.fileName,
			...(input.stageId ?? definition.stageId ? { stageId: input.stageId ?? definition.stageId } : {}),
			...(input.filePath ? { filePath: input.filePath } : {}),
			...(input.filePath || input.missionRootDir ? { relativePath } : {})
		});
	}

	public static createTaskArtifact(input: {
		missionId: string;
		taskId: string;
		stageId: MissionStageId;
		fileName: string;
		label?: string;
		filePath?: string;
		relativePath?: string;
	}): ArtifactDataType {
		const id = `task:${input.taskId}`;
		return ArtifactDataSchema.parse({
			id: createArtifactEntityId(input.missionId, id),
			kind: 'task',
			label: input.label ?? input.fileName,
			fileName: input.fileName,
			stageId: input.stageId,
			taskId: input.taskId,
			...(input.filePath ? { filePath: input.filePath } : {}),
			...(input.relativePath ? { relativePath: input.relativePath } : {})
		});
	}

	private static createFilesystemAdapter(input: { repositoryRootPath?: string | undefined }, context: EntityExecutionContext): FilesystemAdapter {
		return new FilesystemAdapter(input.repositoryRootPath?.trim() || context.surfacePath);
	}

}

export function createArtifactEntityId(missionId: string, id: string): string {
	return createEntityId('artifact', `${missionId}/${id}`);
}

async function loadMissionRegistry(context: EntityExecutionContext) {
	const { requireMissionRegistry } = await import('../../daemon/MissionRegistry.js');
	return requireMissionRegistry(context);
}