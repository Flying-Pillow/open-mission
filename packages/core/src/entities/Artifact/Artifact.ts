import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createEntityId, Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import { MissionDossierFilesystem } from '../Mission/MissionDossierFilesystem.js';
import {
	MISSION_STAGE_FOLDERS,
	type MissionArtifactKey,
	type MissionStageId
} from '../../workflow/mission/manifest.js';
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

export type ArtifactKind = 'repository' | 'worktree' | 'mission' | 'stage' | 'task';

const FILE_ARTIFACT_UNIQUE_PREFIX = 'file:';
const binaryImageMimeTypesByExtension = new Map<string, string>([
	['.avif', 'image/avif'],
	['.bmp', 'image/bmp'],
	['.gif', 'image/gif'],
	['.ico', 'image/x-icon'],
	['.jpg', 'image/jpeg'],
	['.jpeg', 'image/jpeg'],
	['.png', 'image/png'],
	['.tif', 'image/tiff'],
	['.tiff', 'image/tiff'],
	['.webp', 'image/webp']
]);

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
		const fileArtifact = parseFileArtifactEntityId(input.id);
		if (fileArtifact) {
			return ArtifactDataSchema.parse({
				id: input.id,
				kind: inferArtifactKind(fileArtifact.rootPath, input.repositoryRootPath),
				label: path.basename(fileArtifact.relativePath),
				fileName: path.basename(fileArtifact.relativePath),
				...(input.repositoryRootPath ? { repositoryRootPath: input.repositoryRootPath } : {}),
				rootPath: fileArtifact.rootPath,
				relativePath: fileArtifact.relativePath,
				filePath: path.join(fileArtifact.rootPath, fileArtifact.relativePath)
			});
		}
		if (!input.missionId) {
			throw new Error(`Artifact '${input.id}' requires missionId or a file-rooted artifact id.`);
		}
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission({
			missionId: input.missionId,
			...(input.repositoryRootPath ? { repositoryRootPath: input.repositoryRootPath } : {})
		}, context);
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
		return Artifact.resolveBodyPathFromData(artifact);
	}

	public static resolveBodyPathFromData(artifact: ArtifactDataType): string {
		if (artifact.filePath) {
			return artifact.filePath;
		}
		if (artifact.relativePath && artifact.rootPath) {
			return path.join(artifact.rootPath, artifact.relativePath);
		}
		throw new Error(`Artifact '${artifact.id}' does not have a readable body path.`);
	}

	public static async body(payload: unknown, context: EntityExecutionContext) {
		const input = ArtifactLocatorSchema.parse(payload);
		const fileArtifact = parseFileArtifactEntityId(input.id);
		if (fileArtifact) {
			const filePath = path.join(fileArtifact.rootPath, fileArtifact.relativePath);
			const adapter = Artifact.createFilesystem({ rootPath: fileArtifact.rootPath }, context);
			await adapter.assertFilePath(filePath, 'read');
			return ArtifactBodySchema.parse({
				body: await readArtifactBody(filePath, adapter)
			});
		}
		if (!input.missionId) {
			throw new Error(`Artifact '${input.id}' body queries require missionId or a file-rooted artifact id.`);
		}
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission({
			missionId: input.missionId,
			...(input.repositoryRootPath ? { repositoryRootPath: input.repositoryRootPath } : {})
		}, context);
		try {
			const snapshot = await mission.buildMissionSnapshot();
			const artifact = Artifact.requireData(snapshot, input.id);
			const filePath = Artifact.resolveBodyPathFromData(artifact);
			const adapter = Artifact.createFilesystem({
				rootPath: artifact.rootPath,
				repositoryRootPath: artifact.repositoryRootPath ?? input.repositoryRootPath
			}, context);
			await adapter.assertFilePath(filePath, 'read');
			return ArtifactBodySchema.parse({
				body: await readArtifactBody(filePath, adapter)
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
		if (typeof input.input.body !== 'string') {
			throw new Error(`Artifact '${input.id}' only supports string body edits.`);
		}
		const fileArtifact = parseFileArtifactEntityId(input.id);
		if (fileArtifact) {
			const filePath = path.join(fileArtifact.rootPath, fileArtifact.relativePath);
			const adapter = Artifact.createFilesystem({ rootPath: fileArtifact.rootPath }, context);
			await adapter.assertFilePath(filePath, 'write');
			await adapter.writeFileBody(filePath, input.input.body);
			return ArtifactCommandAcknowledgementSchema.parse({
				ok: true,
				entity: artifactEntityName,
				method: 'command',
				id: input.id,
				commandId: input.commandId
			});
		}
		if (!input.missionId) {
			throw new Error(`Artifact '${input.id}' body commands require missionId or a file-rooted artifact id.`);
		}
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission({
			missionId: input.missionId,
			...(input.repositoryRootPath ? { repositoryRootPath: input.repositoryRootPath } : {})
		}, context);
		try {
			const snapshot = await mission.buildMissionSnapshot();
			const artifact = Artifact.requireData(snapshot, input.id);
			const filePath = Artifact.resolveBodyPathFromData(artifact);
			const adapter = Artifact.createFilesystem({
				rootPath: artifact.rootPath,
				repositoryRootPath: artifact.repositoryRootPath ?? input.repositoryRootPath
			}, context);
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
			missionId: input.missionId,
			label: definition.label,
			fileName: definition.fileName,
			...(input.filePath ? { filePath: input.filePath } : {}),
			...(input.filePath ? { rootPath: input.missionRootDir ?? path.dirname(input.filePath) } : {}),
			...(input.missionRootDir ? { rootPath: input.missionRootDir } : {}),
			...(input.stageId ?? definition.stageId ? { stageId: input.stageId ?? definition.stageId } : {}),
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
			missionId: input.missionId,
			label: input.label ?? input.fileName,
			fileName: input.fileName,
			stageId: input.stageId,
			taskId: input.taskId,
			...(input.filePath ? { rootPath: path.dirname(input.filePath) } : {}),
			...(input.filePath ? { filePath: input.filePath } : {}),
			...(input.relativePath ? { relativePath: input.relativePath } : {})
		});
	}

	public static createFileArtifactData(input: {
		rootPath: string;
		relativePath: string;
		repositoryRootPath?: string;
		label?: string;
		kind?: 'repository' | 'worktree';
	}): ArtifactDataType {
		const normalizedRootPath = requireTrimmedValue(input.rootPath, 'Artifact rootPath');
		const normalizedRelativePath = normalizeRelativePath(input.relativePath);
		const fileName = path.basename(normalizedRelativePath);
		return ArtifactDataSchema.parse({
			id: createFileArtifactEntityId(normalizedRootPath, normalizedRelativePath),
			kind: input.kind ?? inferArtifactKind(normalizedRootPath, input.repositoryRootPath),
			label: input.label?.trim() || fileName,
			fileName,
			...(input.repositoryRootPath ? { repositoryRootPath: input.repositoryRootPath.trim() } : {}),
			rootPath: normalizedRootPath,
			relativePath: normalizedRelativePath,
			filePath: path.join(normalizedRootPath, normalizedRelativePath)
		});
	}

	private static createFilesystem(input: {
		rootPath?: string | undefined;
		repositoryRootPath?: string | undefined;
	}, context: EntityExecutionContext): MissionDossierFilesystem {
		return new MissionDossierFilesystem(input.rootPath?.trim() || input.repositoryRootPath?.trim() || context.surfacePath);
	}

}

async function readArtifactBody(filePath: string, adapter: MissionDossierFilesystem): Promise<string> {
	const imageMimeType = resolveBinaryImageMimeType(filePath);
	if (!imageMimeType) {
		return (await adapter.readFileBody(filePath)).body;
	}

	const content = await fs.readFile(filePath);
	return `data:${imageMimeType};base64,${content.toString('base64')}`;
}

function resolveBinaryImageMimeType(filePath: string): string | undefined {
	return binaryImageMimeTypesByExtension.get(path.extname(filePath).toLowerCase());
}

export function createArtifactEntityId(missionId: string, id: string): string {
	return createEntityId('artifact', `${missionId}/${id}`);
}

export function createFileArtifactEntityId(rootPath: string, relativePath: string): string {
	const normalizedRootPath = requireTrimmedValue(rootPath, 'Artifact rootPath');
	const normalizedRelativePath = normalizeRelativePath(relativePath);
	return createEntityId(
		'artifact',
		`${FILE_ARTIFACT_UNIQUE_PREFIX}${encodeURIComponent(normalizedRootPath)}:${encodeURIComponent(normalizedRelativePath)}`
	);
}

export function parseFileArtifactEntityId(id: string): { rootPath: string; relativePath: string } | undefined {
	const normalizedId = requireTrimmedValue(id, 'Artifact id');
	if (!normalizedId.startsWith('artifact:')) {
		return undefined;
	}
	const uniqueId = normalizedId.slice('artifact:'.length);
	if (!uniqueId.startsWith(FILE_ARTIFACT_UNIQUE_PREFIX)) {
		return undefined;
	}
	const payload = uniqueId.slice(FILE_ARTIFACT_UNIQUE_PREFIX.length);
	const separatorIndex = payload.indexOf(':');
	if (separatorIndex <= 0 || separatorIndex === payload.length - 1) {
		throw new Error(`Artifact '${id}' is not a valid file-rooted artifact id.`);
	}
	return {
		rootPath: decodeURIComponent(payload.slice(0, separatorIndex)),
		relativePath: normalizeRelativePath(decodeURIComponent(payload.slice(separatorIndex + 1)))
	};
}

function inferArtifactKind(rootPath: string, repositoryRootPath?: string): 'repository' | 'worktree' {
	return repositoryRootPath?.trim() === rootPath.trim() ? 'repository' : 'worktree';
}

function normalizeRelativePath(relativePath: string): string {
	return requireTrimmedValue(relativePath, 'Artifact relativePath').replace(/\\/gu, '/').replace(/^\.\//u, '');
}

function requireTrimmedValue(value: string, label: string): string {
	const normalizedValue = value.trim();
	if (!normalizedValue) {
		throw new Error(`${label} is required.`);
	}
	return normalizedValue;
}

async function loadMissionRegistry(context: EntityExecutionContext) {
	const { requireMissionRegistry } = await import('../../daemon/MissionRegistry.js');
	return requireMissionRegistry(context);
}