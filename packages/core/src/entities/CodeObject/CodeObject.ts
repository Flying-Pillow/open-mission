import { Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import {
    codeObjectEntityName,
    CodeObjectDataSchema,
    CodeObjectFindSchema,
    CodeObjectLocatorSchema,
    CodeObjectStorageSchema,
    type CodeObjectCollectionType,
    type CodeObjectDataType
} from './CodeObjectSchema.js';

export class CodeObject extends Entity<CodeObjectDataType, string> {
    public static override readonly entityName = codeObjectEntityName;
    public static readonly storageSchema = CodeObjectStorageSchema;

    public constructor(data: CodeObjectDataType) {
        super(CodeObjectDataSchema.parse(data));
    }

    public override get id(): string {
        return this.data.id;
    }

    public static async read(payload: unknown, context?: EntityExecutionContext): Promise<CodeObjectDataType> {
        const input = CodeObjectLocatorSchema.parse(payload);
        const entity = await CodeObject._read(context, input.id);
        if (!entity) {
            throw new Error(`CodeObject '${input.id}' was not found.`);
        }
        return entity.toData();
    }

    public static async find(payload: unknown, context?: EntityExecutionContext): Promise<CodeObjectCollectionType> {
        const input = CodeObjectFindSchema.parse(payload);
        const where = [] as Array<{ field: string; operator: '='; value: string }>;
        if (input.snapshotId) {
            where.push({ field: 'snapshotId', operator: '=', value: input.snapshotId });
        }
        if (input.objectKind) {
            where.push({ field: 'objectKind', operator: '=', value: input.objectKind });
        }
        if (input.path) {
            where.push({ field: 'path', operator: '=', value: input.path });
        }
        if (input.name) {
            where.push({ field: 'name', operator: '=', value: input.name });
        }
        if (input.symbolKind) {
            where.push({ field: 'symbolKind', operator: '=', value: input.symbolKind });
        }
        const result = await CodeObject._find(context, {
            ...(where.length > 0 ? { where } : {}),
            orderBy: [
                { field: 'path', direction: 'ASC' },
                { field: 'name', direction: 'ASC' },
                { field: 'startLine', direction: 'ASC' }
            ]
        });
        return result.entities.map((entity) => entity.toData());
    }
}
