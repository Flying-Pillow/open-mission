import * as path from 'node:path';
import { DaemonSurrealStore } from '../DaemonSurrealStore.js';
import { CodeGraphStore } from './CodeGraphStore.js';
import type { CodeGraphIndexReadModel } from './CodeGraphSchema.js';
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
    private readonly cachedSurrealStores = new Map<string, DaemonSurrealStore>();

    public constructor(options: CodeIntelligenceServiceOptions = {}) {
        this.indexer = options.indexer ?? new CodeIndexer();
        this.createSurrealStore = options.surrealStore
            ? () => options.surrealStore as DaemonSurrealStore
            : options.createSurrealStore ?? ((input) => this.getOrCreateSurrealStore(input.rootPath));
        this.manageSurrealStoreLifecycle = options.manageSurrealStoreLifecycle ?? Boolean(options.createSurrealStore);
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

    public async stop(): Promise<void> {
        const stores = Array.from(this.cachedSurrealStores.values());
        this.cachedSurrealStores.clear();
        await Promise.all(stores.map((surrealStore) => surrealStore.stop()));
    }

    private getOrCreateSurrealStore(rootPath: string): DaemonSurrealStore {
        const key = path.resolve(rootPath.trim());
        const existing = this.cachedSurrealStores.get(key);
        if (existing) {
            return existing;
        }

        const store = DaemonSurrealStore.forCodeRoot({ rootPath });
        this.cachedSurrealStores.set(key, store);
        return store;
    }
}