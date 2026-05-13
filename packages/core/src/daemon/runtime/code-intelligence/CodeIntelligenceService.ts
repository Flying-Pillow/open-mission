import { DaemonSurrealStore } from '../DaemonSurrealStore.js';
import { CodeGraphStore, type CodeGraphIndexReadModel } from './CodeGraphStore.js';
import { CodeIndexer } from './CodeIndexer.js';

export type EnsureCodeIndexInput = {
    rootPath: string;
};

export type CodeIntelligenceServiceOptions = {
    indexer?: CodeIndexer;
    surrealStore?: DaemonSurrealStore;
    createSurrealStore?: (input: EnsureCodeIndexInput) => DaemonSurrealStore;
    manageSurrealStoreLifecycle?: boolean;
};

export class CodeIntelligenceService {
    private readonly indexer: CodeIndexer;
    private readonly createSurrealStore: (input: EnsureCodeIndexInput) => DaemonSurrealStore;
    private readonly manageSurrealStoreLifecycle: boolean;

    public constructor(options: CodeIntelligenceServiceOptions = {}) {
        this.indexer = options.indexer ?? new CodeIndexer();
        this.createSurrealStore = options.surrealStore
            ? () => options.surrealStore as DaemonSurrealStore
            : options.createSurrealStore ?? ((input) => DaemonSurrealStore.forCodeRoot({ rootPath: input.rootPath }));
        this.manageSurrealStoreLifecycle = options.manageSurrealStoreLifecycle ?? !options.surrealStore;
    }

    public async ensureIndex(input: EnsureCodeIndexInput): Promise<CodeGraphIndexReadModel> {
        const surrealStore = this.createSurrealStore(input);
        await this.startSurrealStore(surrealStore);
        try {
            const indexInput = await this.indexer.indexCodeRoot({ rootPath: input.rootPath });
            return await new CodeGraphStore({ surrealStore }).replaceIndex(indexInput);
        } finally {
            await this.stopSurrealStore(surrealStore);
        }
    }

    public async readActiveIndex(input: EnsureCodeIndexInput): Promise<CodeGraphIndexReadModel | null> {
        const surrealStore = this.createSurrealStore(input);
        await this.startSurrealStore(surrealStore);
        try {
            const graphStore = new CodeGraphStore({ surrealStore });
            const snapshot = await graphStore.readActiveSnapshot(input.rootPath);
            return snapshot ? await graphStore.readIndex(snapshot.id) ?? null : null;
        } finally {
            await this.stopSurrealStore(surrealStore);
        }
    }

    private async startSurrealStore(surrealStore: DaemonSurrealStore): Promise<void> {
        if (this.manageSurrealStoreLifecycle) {
            await surrealStore.start();
        }
    }

    private async stopSurrealStore(surrealStore: DaemonSurrealStore): Promise<void> {
        if (this.manageSurrealStoreLifecycle) {
            await surrealStore.stop();
        }
    }
}