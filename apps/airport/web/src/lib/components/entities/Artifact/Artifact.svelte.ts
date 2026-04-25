import type { EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';

export type ArtifactDocumentPayload = {
    filePath: string;
    content: string;
    updatedAt?: string;
};

export type ArtifactSnapshot = {
    filePath: string;
    label?: string;
    stageId?: string;
    taskId?: string;
};

export type ArtifactOwner = {
    readArtifact(filePath: string): Promise<ArtifactDocumentPayload>;
    writeArtifact(filePath: string, content: string): Promise<ArtifactDocumentPayload>;
};

export class Artifact implements EntityModel<ArtifactSnapshot> {
    private snapshotState = $state<ArtifactSnapshot | undefined>();
    private readonly owner: ArtifactOwner;

    public constructor(snapshot: ArtifactSnapshot, owner: ArtifactOwner) {
        this.snapshot = snapshot;
        this.owner = owner;
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
        return this.filePath;
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

    public async read(): Promise<ArtifactDocumentPayload> {
        return this.owner.readArtifact(this.filePath);
    }

    public async write(content: string): Promise<ArtifactDocumentPayload> {
        return this.owner.writeArtifact(this.filePath, content);
    }

    public updateFromSnapshot(snapshot: ArtifactSnapshot): this {
        this.snapshot = snapshot;
        return this;
    }

    public toSnapshot(): ArtifactSnapshot {
        return structuredClone($state.snapshot(this.snapshot));
    }

    public toJSON(): ArtifactSnapshot {
        return this.toSnapshot();
    }
}

function basename(filePath: string | undefined): string | undefined {
    if (!filePath) {
        return undefined;
    }

    const normalized = filePath.replace(/\\/g, '/');
    return normalized.split('/').pop() ?? normalized;
}