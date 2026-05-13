import type { CodeFileLanguage } from './CodeGraphSchema.js';
import type { CodeGraphReplaceIndexInput } from './CodeGraphStore.js';

export type CodeIndexedFileDraft = CodeGraphReplaceIndexInput['files'][number] & {
    content: string;
};

export type CodeExtractionCapability = 'symbols' | 'imports' | 'calls' | 'types' | 'routes' | 'tools' | 'scope-resolution';

export type CodeExtractionResult = {
    symbols: CodeGraphReplaceIndexInput['symbols'];
    relations: CodeGraphReplaceIndexInput['relations'];
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
        symbols: [],
        relations: []
    };
}