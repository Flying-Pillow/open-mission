import type { EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';
import type {
    ArtifactCommandAcknowledgementType,
    ArtifactBodyType,
    ArtifactDataType
} from '@flying-pillow/mission-core/entities/Artifact/ArtifactSchema';
import type { EntityCommandDescriptorType } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';

export type ArtifactDependencies = {
    body(id: string, input?: ArtifactReadOptions): Promise<ArtifactBodyType>;
    commandBody(id: string, body: ArtifactBodyType): Promise<ArtifactCommandAcknowledgementType>;
};

export type ArtifactReadOptions = {
    executionContext?: 'event' | 'render';
};

export class Artifact implements EntityModel<ArtifactDataType> {
    private dataState = $state<ArtifactDataType | undefined>();
    private readonly dependencies: ArtifactDependencies;

    public constructor(data: ArtifactDataType, dependencies: ArtifactDependencies) {
        this.data = data;
        this.dependencies = dependencies;
    }

    private get data(): ArtifactDataType {
        const data = this.dataState;
        if (!data) {
            throw new Error('Artifact data is not initialized.');
        }

        return data;
    }

    private set data(data: ArtifactDataType) {
        this.dataState = structuredClone(data);
    }

    public get id(): string {
        return this.data.id;
    }

    public get entityName(): 'Artifact' {
        return 'Artifact';
    }

    public get entityId(): string {
        return this.data.id;
    }

    public get filePath(): string | undefined {
        return this.data.filePath;
    }

    public get relativePath(): string | undefined {
        return this.data.relativePath;
    }

    public get fileName(): string {
        return this.data.fileName;
    }

    public get bodyLocationLabel(): string {
        return this.relativePath ?? this.filePath ?? this.fileName;
    }

    public get label(): string {
        return this.data.label;
    }

    public get stageId(): string | undefined {
        return this.data.stageId;
    }

    public get taskId(): string | undefined {
        return this.data.taskId;
    }

    public get commands(): EntityCommandDescriptorType[] {
        return [];
    }

    public async read(input: ArtifactReadOptions = {}): Promise<ArtifactBodyType> {
        return this.dependencies.body(this.id, input);
    }

    public async saveBody(content: string): Promise<ArtifactCommandAcknowledgementType> {
        return this.dependencies.commandBody(this.id, {
            body: content
        });
    }

    public updateFromData(data: ArtifactDataType): this {
        this.data = data;
        return this;
    }

    public toData(): ArtifactDataType {
        return structuredClone($state.snapshot(this.data));
    }

    public toJSON(): ArtifactDataType {
        return this.toData();
    }
}