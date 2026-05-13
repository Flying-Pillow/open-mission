import { createHash } from 'node:crypto';
import { z } from 'zod/v4';
import { compileDefineStatements, compileSchema, defineModel, field as surrealField, table as surrealTable } from '@flying-pillow/zod-surreal';
import type { CodeIntelligenceIndexType } from '../../../entities/CodeIntelligence/CodeIntelligenceSchema.js';

export const CODE_INDEXER_VERSION = 'mission-code-indexer-v1' as const;

const nonEmptyStringSchema = z.string().trim().min(1);

export const CodeIndexSnapshotStatusSchema = z.enum(['candidate', 'active', 'replaced']);

export const CodeIndexSnapshotSchema = z.object({
    id: nonEmptyStringSchema,
    codeRootId: nonEmptyStringSchema.register(surrealField, { index: 'normal' }),
    rootPath: nonEmptyStringSchema.register(surrealField, { index: 'normal' }),
    rootFingerprint: nonEmptyStringSchema.register(surrealField, { index: 'normal' }),
    indexerVersion: nonEmptyStringSchema.register(surrealField, { index: 'normal' }),
    indexedAt: nonEmptyStringSchema.register(surrealField, { type: 'datetime', index: 'normal' }),
    status: CodeIndexSnapshotStatusSchema.register(surrealField, { index: 'normal' }),
    fileCount: z.number().int().nonnegative().register(surrealField, { storage: true }),
    symbolCount: z.number().int().nonnegative().register(surrealField, { storage: true }),
    relationCount: z.number().int().nonnegative().register(surrealField, { storage: true }),
    previousActiveSnapshotId: nonEmptyStringSchema.optional().register(surrealField, { index: 'normal' })
}).strict().register(surrealTable, {
    table: 'code_index_snapshot',
    schemafull: true,
    comment: 'Derived code intelligence index snapshot for one Code root.'
});

export const CodeFileLanguageSchema = nonEmptyStringSchema;

export const CodeFileSchema = z.object({
    id: nonEmptyStringSchema,
    indexId: nonEmptyStringSchema.register(surrealField, { index: 'normal' }),
    path: nonEmptyStringSchema.register(surrealField, { index: 'normal' }),
    language: CodeFileLanguageSchema.register(surrealField, { index: 'normal' }),
    sizeBytes: z.number().int().nonnegative().register(surrealField, { storage: true }),
    contentHash: nonEmptyStringSchema.register(surrealField, { index: 'normal' })
}).strict().register(surrealTable, {
    table: 'code_file',
    schemafull: true,
    indexes: [{ name: 'code_file_index_path_idx', fields: ['indexId', 'path'], unique: true }],
    comment: 'Source file recorded in a derived Code intelligence index snapshot.'
});

export const CodeSymbolKindSchema = z.enum(['class', 'function', 'interface', 'type', 'const', 'let', 'var']);

export const CodeSymbolSchema = z.object({
    id: nonEmptyStringSchema,
    indexId: nonEmptyStringSchema.register(surrealField, { index: 'normal' }),
    fileId: nonEmptyStringSchema.register(surrealField, { index: 'normal' }),
    filePath: nonEmptyStringSchema.register(surrealField, { index: 'normal' }),
    name: nonEmptyStringSchema.register(surrealField, { searchable: true, index: 'normal' }),
    kind: CodeSymbolKindSchema.register(surrealField, { index: 'normal' }),
    exported: z.boolean().register(surrealField, { index: 'normal' }),
    startLine: z.number().int().positive().register(surrealField, { storage: true }),
    endLine: z.number().int().positive().register(surrealField, { storage: true })
}).strict().register(surrealTable, {
    table: 'code_symbol',
    schemafull: true,
    indexes: [{ name: 'code_symbol_index_name_idx', fields: ['indexId', 'name'] }],
    comment: 'Exported code symbol recorded in a derived Code intelligence index snapshot.'
});

export const CodeRelationKindSchema = z.enum(['imports']);

export const CodeRelationSchema = z.object({
    id: nonEmptyStringSchema,
    indexId: nonEmptyStringSchema.register(surrealField, { index: 'normal' }),
    fromFileId: nonEmptyStringSchema.register(surrealField, { index: 'normal' }),
    fromFilePath: nonEmptyStringSchema.register(surrealField, { index: 'normal' }),
    kind: CodeRelationKindSchema.register(surrealField, { index: 'normal' }),
    target: nonEmptyStringSchema.register(surrealField, { index: 'normal' })
}).strict().register(surrealTable, {
    table: 'code_relation',
    schemafull: true,
    indexes: [{ name: 'code_relation_index_from_target_idx', fields: ['indexId', 'fromFilePath', 'target'] }],
    comment: 'Typed code relationship recorded in a derived Code intelligence index snapshot.'
});

export type CodeIndexSnapshotRecord = z.infer<typeof CodeIndexSnapshotSchema>;
export type CodeFileRecord = z.infer<typeof CodeFileSchema>;
export type CodeSymbolRecord = z.infer<typeof CodeSymbolSchema>;
export type CodeRelationRecord = z.infer<typeof CodeRelationSchema>;
export type CodeGraphIndexReadModel = CodeIntelligenceIndexType;
export type CodeFileLanguage = z.infer<typeof CodeFileLanguageSchema>;
export type CodeSymbolKind = z.infer<typeof CodeSymbolKindSchema>;

export const CodeGraphModels = [
    defineModel({ name: 'CodeFile', schema: CodeFileSchema }),
    defineModel({ name: 'CodeIndexSnapshot', schema: CodeIndexSnapshotSchema }),
    defineModel({ name: 'CodeRelation', schema: CodeRelationSchema }),
    defineModel({ name: 'CodeSymbol', schema: CodeSymbolSchema })
];

export function compileCodeGraphSurql(): string {
    return `${compileDefineStatements(compileSchema({ models: CodeGraphModels }), { overwrite: true }).join('\n')}\n`;
}

export function createCodeRootId(rootPath: string): string {
    return `code-root-${hashForCodeGraphId(rootPath)}`;
}

export function createCodeGraphRecordId(table: 'code_index_snapshot' | 'code_file' | 'code_symbol' | 'code_relation', key: string): string {
    return `${table}:${hashForCodeGraphId(`${table}:${key}`)}`;
}

export function hashForCodeGraphId(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 32);
}