import { createHash } from 'node:crypto';
import { compileDefineStatements, compileSchema, defineModel } from '@flying-pillow/zod-surreal';
import {
    CodeGraphSnapshotSchema,
    CodeGraphSnapshotStatusSchema,
    CodeGraphSnapshotStorageSchema,
    type CodeGraphSnapshotType,
    type CodeGraphSnapshotStatusType,
    type CodeGraphSnapshotStorageType
} from '../../../entities/CodeGraphSnapshot/CodeGraphSnapshotSchema.js';
import {
    CodeFileLanguageSchema,
    CodeObjectKindSchema,
    CodeObjectStorageSchema,
    CodeSymbolKindSchema,
    type CodeFileLanguageType,
    type CodeObjectKindType,
    type CodeObjectStorageType,
    type CodeSymbolKindType
} from '../../../entities/CodeObject/CodeObjectSchema.js';
import {
    CodeRelationKindSchema,
    CodeRelationStorageSchema,
    type CodeRelationKindType,
    type CodeRelationStorageType
} from '../../../entities/CodeRelation/CodeRelationSchema.js';

export const CODE_INDEXER_VERSION = 'mission-code-indexer-v1' as const;

export const CodeGraphSnapshotRecordSchema = CodeGraphSnapshotStorageSchema;
export const CodeObjectSchema = CodeObjectStorageSchema;
export const CodeRelationSchema = CodeRelationStorageSchema;

export type CodeGraphSnapshotRecord = CodeGraphSnapshotStorageType;
export type CodeObjectRecord = CodeObjectStorageType;
export type CodeRelationRecord = CodeRelationStorageType;
export type CodeGraphIndexReadModel = CodeGraphSnapshotType;
export type CodeGraphSnapshotStatus = CodeGraphSnapshotStatusType;
export type CodeFileLanguage = CodeFileLanguageType;
export type CodeObjectKind = CodeObjectKindType;
export type CodeSymbolKind = CodeSymbolKindType;
export type CodeRelationKind = CodeRelationKindType;
export type CodeGraphObjectDraft = Omit<CodeObjectRecord, 'id' | 'snapshotId'> & {
    objectKey: string;
};
export type CodeGraphRelationDraft = Omit<CodeRelationRecord, 'id' | 'snapshotId' | 'in' | 'out'> & {
    inObjectKey: string;
    outObjectKey: string;
};
export type CodeGraphReplaceIndexInput = {
    rootPath: string;
    rootFingerprint: string;
    indexedAt?: string;
    objects: CodeGraphObjectDraft[];
    relations: CodeGraphRelationDraft[];
};

export const CodeGraphModels = [
    defineModel({ name: 'CodeGraphSnapshot', schema: CodeGraphSnapshotRecordSchema }),
    defineModel({ name: 'CodeObject', schema: CodeObjectSchema }),
    defineModel({ name: 'CodeRelation', schema: CodeRelationSchema })
];

export function compileCodeGraphSurql(): string {
    return `${compileDefineStatements(compileSchema({ models: CodeGraphModels }), { overwrite: true }).join('\n')}\n`;
}

export function createCodeRootId(rootPath: string): string {
    return `code-root-${hashForCodeGraphId(rootPath)}`;
}

export function createCodeGraphRecordId(table: 'code_graph_snapshot' | 'code_object' | 'code_relation', key: string): string {
    return `${table}:${hashForCodeGraphId(`${table}:${key}`)}`;
}

export function createCodeRootObjectKey(): string {
    return 'root';
}

export function createCodeFileObjectKey(filePath: string): string {
    return `path:${filePath}`;
}

export function createCodeSymbolObjectKey(input: { filePath: string; symbolKind: CodeSymbolKind; name: string; startLine: number }): string {
    return `symbol:${input.filePath}:${input.symbolKind}:${input.name}:${input.startLine}`;
}

export function hashForCodeGraphId(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

export {
    CodeGraphSnapshotStatusSchema,
    CodeObjectKindSchema,
    CodeFileLanguageSchema,
    CodeSymbolKindSchema,
    CodeRelationKindSchema
};