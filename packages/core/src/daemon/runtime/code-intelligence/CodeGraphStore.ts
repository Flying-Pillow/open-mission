import { StringRecordId } from 'surrealdb';
import { CodeIntelligenceIndexSchema } from '../../../entities/CodeIntelligence/CodeIntelligenceSchema.js';
import { DaemonSurrealStore } from '../DaemonSurrealStore.js';
import {
    CodeFileSchema,
    CodeIndexSnapshotSchema,
    CodeRelationSchema,
    CodeSymbolSchema,
    CODE_INDEXER_VERSION,
    compileCodeGraphSurql,
    createCodeGraphRecordId,
    createCodeRootId,
    type CodeFileRecord,
    type CodeIndexSnapshotRecord,
    type CodeGraphIndexReadModel,
    type CodeRelationRecord,
    type CodeSymbolRecord
} from './CodeGraphSchema.js';

export type CodeGraphReplaceIndexInput = {
    rootPath: string;
    rootFingerprint: string;
    indexedAt?: string;
    files: Array<Omit<CodeFileRecord, 'id' | 'indexId'>>;
    symbols: Array<Omit<CodeSymbolRecord, 'id' | 'indexId' | 'fileId'>>;
    relations: Array<Omit<CodeRelationRecord, 'id' | 'indexId' | 'fromFileId'>>;
};

export class CodeGraphStore {
    private provisioned = false;

    public constructor(private readonly input: { surrealStore: DaemonSurrealStore }) {}

    public async provision(): Promise<void> {
        if (this.provisioned) {
            return;
        }
        await this.input.surrealStore.query(compileCodeGraphSurql());
        this.provisioned = true;
    }

    public async replaceIndex(input: CodeGraphReplaceIndexInput): Promise<CodeGraphIndexReadModel> {
        await this.provision();
        const codeRootId = createCodeRootId(input.rootPath);
        const indexedAt = input.indexedAt ?? new Date().toISOString();
        const previousActiveSnapshot = await this.readActiveSnapshot(input.rootPath);
        const snapshot: CodeIndexSnapshotRecord = CodeIndexSnapshotSchema.parse({
            id: createCodeGraphRecordId('code_index_snapshot', `${codeRootId}:${input.rootFingerprint}:${indexedAt}`),
            codeRootId,
            rootPath: input.rootPath,
            rootFingerprint: input.rootFingerprint,
            indexerVersion: CODE_INDEXER_VERSION,
            indexedAt,
            status: 'candidate',
            fileCount: input.files.length,
            symbolCount: input.symbols.length,
            relationCount: input.relations.length,
            ...(previousActiveSnapshot ? { previousActiveSnapshotId: previousActiveSnapshot.id } : {})
        });
        const files = input.files.map((file) => CodeFileSchema.parse({
            ...file,
            id: createCodeGraphRecordId('code_file', `${snapshot.id}:${file.path}`),
            indexId: snapshot.id
        }));
        const fileIdByPath = new Map(files.map((file) => [file.path, file.id]));
        const symbols = input.symbols.map((symbol) => CodeSymbolSchema.parse({
            ...symbol,
            id: createCodeGraphRecordId('code_symbol', `${snapshot.id}:${symbol.filePath}:${symbol.name}:${symbol.kind}:${symbol.startLine}`),
            indexId: snapshot.id,
            fileId: requireFileId(fileIdByPath, symbol.filePath)
        }));
        const relations = input.relations.map((relation) => CodeRelationSchema.parse({
            ...relation,
            id: createCodeGraphRecordId('code_relation', `${snapshot.id}:${relation.fromFilePath}:${relation.kind}:${relation.target}`),
            indexId: snapshot.id,
            fromFileId: requireFileId(fileIdByPath, relation.fromFilePath)
        }));

        await this.createRecord(snapshot.id, snapshot);
        for (const file of files) {
            await this.createRecord(file.id, file);
        }
        for (const symbol of symbols) {
            await this.createRecord(symbol.id, symbol);
        }
        for (const relation of relations) {
            await this.createRecord(relation.id, relation);
        }
        if (previousActiveSnapshot) {
            await this.input.surrealStore.query('UPDATE $id SET status = $status;', {
                id: toSurrealRecordId(previousActiveSnapshot.id),
                status: 'replaced'
            });
        }
        await this.input.surrealStore.query('UPDATE $id SET status = $status;', {
            id: toSurrealRecordId(snapshot.id),
            status: 'active'
        });

        return CodeIntelligenceIndexSchema.parse({
            snapshot: { ...snapshot, status: 'active' },
            files,
            symbols,
            relations
        });
    }

    public async readActiveSnapshot(rootPath: string): Promise<CodeIndexSnapshotRecord | undefined> {
        await this.provision();
        const [rows] = await this.input.surrealStore.query<unknown[]>('SELECT * FROM code_index_snapshot WHERE codeRootId = $codeRootId AND status = $status ORDER BY indexedAt DESC LIMIT 1;', {
            codeRootId: createCodeRootId(rootPath),
            status: 'active'
        });
        const row = Array.isArray(rows) ? rows[0] : undefined;
        return row ? CodeIndexSnapshotSchema.parse(hydrateRecord(row)) : undefined;
    }

