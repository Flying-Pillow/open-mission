import { Entity } from '$lib/components/entities/Entity/Entity.svelte.js';
import {
    ArtifactCommandAcknowledgementSchema,
    ArtifactBodySchema,
    ArtifactCommandIds,
    type ArtifactCommandAcknowledgementType,
    type ArtifactBodyType,
    type ArtifactDataType
} from '@flying-pillow/open-mission-core/entities/Artifact/ArtifactSchema';
import type { EntityCommandDescriptorType } from '@flying-pillow/open-mission-core/entities/Entity/EntitySchema';
import { cmd } from '../../../../routes/api/entities/remote/command.remote';
import { qry } from '../../../../routes/api/entities/remote/query.remote';

const FILE_ARTIFACT_UNIQUE_PREFIX = 'file:';

function requireTrimmedValue(value: string, label: string): string {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
        throw new Error(`${label} is required.`);
    }
    return normalizedValue;
}

function normalizeRelativePath(relativePath: string): string {
    return requireTrimmedValue(relativePath, 'Artifact relativePath')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '');
}

function createFileArtifactEntityId(rootPath: string, relativePath: string): string {
    const normalizedRootPath = requireTrimmedValue(rootPath, 'Artifact rootPath');
    const normalizedRelativePath = normalizeRelativePath(relativePath);
    return `artifact:${FILE_ARTIFACT_UNIQUE_PREFIX}${encodeURIComponent(normalizedRootPath)}:${encodeURIComponent(normalizedRelativePath)}`;
}

function inferArtifactKind(rootPath: string, repositoryRootPath?: string): 'repository' | 'worktree' {
    return repositoryRootPath?.trim() === rootPath.trim() ? 'repository' : 'worktree';
}

function createFileArtifactData(input: {
    rootPath: string;
    relativePath: string;
    repositoryRootPath?: string;
    label?: string;
}): ArtifactDataType {
    const normalizedRootPath = requireTrimmedValue(input.rootPath, 'Artifact rootPath');
    const normalizedRelativePath = normalizeRelativePath(input.relativePath);
    const fileName = normalizedRelativePath.split('/').at(-1) ?? normalizedRelativePath;
    return {
        id: createFileArtifactEntityId(normalizedRootPath, normalizedRelativePath),
        kind: inferArtifactKind(normalizedRootPath, input.repositoryRootPath),
        label: input.label?.trim() || fileName,
        fileName,
        ...(input.repositoryRootPath ? { repositoryRootPath: input.repositoryRootPath.trim() } : {}),
        rootPath: normalizedRootPath,
        relativePath: normalizedRelativePath,
        filePath: `${normalizedRootPath}/${normalizedRelativePath}`,
    };
}

export type ArtifactDependencies = {
    body(id: string, input?: ArtifactReadOptions): Promise<ArtifactBodyType>;
    bodyForRender(id: string): unknown;
    commandBody(id: string, body: ArtifactBodyType): Promise<ArtifactCommandAcknowledgementType>;
};

export type ArtifactReadOptions = {
    executionContext?: 'event' | 'render';
};

export type ArtifactBodyStatus = 'idle' | 'loading' | 'loaded' | 'error';

export function createFileArtifact(input: {
    repositoryRootPath: string;
    relativePath: string;
    rootPath?: string;
    label?: string;
}): Artifact {
    const repositoryRootPath = input.repositoryRootPath.trim();
    const relativePath = input.relativePath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    const rootPath = input.rootPath?.trim() || repositoryRootPath;
    const data = createFileArtifactData({
        repositoryRootPath,
        rootPath,
        relativePath,
        label: input.label,
    });

    return new Artifact(data, {
        body: async (id, readInput) => {
            return ArtifactBodySchema.parse(await qry({
                entity: 'Artifact',
                method: 'body',
                payload: {
                    id,
                    repositoryRootPath,
                    ...(readInput?.executionContext ? { executionContext: readInput.executionContext } : {}),
                },
            }).run());
        },
        bodyForRender: (id) => {
            return qry({
                entity: 'Artifact',
                method: 'body',
                payload: {
                    id,
                    repositoryRootPath,
                },
            });
        },
        commandBody: async (id, body) => {
            return ArtifactCommandAcknowledgementSchema.parse(await cmd({
                entity: 'Artifact',
                method: 'command',
                payload: {
                    id,
                    repositoryRootPath,
                    commandId: ArtifactCommandIds.body,
                    input: body,
                },
            }));
        },
    });
}

export class Artifact extends Entity<ArtifactDataType> {
    private dataState = $state<ArtifactDataType | undefined>();
    private bodyState = $state<ArtifactBodyType | undefined>();
    private bodyStatusState = $state<ArtifactBodyStatus>('idle');
    private bodyErrorState = $state<string | null>(null);
    private readonly dependencies: ArtifactDependencies;
    private bodyRequestVersion = 0;

    public constructor(data: ArtifactDataType, dependencies: ArtifactDependencies) {
        super();
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

    protected get entityLocator(): Record<string, unknown> {
        return {
            id: this.id,
            ...(this.data.repositoryRootPath ? { repositoryRootPath: this.data.repositoryRootPath } : {})
        };
    }

    public get filePath(): string | undefined {
        return this.data.filePath;
    }

    public get rootPath(): string | undefined {
        return this.data.rootPath;
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