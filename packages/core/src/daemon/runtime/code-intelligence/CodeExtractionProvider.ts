import type { CodeFileLanguage } from './CodeGraphSchema.js';
import type { CodeGraphObjectDraft, CodeGraphRelationDraft } from './CodeGraphSchema.js';

export type CodeIndexedFileDraft = {
    objectKey: string;
    objectKind: 'file' | 'document';
    path: string;
    language: CodeFileLanguage;
    sizeBytes: number;
    contentHash: string;
    content: string;
};

export type CodeExtractionCapability = 'symbols' | 'imports' | 'calls' | 'types' | 'routes' | 'tools' | 'scope-resolution';

export type CodeExtractionResult = {
    objects: CodeGraphObjectDraft[];
    relations: CodeGraphRelationDraft[];
};

export type CodeExtractionProvider = {
    id: string;
    languages: readonly CodeFileLanguage[];
    capabilities: readonly CodeExtractionCapability[];
    canExtract(file: CodeIndexedFileDraft): boolean;
    extract(input: { rootPath: string; file: CodeIndexedFileDraft; files: readonly CodeIndexedFileDraft[] }): Promise<CodeExtractionResult> | CodeExtractionResult;
};

export function createEmptyCodeExtractionResult(): CodeExtractionResult {
    return {
        objects: [],
        relations: []
    };
}