import type { EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';
import type {
    ArtifactCommandAcknowledgementType,
    ArtifactBodyType,
    ArtifactDataType
} from '@flying-pillow/mission-core/entities/Artifact/ArtifactSchema';
import type { EntityCommandDescriptorType } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';

export type ArtifactDependencies = {
    body(id: string, input?: ArtifactReadOptions): Promise<ArtifactBodyType>;
    bodyForRender(id: string): unknown;
    commandBody(id: string, body: ArtifactBodyType): Promise<ArtifactCommandAcknowledgementType>;
};

export type ArtifactReadOptions = {
    executionContext?: 'event' | 'render';
};

export type ArtifactBodyStatus = 'idle' | 'loading' | 'loaded' | 'error';

export class Artifact implements EntityModel<ArtifactDataType> {
    private dataState = $state<ArtifactDataType | undefined>();
    private bodyState = $state<ArtifactBodyType | undefined>();
    private bodyStatusState = $state<ArtifactBodyStatus>('idle');
    private bodyErrorState = $state<string | null>(null);
    private readonly dependencies: ArtifactDependencies;
    private bodyRequestVersion = 0;

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

    public get body(): ArtifactBodyType | undefined {
        const body = this.bodyState;
        return body ? structuredClone($state.snapshot(body)) : undefined;
    }

    public get bodyText(): string | undefined {
        const body = this.bodyState?.body;
        return typeof body === 'string' ? body : undefined;
    }

    public get bodyStatus(): ArtifactBodyStatus {
        return this.bodyStatusState;
    }

    public get isBodyLoading(): boolean {
        return this.bodyStatusState === 'loading';
    }

    public get bodyError(): string | null {
        return this.bodyErrorState;
    }

    public async read(input: ArtifactReadOptions = {}): Promise<ArtifactBodyType> {
        return this.dependencies.body(this.id, input);
    }

    public readForRender(): unknown {
        return this.dependencies.bodyForRender(this.id);
    }

    public async refreshBody(input: ArtifactReadOptions = {}): Promise<ArtifactBodyType> {
        const requestVersion = ++this.bodyRequestVersion;
        this.bodyStatusState = 'loading';
        this.bodyErrorState = null;

        try {
            const body = await this.dependencies.body(this.id, input);
            if (requestVersion === this.bodyRequestVersion) {
                this.bodyState = structuredClone(body);
                this.bodyStatusState = 'loaded';
            }
            return body;
        } catch (error) {
            if (requestVersion === this.bodyRequestVersion) {
                this.bodyErrorState = error instanceof Error ? error.message : String(error);
                this.bodyStatusState = 'error';
            }
            throw error;
        }
    }

    public async saveBody(content: string): Promise<ArtifactCommandAcknowledgementType> {
        const acknowledgement = await this.dependencies.commandBody(this.id, {
            body: content
        });
        this.bodyState = {
            body: content
        };
        this.bodyErrorState = null;
        this.bodyStatusState = 'loaded';
        return acknowledgement;
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