import type { EntityExecutionContext } from '../../../entities/Entity/Entity.js';
import { CodeGraphSnapshot } from '../../../entities/CodeGraphSnapshot/CodeGraphSnapshot.js';
import { CodeObject } from '../../../entities/CodeObject/CodeObject.js';
import { CodeRelation } from '../../../entities/CodeRelation/CodeRelation.js';
import { Repository } from '../../../entities/Repository/Repository.js';
import { createEntityFactory, type Factory } from '../../../lib/factory.js';
import {
    CODE_INDEXER_VERSION,
    CodeGraphSnapshotRecordSchema,
    CodeObjectSchema,
    CodeRelationSchema,
    createCodeGraphRecordId,
    createCodeRootId,
    type CodeGraphIndexReadModel,
    type CodeGraphObjectDraft,
    type CodeGraphRelationDraft,
    type CodeGraphReplaceIndexInput,
    type CodeGraphSnapshotRecord,
    type CodeObjectRecord,
    type CodeRelationRecord
} from './CodeGraphSchema.js';
import { CodeIndexer } from './CodeIndexer.js';

export type EnsureCodeIndexInput = {
    repositoryId?: string;
    rootPath: string;
};

export type CodeIntelligenceServiceOptions = {
    indexer?: CodeIndexer;
    entityFactory?: Factory;
    createEntityFactory?: (input: EnsureCodeIndexInput) => Factory;
};

export class CodeIntelligenceService {
    private readonly indexer: CodeIndexer;
    private readonly createEntityFactory: (input: EnsureCodeIndexInput) => Factory;

    public constructor(options: CodeIntelligenceServiceOptions = {}) {
        this.indexer = options.indexer ?? new CodeIndexer();
        this.createEntityFactory = options.entityFactory
            ? () => options.entityFactory as Factory
            : options.createEntityFactory ?? (() => createEntityFactory());
    }

    public async ensureIndex(input: EnsureCodeIndexInput): Promise<CodeGraphIndexReadModel> {
        const context = createCodeGraphExecutionContext(input.rootPath, this.createEntityFactory(input));
        const indexInput = await this.indexer.indexCodeRoot({ rootPath: input.rootPath });
        return await this.replaceIndex(context, input, indexInput);
    }

    public async readActiveIndex(input: EnsureCodeIndexInput): Promise<CodeGraphIndexReadModel | null> {
        const [snapshot] = await CodeGraphSnapshot.find({
            repositoryId: resolveRepositoryId(input),
            rootPath: input.rootPath,
            status: 'active'
        }, createCodeGraphExecutionContext(input.rootPath, this.createEntityFactory(input)));
        return snapshot ?? null;
    }

    private async replaceIndex(context: EntityExecutionContext, ensureInput: EnsureCodeIndexInput, input: CodeGraphReplaceIndexInput): Promise<CodeGraphIndexReadModel> {
        const repositoryId = resolveRepositoryId(ensureInput);
        const entityFactory = requireEntityFactory(context);
        const codeRootId = createCodeRootId(input.rootPath);
        const indexedAt = input.indexedAt ?? new Date().toISOString();
        const previousActiveSnapshot = await this.readActiveSnapshot(context, ensureInput);
        const snapshot: CodeGraphSnapshotRecord = CodeGraphSnapshotRecordSchema.parse({
            id: createCodeGraphRecordId('code_graph_snapshot', `${codeRootId}:${input.rootFingerprint}:${indexedAt}`),
            repositoryId,
            codeRootId,
            rootPath: input.rootPath,
            rootFingerprint: input.rootFingerprint,
            indexerVersion: CODE_INDEXER_VERSION,
            indexedAt,
            status: 'candidate',
            objectCount: input.objects.length,
            relationCount: input.relations.length,
            ...(previousActiveSnapshot ? { previousActiveSnapshotId: previousActiveSnapshot.id } : {})
        });
        const objects = input.objects.map((object) => this.createObjectRecord(repositoryId, snapshot.id, object));
        const objectIdByKey = new Map(input.objects.map((object, index) => [object.objectKey, objects[index]?.id]));

        const persistedSnapshot = toCodeGraphSnapshotRecord((await entityFactory.save(CodeGraphSnapshot, snapshot)).toData());
        for (const object of objects) {
            await entityFactory.save(CodeObject, object);
        }
        for (const relation of input.relations) {
            const relationRecord = this.createRelationRecord(repositoryId, snapshot.id, relation, objectIdByKey);
            await entityFactory.relate(CodeRelation, relationRecord);
        }
        if (previousActiveSnapshot) {
            await entityFactory.save(CodeGraphSnapshot, {
                ...previousActiveSnapshot,
                status: 'replaced'
            });
        }
        const activeSnapshot = await entityFactory.save(CodeGraphSnapshot, {
            ...persistedSnapshot,
            status: 'active'
        });
        return await CodeGraphSnapshot.read({ id: activeSnapshot.id }, context);
    }

