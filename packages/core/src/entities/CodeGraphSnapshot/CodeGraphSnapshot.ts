import { Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import { CodeObject } from '../CodeObject/CodeObject.js';
import { CodeRelation } from '../CodeRelation/CodeRelation.js';
import {
    codeGraphSnapshotEntityName,
    CodeGraphSnapshotFindSchema,
    CodeGraphSnapshotLocatorSchema,
    CodeGraphSnapshotSchema,
    CodeGraphSnapshotStorageSchema,
    type CodeGraphSnapshotStorageType,
    type CodeGraphSnapshotType,
    type CodeGraphSnapshotCollectionType
} from './CodeGraphSnapshotSchema.js';

export class CodeGraphSnapshot extends Entity<CodeGraphSnapshotType, string> {
    public static override readonly entityName = codeGraphSnapshotEntityName;
    public static readonly storageSchema = CodeGraphSnapshotStorageSchema;

    public constructor(data: CodeGraphSnapshotStorageType | CodeGraphSnapshotType) {
        super(CodeGraphSnapshotSchema.parse(data));
    }

    public override get id(): string {
        return this.data.id;
    }

    public static async read(payload: unknown, context?: EntityExecutionContext): Promise<CodeGraphSnapshotType> {
        const input = CodeGraphSnapshotLocatorSchema.parse(payload);
        const entity = await CodeGraphSnapshot._read(context, input.id);
        if (!entity) {
            throw new Error(`CodeGraphSnapshot '${input.id}' was not found.`);
        }
        return await CodeGraphSnapshot.hydrate(entity.toData(), context);
    }

    public static async find(payload: unknown, context?: EntityExecutionContext): Promise<CodeGraphSnapshotCollectionType> {
        const input = CodeGraphSnapshotFindSchema.parse(payload);
        const where = [] as Array<{ field: string; operator: '='; value: string }>;
        if (input.repositoryId) {
            where.push({ field: 'repositoryId', operator: '=', value: input.repositoryId });
        }
        if (input.rootPath) {
            where.push({ field: 'rootPath', operator: '=', value: input.rootPath });
        }
        if (input.status) {
            where.push({ field: 'status', operator: '=', value: input.status });
        }
        const result = await CodeGraphSnapshot._find(context, {
            ...(where.length > 0 ? { where } : {}),
            orderBy: [{ field: 'indexedAt', direction: 'DESC' }]
        });
        return await Promise.all(result.entities.map((entity) => CodeGraphSnapshot.hydrate(entity.toData(), context)));
    }

    private static async hydrate(snapshot: CodeGraphSnapshotType, context?: EntityExecutionContext): Promise<CodeGraphSnapshotType> {
        const [objects, relations] = await Promise.all([
            CodeObject.find({ snapshotId: snapshot.id }, context),
            CodeRelation.find({ snapshotId: snapshot.id }, context)
        ]);
        return CodeGraphSnapshotSchema.parse({
            ...snapshot,
            objects,
            relations
        });
    }
}
