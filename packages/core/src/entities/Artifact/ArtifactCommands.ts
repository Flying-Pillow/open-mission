import {
    artifactCommandListSnapshotSchema,
    artifactDocumentSnapshotSchema,
    artifactExecuteCommandPayloadSchema,
    artifactIdentityPayloadSchema,
    artifactWriteDocumentPayloadSchema,
    missionArtifactSnapshotSchema,
    type ArtifactCommandAcknowledgement,
    type ArtifactCommandListSnapshot,
    type ArtifactDocumentSnapshot,
    type ArtifactExecuteCommandPayload,
    type ArtifactIdentityPayload,
    type ArtifactWriteDocumentPayload,
    type MissionArtifactSnapshot
} from '../../schemas/Artifact.js';
import {
    assertMissionDocumentPath,
    buildMissionSnapshot,
    loadRequiredMissionRuntime,
    readMissionDocument,
    requireArtifact,
    requireArtifactFilePath,
    resolveControlRoot,
    writeMissionDocument,
    type MissionCommandContext
} from '../Mission/MissionRuntimeAccess.js';

export class ArtifactCommands {
    public static async read(
        input: ArtifactIdentityPayload,
        context: MissionCommandContext
    ): Promise<MissionArtifactSnapshot> {
        const payload = artifactIdentityPayloadSchema.parse(input);
        const mission = await loadRequiredMissionRuntime(payload, context);
        try {
            return missionArtifactSnapshotSchema.parse(requireArtifact(await buildMissionSnapshot(mission, payload.missionId), payload.artifactId));
        } finally {
            mission.dispose();
        }
    }

    public static async readDocument(
        input: ArtifactIdentityPayload,
        context: MissionCommandContext
    ): Promise<ArtifactDocumentSnapshot> {
        const payload = artifactIdentityPayloadSchema.parse(input);
        const mission = await loadRequiredMissionRuntime(payload, context);
        try {
            const snapshot = await buildMissionSnapshot(mission, payload.missionId);
            const artifact = requireArtifact(snapshot, payload.artifactId);
            const filePath = requireArtifactFilePath(snapshot, artifact);
            await assertMissionDocumentPath(filePath, 'read', resolveControlRoot(payload, context));
            return artifactDocumentSnapshotSchema.parse(await readMissionDocument(filePath));
        } finally {
            mission.dispose();
        }
    }

    public static async writeDocument(
        input: ArtifactWriteDocumentPayload,
        context: MissionCommandContext
    ): Promise<ArtifactDocumentSnapshot> {
        const payload = artifactWriteDocumentPayloadSchema.parse(input);
        const mission = await loadRequiredMissionRuntime(payload, context);
        try {
            const snapshot = await buildMissionSnapshot(mission, payload.missionId);
            const artifact = requireArtifact(snapshot, payload.artifactId);
            const filePath = requireArtifactFilePath(snapshot, artifact);
            await assertMissionDocumentPath(filePath, 'write', resolveControlRoot(payload, context));
            return artifactDocumentSnapshotSchema.parse(await writeMissionDocument(filePath, payload.content));
        } finally {
            mission.dispose();
        }
    }

    public static async listCommands(
        input: ArtifactIdentityPayload,
        context: MissionCommandContext
    ): Promise<ArtifactCommandListSnapshot> {
        const payload = artifactIdentityPayloadSchema.parse(input);
        const mission = await loadRequiredMissionRuntime(payload, context);
        try {
            requireArtifact(await buildMissionSnapshot(mission, payload.missionId), payload.artifactId);
            return artifactCommandListSnapshotSchema.parse({
                entity: 'Artifact',
                entityId: payload.artifactId,
                missionId: payload.missionId,
                artifactId: payload.artifactId,
                commands: []
            });
        } finally {
            mission.dispose();
        }
    }

    public static async executeCommand(
        input: ArtifactExecuteCommandPayload,
        context: MissionCommandContext
    ): Promise<ArtifactCommandAcknowledgement> {
        const payload = artifactExecuteCommandPayloadSchema.parse(input);
        const mission = await loadRequiredMissionRuntime(payload, context);
        try {
            requireArtifact(await buildMissionSnapshot(mission, payload.missionId), payload.artifactId);
            throw new Error(`Artifact command '${payload.commandId}' is not implemented in the daemon.`);
        } finally {
            mission.dispose();
        }
    }
}