    private createObjectRecord(repositoryId: string, snapshotId: string, object: CodeGraphObjectDraft): CodeObjectRecord {
        const { objectKey, ...objectRecord } = object;
        return CodeObjectSchema.parse({
            ...objectRecord,
            id: createCodeGraphRecordId('code_object', `${snapshotId}:${objectKey}`),
            repositoryId,
            snapshotId
        });
    }

    private createRelationRecord(repositoryId: string, snapshotId: string, relation: CodeGraphRelationDraft, objectIdByKey: Map<string, string | undefined>): CodeRelationRecord {
        const { inObjectKey, outObjectKey, ...relationRecord } = relation;
        return CodeRelationSchema.parse({
            ...relationRecord,
            id: createCodeGraphRecordId('code_relation', `${snapshotId}:${inObjectKey}:${relation.relationKind}:${outObjectKey}`),
            repositoryId,
            snapshotId,
            in: requireObjectId(objectIdByKey, inObjectKey),
            out: requireObjectId(objectIdByKey, outObjectKey)
        });
    }

    private async readActiveSnapshot(context: EntityExecutionContext, input: EnsureCodeIndexInput): Promise<CodeGraphSnapshotRecord | undefined> {
        const [snapshot] = await CodeGraphSnapshot.find({
            repositoryId: resolveRepositoryId(input),
            rootPath: input.rootPath,
            status: 'active'
        }, context);
        return snapshot ? toCodeGraphSnapshotRecord(snapshot) : undefined;
    }

    public async stop(): Promise<void> {
        await Promise.resolve();
    }
}

function resolveRepositoryId(input: EnsureCodeIndexInput): string {
    return input.repositoryId?.trim() || Repository.deriveIdentity(input.rootPath).id;
}

function requireObjectId(objectIdByKey: Map<string, string | undefined>, objectKey: string): string {
    const objectId = objectIdByKey.get(objectKey);
    if (!objectId) {
        throw new Error(`Code graph relation references unindexed object '${objectKey}'.`);
    }
    return objectId;
}

function createCodeGraphExecutionContext(rootPath: string, entityFactory: Factory): EntityExecutionContext {
    return {
        surfacePath: rootPath,
        entityFactory
    };
}

function requireEntityFactory(context: EntityExecutionContext): Factory {
    if (!context.entityFactory) {
        throw new Error('CodeIntelligenceService requires an entityFactory execution context.');
    }
    return context.entityFactory;
}

function toCodeGraphSnapshotRecord(snapshot: CodeGraphIndexReadModel | CodeGraphSnapshotRecord): CodeGraphSnapshotRecord {
    return CodeGraphSnapshotRecordSchema.parse({
        id: snapshot.id,
        repositoryId: snapshot.repositoryId,
        codeRootId: snapshot.codeRootId,
        rootPath: snapshot.rootPath,
        rootFingerprint: snapshot.rootFingerprint,
        indexerVersion: snapshot.indexerVersion,
        indexedAt: snapshot.indexedAt,
        status: snapshot.status,
        objectCount: snapshot.objectCount,
        relationCount: snapshot.relationCount,
        ...(snapshot.previousActiveSnapshotId ? { previousActiveSnapshotId: snapshot.previousActiveSnapshotId } : {})
    });
}