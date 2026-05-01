import type { EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';
import type { EntityCommandDescriptorType } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';
import type { MissionDocumentSnapshotType as MissionDocumentSnapshot } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';

export type ArtifactDocumentPayload = MissionDocumentSnapshot;

export type ArtifactSnapshot = {
    artifactId: string;
    filePath: string;
    label?: string;
    stageId?: string;
    taskId?: string;
    commands?: EntityCommandDescriptorType[];
};

export type ArtifactDependencies = {
    readDocument(filePath: string, input?: ArtifactReadOptions): Promise<ArtifactDocumentPayload>;
    writeDocument(filePath: string, content: string): Promise<ArtifactDocumentPayload>;
};

export type ArtifactReadOptions = {
    executionContext?: 'event' | 'render';
};

export class Artifact implements EntityModel<ArtifactSnapshot> {
    private snapshotState = $state<ArtifactSnapshot | undefined>();
    private readonly dependencies: ArtifactDependencies;

    public constructor(snapshot: ArtifactSnapshot, dependencies: ArtifactDependencies) {
        this.snapshot = snapshot;
        this.dependencies = dependencies;
    }

    private get snapshot(): ArtifactSnapshot {
        const snapshot = this.snapshotState;
        if (!snapshot) {
            throw new Error('Artifact snapshot is not initialized.');
        }

        return snapshot;
    }

    private set snapshot(snapshot: ArtifactSnapshot) {
        this.snapshotState = structuredClone(snapshot);
    }

    public get id(): string {
        return this.artifactId;
    }

    public get entityName(): 'Artifact' {
        return 'Artifact';
    }

    public get entityId(): string {
        return this.artifactId;
    }

    public get artifactId(): string {
        return this.snapshot.artifactId;
    }

    public get filePath(): string {
        return this.snapshot.filePath;
    }

    public get label(): string {
        return this.snapshot.label ?? basename(this.snapshot.filePath) ?? this.snapshot.filePath;
    }

    public get stageId(): string | undefined {
        return this.snapshot.stageId;
    }

    public get taskId(): string | undefined {
        return this.snapshot.taskId;
    }

    public get commands(): EntityCommandDescriptorType[] {
        return structuredClone($state.snapshot(this.snapshot.commands ?? []));
    }

    public async read(input: ArtifactReadOptions = {}): Promise<ArtifactDocumentPayload> {
        return this.dependencies.readDocument(this.filePath, input);
    }

    public async write(content: string): Promise<ArtifactDocumentPayload> {
        return this.dependencies.writeDocument(this.filePath, content);
    }

    public updateFromData(snapshot: ArtifactSnapshot): this {
        this.snapshot = snapshot;
        return this;
    }

    public toData(): ArtifactSnapshot {
        return structuredClone($state.snapshot(this.snapshot));
    }

    public toJSON(): ArtifactSnapshot {
        return this.toData();
    }
}

function basename(filePath: string | undefined): string | undefined {
    if (!filePath) {
        return undefined;
    }

    const normalized = filePath.replace(/\\/g, '/');
    return normalized.split('/').pop() ?? normalized;
}