    public async listFilesForSnapshot(snapshotId: string): Promise<CodeFileRecord[]> {
        await this.provision();
        const [rows] = await this.input.surrealStore.query<unknown[]>('SELECT * FROM code_file WHERE indexId = $indexId ORDER BY path ASC;', { indexId: snapshotId });
        return (Array.isArray(rows) ? rows : []).map((row) => CodeFileSchema.parse(hydrateRecord(row)));
    }

    public async listSymbolsForSnapshot(snapshotId: string): Promise<CodeSymbolRecord[]> {
        await this.provision();
        const [rows] = await this.input.surrealStore.query<unknown[]>('SELECT * FROM code_symbol WHERE indexId = $indexId ORDER BY filePath ASC, startLine ASC;', { indexId: snapshotId });
        return (Array.isArray(rows) ? rows : []).map((row) => CodeSymbolSchema.parse(hydrateRecord(row)));
    }

    public async listRelationsForSnapshot(snapshotId: string): Promise<CodeRelationRecord[]> {
        await this.provision();
        const [rows] = await this.input.surrealStore.query<unknown[]>('SELECT * FROM code_relation WHERE indexId = $indexId ORDER BY fromFilePath ASC, target ASC;', { indexId: snapshotId });
        return (Array.isArray(rows) ? rows : []).map((row) => CodeRelationSchema.parse(hydrateRecord(row)));
    }

    public async readIndex(snapshotId: string): Promise<CodeGraphIndexReadModel | undefined> {
        await this.provision();
        const [rows] = await this.input.surrealStore.query<unknown[]>('SELECT * FROM code_index_snapshot WHERE id = $id LIMIT 1;', { id: toSurrealRecordId(snapshotId) });
        const row = Array.isArray(rows) ? rows[0] : undefined;
        if (!row) {
            return undefined;
        }
        const snapshot = CodeIndexSnapshotSchema.parse(hydrateRecord(row));
        return CodeIntelligenceIndexSchema.parse({
            snapshot,
            files: await this.listFilesForSnapshot(snapshot.id),
            symbols: await this.listSymbolsForSnapshot(snapshot.id),
            relations: await this.listRelationsForSnapshot(snapshot.id)
        });
    }

    public async searchSymbolsByName(input: { snapshotId: string; name: string }): Promise<CodeSymbolRecord[]> {
        await this.provision();
        const [rows] = await this.input.surrealStore.query<unknown[]>('SELECT * FROM code_symbol WHERE indexId = $indexId AND name = $name ORDER BY filePath ASC, startLine ASC;', {
            indexId: input.snapshotId,
            name: input.name
        });
        return (Array.isArray(rows) ? rows : []).map((row) => CodeSymbolSchema.parse(hydrateRecord(row)));
    }

    public async searchFiles(input: { snapshotId: string; pathIncludes: string }): Promise<CodeFileRecord[]> {
        await this.provision();
        const [rows] = await this.input.surrealStore.query<unknown[]>('SELECT * FROM code_file WHERE indexId = $indexId AND string::contains(path, $pathIncludes) ORDER BY path ASC;', {
            indexId: input.snapshotId,
            pathIncludes: input.pathIncludes
        });
        return (Array.isArray(rows) ? rows : []).map((row) => CodeFileSchema.parse(hydrateRecord(row)));
    }

    private async createRecord(id: string, record: Record<string, unknown>): Promise<void> {
        const { id: _id, ...content } = record;
        await this.input.surrealStore.query('CREATE $id CONTENT $content;', {
            id: toSurrealRecordId(id),
            content
        });
    }
}

function requireFileId(fileIdByPath: Map<string, string>, filePath: string): string {
    const fileId = fileIdByPath.get(filePath);
    if (!fileId) {
        throw new Error(`Code graph relation references unindexed file '${filePath}'.`);
    }
    return fileId;
}

function toSurrealRecordId(recordId: string): StringRecordId {
    return new StringRecordId(recordId);
}

function hydrateRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object') {
        throw new Error('Expected SurrealDB record object.');
    }
    const record = value as Record<string, unknown>;
    return {
        ...record,
        id: stringifySurrealRecordId(record['id'])
    };
}

function stringifySurrealRecordId(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (value && typeof value === 'object' && typeof (value as { toJSON?: () => unknown }).toJSON === 'function') {
        const jsonValue = (value as { toJSON: () => unknown }).toJSON();
        if (typeof jsonValue === 'string') {
            return jsonValue;
        }
    }
    if (value && typeof value === 'object' && typeof (value as { toString?: () => string }).toString === 'function') {
        const text = (value as { toString: () => string }).toString();
        if (text && text !== '[object Object]') {
            return text;
        }
    }
    throw new Error('Expected SurrealDB record id to be stringifiable.');
}