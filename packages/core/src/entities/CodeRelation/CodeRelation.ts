import { Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import {
    codeRelationEntityName,
    CodeRelationDataSchema,
    CodeRelationFindSchema,
    CodeRelationLocatorSchema,
    CodeRelationStorageSchema,
    type CodeRelationCollectionType,
    type CodeRelationDataType
} from './CodeRelationSchema.js';

export class CodeRelation extends Entity<CodeRelationDataType, string> {
    public static override readonly entityName = codeRelationEntityName;
    public static readonly storageSchema = CodeRelationStorageSchema;

    public constructor(data: CodeRelationDataType) {
        super(CodeRelationDataSchema.parse(data));
    }

    public override get id(): string {
        return this.data.id;
    }

    public static async read(payload: unknown, context?: EntityExecutionContext): Promise<CodeRelationDataType> {
        const input = CodeRelationLocatorSchema.parse(payload);
        const entity = await CodeRelation._read(context, input.id);
        if (!entity) {
            throw new Error(`CodeRelation '${input.id}' was not found.`);
        }
        return entity.toData();
    }

    public static async find(payload: unknown, context?: EntityExecutionContext): Promise<CodeRelationCollectionType> {
        const input = CodeRelationFindSchema.parse(payload);
        const where = [] as Array<{ field: string; operator: '='; value: string }>;
        if (input.snapshotId) {
            where.push({ field: 'snapshotId', operator: '=', value: input.snapshotId });
        }
        if (input.relationKind) {
            where.push({ field: 'relationKind', operator: '=', value: input.relationKind });
        }
        if (input.in) {
            where.push({ field: 'in', operator: '=', value: input.in });
        }
        if (input.out) {
            where.push({ field: 'out', operator: '=', value: input.out });
        }
        const result = await CodeRelation._find(context, {
            ...(where.length > 0 ? { where } : {}),
            orderBy: [
                { field: 'in', direction: 'ASC' },
                { field: 'out', direction: 'ASC' },
                { field: 'relationKind', direction: 'ASC' }
            ]
        });
        return result.entities.map((entity) => entity.toData());
    }
}
