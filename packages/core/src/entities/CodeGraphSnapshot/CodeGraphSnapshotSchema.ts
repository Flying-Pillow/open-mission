import { field, table } from '@flying-pillow/zod-surreal';
import { z } from 'zod/v4';
import { CodeObjectSchema } from '../CodeObject/CodeObjectSchema.js';
import { CodeRelationSchema } from '../CodeRelation/CodeRelationSchema.js';
import { EntitySchema, EntityStorageSchema, IdSchema } from '../Entity/EntitySchema.js';

export const codeGraphSnapshotEntityName = 'CodeGraphSnapshot' as const;
export const codeGraphSnapshotTableName = 'code_graph_snapshot' as const;

const nonEmptyText = z.string().trim().min(1);
const codeGraphSnapshotIdDescription = 'Canonical Entity id for one persisted code graph snapshot.';
const repositoryIdDescription = 'Canonical Repository Entity id that owns this persisted code graph snapshot.';
const codeRootIdDescription = 'Stable code-root discriminator used to group snapshots for one indexed repository root.';
const rootPathDescription = 'Absolute repository root path that was indexed to produce this snapshot.';
const rootFingerprintDescription = 'Deterministic fingerprint of the indexed root contents for this snapshot.';
const indexerVersionDescription = 'Canonical code indexer version that produced this snapshot.';
const indexedAtDescription = 'Timestamp string recorded when this snapshot was built.';
const objectCountDescription = 'Number of code graph objects stored for this snapshot.';
const relationCountDescription = 'Number of code graph relations stored for this snapshot.';
const previousActiveSnapshotIdDescription = 'Optional prior active snapshot id replaced by this snapshot.';

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

export const CodeGraphSnapshotStatusSchema = z.enum(['candidate', 'active', 'replaced']).meta({
    description: 'Lifecycle status for one persisted code graph snapshot.'
});

export const CodeGraphSnapshotLocatorSchema = z.object({
    id: IdSchema.clone().meta({
        description: codeGraphSnapshotIdDescription
    })
}).strict().meta({
    description: 'Class-scoped selector for resolving one code graph snapshot by canonical Entity id.'
});

export const CodeGraphSnapshotFindSchema = z.object({
    repositoryId: IdSchema.clone().meta({
        description: repositoryIdDescription
    }).optional(),
    rootPath: describedText(rootPathDescription).optional(),
    status: CodeGraphSnapshotStatusSchema.optional().meta({
        description: 'Optional snapshot status filter for snapshot listing.'
    })
}).strict().meta({
    description: 'Class-scoped filter for listing persisted code graph snapshots.'
});

export const CodeGraphSnapshotStorageSchema = EntityStorageSchema.extend({
    id: IdSchema.clone().meta({ description: codeGraphSnapshotIdDescription }).register(field, {
        description: codeGraphSnapshotIdDescription
    }),
    repositoryId: IdSchema.clone().meta({ description: repositoryIdDescription }).register(field, {
        description: repositoryIdDescription
    }),
    codeRootId: storedText(codeRootIdDescription, { index: 'normal' }),
    rootPath: storedText(rootPathDescription, { index: 'normal' }),
    rootFingerprint: storedText(rootFingerprintDescription, { index: 'normal' }),
    indexerVersion: storedText(indexerVersionDescription, { index: 'normal' }),
    indexedAt: storedText(indexedAtDescription, { index: 'normal' }),
    status: CodeGraphSnapshotStatusSchema.clone().meta({
        description: 'Persisted lifecycle status for this code graph snapshot.'
    }).register(field, {
        index: 'normal',
        description: 'Persisted lifecycle status for this code graph snapshot.'
    }),
    objectCount: z.number().int().nonnegative().meta({
        description: objectCountDescription
    }).register(field, {
        storage: true,
        description: objectCountDescription
    }),
    relationCount: z.number().int().nonnegative().meta({
        description: relationCountDescription
    }).register(field, {
        storage: true,
        description: relationCountDescription
    }),
    previousActiveSnapshotId: storedText(previousActiveSnapshotIdDescription, { optional: true })
}).strict().meta({
    description: 'Canonical persisted storage record for one code graph snapshot.'
}).register(table, {
    table: codeGraphSnapshotTableName,
    schemafull: true,
    description: 'Canonical code graph snapshot records.',
    indexes: [
        {
            name: 'code_graph_snapshot_repository_root_status_indexed_at_idx',
            fields: ['repositoryId', 'codeRootId', 'status', 'indexedAt']
        }
    ]
});

export const CodeGraphSnapshotSchema = EntitySchema.extend({
    ...CodeGraphSnapshotStorageSchema.shape,
    objects: z.array(CodeObjectSchema).default([]).meta({
        description: 'Hydrated CodeObject Entities owned by this CodeGraphSnapshot.'
    }),
    relations: z.array(CodeRelationSchema).default([]).meta({
        description: 'Hydrated CodeRelation Entities owned by this CodeGraphSnapshot.'
    })
}).strict().meta({
    description: 'First-class CodeGraphSnapshot Entity returned across the Entity boundary.'
});

export const CodeGraphSnapshotCollectionSchema = z.array(CodeGraphSnapshotSchema).meta({
    description: 'Collection of CodeGraphSnapshot Entities returned by snapshot listing queries.'
});

export type CodeGraphSnapshotStatusType = z.infer<typeof CodeGraphSnapshotStatusSchema>;
export type CodeGraphSnapshotLocatorType = z.infer<typeof CodeGraphSnapshotLocatorSchema>;
export type CodeGraphSnapshotFindType = z.infer<typeof CodeGraphSnapshotFindSchema>;
export type CodeGraphSnapshotStorageType = z.infer<typeof CodeGraphSnapshotStorageSchema>;
export type CodeGraphSnapshotType = z.infer<typeof CodeGraphSnapshotSchema>;
export type CodeGraphSnapshotCollectionType = z.infer<typeof CodeGraphSnapshotCollectionSchema>;
