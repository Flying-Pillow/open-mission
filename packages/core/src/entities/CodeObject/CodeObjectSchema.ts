import { field, table } from '@flying-pillow/zod-surreal';
import { z } from 'zod/v4';
import { EntitySchema, EntityStorageSchema, IdSchema } from '../Entity/EntitySchema.js';

export const codeObjectEntityName = 'CodeObject' as const;
export const codeObjectTableName = 'code_object' as const;

const nonEmptyText = z.string().trim().min(1);
const codeObjectIdDescription = 'Canonical Entity id for one persisted code graph object.';
const repositoryIdDescription = 'Canonical Repository Entity id that owns this code graph object.';
const snapshotIdDescription = 'Canonical CodeGraphSnapshot Entity id that owns this code graph object.';
const objectKindDescription = 'Canonical object kind for this code graph node.';
const nameDescription = 'Optional bounded display or symbol name for this code graph object.';
const pathDescription = 'Optional repository-relative path associated with this code graph object.';
const languageDescription = 'Optional detected language associated with this code graph object.';
const symbolKindDescription = 'Optional symbol subtype when the object kind is symbol.';
const startLineDescription = 'Optional starting source line for this code graph object.';
const endLineDescription = 'Optional ending source line for this code graph object.';
const contentHashDescription = 'Optional content hash for file-like or document-like code graph objects.';
const sizeBytesDescription = 'Optional byte size for file-like or document-like code graph objects.';
const exportedDescription = 'Optional exported flag for symbol code graph objects.';

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

export const CodeObjectKindSchema = z.enum(['root', 'file', 'symbol', 'document']).meta({
    description: objectKindDescription
});

export const CodeFileLanguageSchema = describedText(languageDescription).meta({
    description: languageDescription
});

export const CodeSymbolKindSchema = z.enum(['class', 'function', 'interface', 'type', 'const', 'let', 'var']).meta({
    description: symbolKindDescription
});

export const CodeObjectLocatorSchema = z.object({
    id: IdSchema.clone().meta({
        description: codeObjectIdDescription
    })
}).strict().meta({
    description: 'Class-scoped selector for resolving one CodeObject by canonical Entity id.'
});

export const CodeObjectFindSchema = z.object({
    repositoryId: IdSchema.clone().meta({
        description: repositoryIdDescription
    }).optional(),
    snapshotId: describedText(snapshotIdDescription).optional(),
    objectKind: CodeObjectKindSchema.optional().meta({
        description: 'Optional object kind filter for CodeObject listing.'
    }),
    path: describedText(pathDescription).optional(),
    name: describedText(nameDescription).optional(),
    symbolKind: CodeSymbolKindSchema.optional().meta({
        description: 'Optional symbol subtype filter for CodeObject listing.'
    })
}).strict().meta({
    description: 'Class-scoped filter for listing persisted CodeObject records.'
});

export const CodeObjectStorageSchema = EntityStorageSchema.extend({
    id: IdSchema.clone().meta({ description: codeObjectIdDescription }).register(field, {
        description: codeObjectIdDescription
    }),
    repositoryId: IdSchema.clone().meta({ description: repositoryIdDescription }).register(field, {
        description: repositoryIdDescription
    }),
    snapshotId: storedText(snapshotIdDescription),
    objectKind: CodeObjectKindSchema.clone().register(field, {
        index: 'normal',
        description: objectKindDescription
    }),
    name: storedText(nameDescription, { optional: true, index: 'normal' }),
    path: storedText(pathDescription, { optional: true, index: 'normal' }),
    language: CodeFileLanguageSchema.clone().optional().register(field, {
        optional: true,
        description: languageDescription
    }),
    symbolKind: CodeSymbolKindSchema.clone().optional().register(field, {
        optional: true,
        description: symbolKindDescription
    }),
    startLine: z.number().int().positive().optional().meta({
        description: startLineDescription
    }).register(field, {
        optional: true,
        storage: true,
        description: startLineDescription
    }),
    endLine: z.number().int().positive().optional().meta({
        description: endLineDescription
    }).register(field, {
        optional: true,
        storage: true,
        description: endLineDescription
    }),
    contentHash: storedText(contentHashDescription, { optional: true }),
    sizeBytes: z.number().int().nonnegative().optional().meta({
        description: sizeBytesDescription
    }).register(field, {
        optional: true,
        storage: true,
        description: sizeBytesDescription
    }),
    exported: z.boolean().optional().meta({
        description: exportedDescription
    }).register(field, {
        optional: true,
        description: exportedDescription
    })
}).strict().meta({
    description: 'Canonical persisted storage record for one code graph object.'
}).register(table, {
    table: codeObjectTableName,
    schemafull: true,
    description: 'Canonical code graph object records.',
    indexes: [
        {
            name: 'code_object_repository_snapshot_kind_path_idx',
            fields: ['repositoryId', 'snapshotId', 'objectKind', 'path']
        },
        {
            name: 'code_object_repository_snapshot_kind_name_idx',
            fields: ['repositoryId', 'snapshotId', 'objectKind', 'name']
        }
    ]
});

export const CodeObjectDataSchema = CodeObjectStorageSchema.extend({}).strict().meta({
    description: 'Complete hydrated CodeObject Entity data.'
});

const CodeObjectDataPayloadSchema = CodeObjectDataSchema.omit({ id: true });

export const CodeObjectSchema = EntitySchema.extend({
    ...CodeObjectDataPayloadSchema.shape
}).strict().meta({
    description: 'First-class CodeObject Entity returned across the Entity boundary.'
});

export const CodeObjectCollectionSchema = z.array(CodeObjectSchema).meta({
    description: 'Collection of CodeObject Entities returned by object listing queries.'
});

export type CodeObjectKindType = z.infer<typeof CodeObjectKindSchema>;
export type CodeFileLanguageType = z.infer<typeof CodeFileLanguageSchema>;
export type CodeSymbolKindType = z.infer<typeof CodeSymbolKindSchema>;
export type CodeObjectLocatorType = z.infer<typeof CodeObjectLocatorSchema>;
export type CodeObjectFindType = z.infer<typeof CodeObjectFindSchema>;
export type CodeObjectStorageType = z.infer<typeof CodeObjectStorageSchema>;
export type CodeObjectDataType = z.infer<typeof CodeObjectDataSchema>;
export type CodeObjectType = z.infer<typeof CodeObjectSchema>;
export type CodeObjectCollectionType = z.infer<typeof CodeObjectCollectionSchema>;
