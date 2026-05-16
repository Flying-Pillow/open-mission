import { field, table } from '@flying-pillow/zod-surreal';
import { z } from 'zod/v4';
import { EntitySchema, EntityStorageSchema, IdSchema } from '../Entity/EntitySchema.js';

export const codeRelationEntityName = 'CodeRelation' as const;
export const codeRelationTableName = 'code_relation' as const;

const nonEmptyText = z.string().trim().min(1);
const codeRelationIdDescription = 'Canonical Entity id for one persisted code graph relation.';
const repositoryIdDescription = 'Canonical Repository Entity id that owns this code graph relation.';
const snapshotIdDescription = 'Canonical CodeGraphSnapshot Entity id that owns this code graph relation.';
const relationKindDescription = 'Canonical relation kind for this code graph edge.';
const inDescription = 'Canonical CodeObject Entity id at the IN endpoint of this relation.';
const outDescription = 'Canonical CodeObject Entity id at the OUT endpoint of this relation.';
const orderDescription = 'Optional deterministic order for ordered code graph relations.';
const weightDescription = 'Optional bounded weight for weighted code graph relations.';
const isTypeOnlyDescription = 'Optional flag showing whether this relation only applies in type space.';
const isExportDescription = 'Optional flag showing whether this relation is export-scoped.';

function describedText(description: string) {
    return nonEmptyText.clone().meta({ description });
}

function storedText(description: string, options: { index?: 'normal'; optional?: boolean } = {}) {
    const schema = options.optional ? describedText(description).optional() : describedText(description);
    return schema.register(field, {
        ...(options.index ? { index: options.index } : {}),
        ...(options.optional ? { optional: true } : {}),
        description
    });
}

export const CodeRelationKindSchema = z.enum(['contains', 'defines', 'imports', 'calls']).meta({
    description: relationKindDescription
});

export const CodeRelationLocatorSchema = z.object({
    id: IdSchema.clone().meta({
        description: codeRelationIdDescription
    })
}).strict().meta({
    description: 'Class-scoped selector for resolving one CodeRelation by canonical Entity id.'
});

export const CodeRelationFindSchema = z.object({
    repositoryId: IdSchema.clone().meta({
        description: repositoryIdDescription
    }).optional(),
    snapshotId: describedText(snapshotIdDescription).optional(),
    relationKind: CodeRelationKindSchema.optional().meta({
        description: 'Optional relation kind filter for CodeRelation listing.'
    }),
    in: describedText(inDescription).optional(),
    out: describedText(outDescription).optional()
}).strict().meta({
    description: 'Class-scoped filter for listing persisted CodeRelation records.'
});

export const CodeRelationStorageSchema = EntityStorageSchema.extend({
    id: IdSchema.clone().meta({ description: codeRelationIdDescription }).register(field, {
        description: codeRelationIdDescription
    }),
    repositoryId: IdSchema.clone().meta({ description: repositoryIdDescription }).register(field, {
        description: repositoryIdDescription
    }),
    snapshotId: storedText(snapshotIdDescription),
    relationKind: CodeRelationKindSchema.clone().register(field, {
        index: 'normal',
        description: relationKindDescription
    }),
    in: storedText(inDescription),
    out: storedText(outDescription),
    order: z.number().int().nonnegative().optional().meta({
        description: orderDescription
    }).register(field, {
        optional: true,
        storage: true,
        description: orderDescription
    }),
    weight: z.number().nonnegative().optional().meta({
        description: weightDescription
    }).register(field, {
        optional: true,
        storage: true,
        description: weightDescription
    }),
    isTypeOnly: z.boolean().optional().meta({
        description: isTypeOnlyDescription
    }).register(field, {
        optional: true,
        description: isTypeOnlyDescription
    }),
    isExport: z.boolean().optional().meta({
        description: isExportDescription
    }).register(field, {
        optional: true,
        description: isExportDescription
    })
}).strict().meta({
    description: 'Canonical persisted storage record for one code graph relation.'
}).register(table, {
    table: codeRelationTableName,
    kind: 'relation',
    from: 'code_object',
    to: 'code_object',
    schemafull: true,
    description: 'Canonical code graph relation records.',
    indexes: [
        {
            name: 'code_relation_repository_snapshot_in_out_idx',
            fields: ['repositoryId', 'snapshotId', 'in', 'out', 'relationKind']
        }
    ]
});

export const CodeRelationDataSchema = CodeRelationStorageSchema.extend({}).strict().meta({
    description: 'Complete hydrated CodeRelation Entity data.'
});

const CodeRelationDataPayloadSchema = CodeRelationDataSchema.omit({ id: true });

export const CodeRelationSchema = EntitySchema.extend({
    ...CodeRelationDataPayloadSchema.shape
}).strict().meta({
    description: 'First-class CodeRelation Entity returned across the Entity boundary.'
});

export const CodeRelationCollectionSchema = z.array(CodeRelationSchema).meta({
    description: 'Collection of CodeRelation Entities returned by relation listing queries.'
});

export type CodeRelationKindType = z.infer<typeof CodeRelationKindSchema>;
export type CodeRelationLocatorType = z.infer<typeof CodeRelationLocatorSchema>;
export type CodeRelationFindType = z.infer<typeof CodeRelationFindSchema>;
export type CodeRelationStorageType = z.infer<typeof CodeRelationStorageSchema>;
export type CodeRelationDataType = z.infer<typeof CodeRelationDataSchema>;
export type CodeRelationType = z.infer<typeof CodeRelationSchema>;
export type CodeRelationCollectionType = z.infer<typeof CodeRelationCollectionSchema>;
