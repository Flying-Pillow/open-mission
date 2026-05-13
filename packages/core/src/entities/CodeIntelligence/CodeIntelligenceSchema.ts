import { z } from 'zod/v4';

const nonEmptyStringSchema = z.string().trim().min(1);

export const CodeIntelligenceIndexSnapshotStatusSchema = z.enum(['candidate', 'active', 'replaced']);

export const CodeIntelligenceIndexSnapshotSchema = z.object({
    id: nonEmptyStringSchema,
    codeRootId: nonEmptyStringSchema,
    rootPath: nonEmptyStringSchema,
    rootFingerprint: nonEmptyStringSchema,
    indexerVersion: nonEmptyStringSchema,
    indexedAt: nonEmptyStringSchema,
    status: CodeIntelligenceIndexSnapshotStatusSchema,
    fileCount: z.number().int().nonnegative(),
    symbolCount: z.number().int().nonnegative(),
    relationCount: z.number().int().nonnegative(),
    previousActiveSnapshotId: nonEmptyStringSchema.optional()
}).strict();

export const CodeIntelligenceFileLanguageSchema = nonEmptyStringSchema;

export const CodeIntelligenceFileSchema = z.object({
    id: nonEmptyStringSchema,
    indexId: nonEmptyStringSchema,
    path: nonEmptyStringSchema,
    language: CodeIntelligenceFileLanguageSchema,
    sizeBytes: z.number().int().nonnegative(),
    contentHash: nonEmptyStringSchema
}).strict();

export const CodeIntelligenceSymbolKindSchema = z.enum(['class', 'function', 'interface', 'type', 'const', 'let', 'var']);

export const CodeIntelligenceSymbolSchema = z.object({
    id: nonEmptyStringSchema,
    indexId: nonEmptyStringSchema,
    fileId: nonEmptyStringSchema,
    filePath: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    kind: CodeIntelligenceSymbolKindSchema,
    exported: z.boolean(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive()
}).strict();

export const CodeIntelligenceRelationKindSchema = z.enum(['imports']);

export const CodeIntelligenceRelationSchema = z.object({
    id: nonEmptyStringSchema,
    indexId: nonEmptyStringSchema,
    fromFileId: nonEmptyStringSchema,
    fromFilePath: nonEmptyStringSchema,
    kind: CodeIntelligenceRelationKindSchema,
    target: nonEmptyStringSchema
}).strict();

export const CodeIntelligenceIndexSchema = z.object({
    snapshot: CodeIntelligenceIndexSnapshotSchema,
    files: z.array(CodeIntelligenceFileSchema),
    symbols: z.array(CodeIntelligenceSymbolSchema),
    relations: z.array(CodeIntelligenceRelationSchema)
}).strict();

export type CodeIntelligenceIndexSnapshotType = z.infer<typeof CodeIntelligenceIndexSnapshotSchema>;
export type CodeIntelligenceFileType = z.infer<typeof CodeIntelligenceFileSchema>;
export type CodeIntelligenceSymbolType = z.infer<typeof CodeIntelligenceSymbolSchema>;
export type CodeIntelligenceRelationType = z.infer<typeof CodeIntelligenceRelationSchema>;
export type CodeIntelligenceIndexType = z.infer<typeof CodeIntelligenceIndexSchema>;