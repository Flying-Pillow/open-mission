import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import ignore, { type Ignore } from 'ignore';
import { CODE_INDEXER_VERSION, createCodeFileObjectKey, createCodeRootObjectKey, type CodeGraphObjectDraft, type CodeGraphRelationDraft, type CodeGraphReplaceIndexInput } from './CodeGraphSchema.js';
import { createDefaultCodeLanguageRegistry, type CodeLanguageRegistry } from './CodeLanguageRegistry.js';
import { createDefaultCodeExtractionProviders } from './TypeScriptCodeExtractionProvider.js';
import type { CodeExtractionProvider, CodeIndexedFileDraft } from './CodeExtractionProvider.js';

export type CodeIndexerResult = CodeGraphReplaceIndexInput;

type CodeIgnoreScope = {
    relativePath: string;
    matcher: Ignore;
};

const ENFORCED_SKIPPED_ROOT_NAMES = new Set(['.git', '.open-mission']);

const MAX_INDEXED_FILE_SIZE_BYTES = 1_000_000;

export class CodeIndexer {
    private readonly languageRegistry: CodeLanguageRegistry;
    private readonly extractionProviders: readonly CodeExtractionProvider[];

    public constructor(input: { languageRegistry?: CodeLanguageRegistry; extractionProviders?: readonly CodeExtractionProvider[] } = {}) {
        this.languageRegistry = input.languageRegistry ?? createDefaultCodeLanguageRegistry();
        this.extractionProviders = input.extractionProviders ?? createDefaultCodeExtractionProviders();
    }

    public async indexCodeRoot(input: { rootPath: string }): Promise<CodeIndexerResult> {
        const rootPath = path.resolve(input.rootPath.trim());
        if (!rootPath) {
            throw new Error('CodeIndexer requires a Code root path.');
        }
        const files = await this.readSourceFiles(rootPath);
        const rootObjectKey = createCodeRootObjectKey();
        const objects: CodeGraphObjectDraft[] = [
            {
                objectKey: rootObjectKey,
                objectKind: 'root',
                path: '.'
            },
            ...files.map((file) => ({
                objectKey: file.objectKey,
                objectKind: file.objectKind,
                path: file.path,
                language: file.language,
                sizeBytes: file.sizeBytes,
                contentHash: file.contentHash
            }))
        ];
        const relations: CodeGraphRelationDraft[] = files.map((file) => ({
            inObjectKey: rootObjectKey,
            relationKind: 'contains',
            outObjectKey: file.objectKey
        }));
        for (const file of files) {
            for (const provider of this.extractionProviders) {
                if (!provider.canExtract(file)) {
                    continue;
                }
                const result = await provider.extract({ rootPath, file, files });
                objects.push(...result.objects);
                relations.push(...result.relations);
                for (const object of result.objects) {
                    if (object.objectKind !== 'symbol') {
                        continue;
                    }
                    relations.push({
                        inObjectKey: file.objectKey,
                        relationKind: 'defines',
                        outObjectKey: object.objectKey
                    });
                }
            }
        }
        return {
            rootPath,
            rootFingerprint: createRootFingerprint(files),
            objects,
            relations
        };
    }

    private async readSourceFiles(rootPath: string): Promise<CodeIndexedFileDraft[]> {
        const files: CodeIndexedFileDraft[] = [];
        await this.walk(rootPath, rootPath, [], files);
        return files.sort((left, right) => left.path.localeCompare(right.path));
    }

    private async walk(rootPath: string, currentPath: string, parentIgnoreScopes: readonly CodeIgnoreScope[], files: CodeIndexedFileDraft[]): Promise<void> {
        const currentIgnoreScopes = await appendDirectoryIgnoreScope(rootPath, currentPath, parentIgnoreScopes);
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
            const absolutePath = path.join(currentPath, entry.name);
            const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join('/');
            if (shouldSkipByEnforcedRoot(relativePath) || isIgnoredByScopes(relativePath, entry.isDirectory(), currentIgnoreScopes)) {
                continue;
            }
            if (entry.isDirectory()) {
                await this.walk(rootPath, absolutePath, currentIgnoreScopes, files);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            const content = await readIndexableTextFile(absolutePath);
            if (content === undefined) {
                continue;
            }
            files.push({
                objectKey: createCodeFileObjectKey(relativePath),
                objectKind: classifyFileObjectKind(relativePath, this.languageRegistry.detectLanguage(relativePath)),
                path: relativePath,
                language: this.languageRegistry.detectLanguage(relativePath),
                sizeBytes: Buffer.byteLength(content, 'utf8'),
                contentHash: hashContent(content),
                content
            });
        }
    }
}

async function appendDirectoryIgnoreScope(rootPath: string, currentPath: string, parentIgnoreScopes: readonly CodeIgnoreScope[]): Promise<readonly CodeIgnoreScope[]> {
    const gitignorePath = path.join(currentPath, '.gitignore');
    const gitignoreContent = await readOptionalTextFile(gitignorePath);
    if (gitignoreContent === undefined) {
        return parentIgnoreScopes;
    }
    const relativePath = path.relative(rootPath, currentPath).split(path.sep).join('/');
    return [
        ...parentIgnoreScopes,
        {
            relativePath,
            matcher: ignore().add(gitignoreContent)
        }
    ];
}

async function readOptionalTextFile(filePath: string): Promise<string | undefined> {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch (error) {
        if (error && typeof error === 'object' && (error as { code?: string }).code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}

function shouldSkipByEnforcedRoot(relativePath: string): boolean {
    return relativePath.split('/').some((segment) => ENFORCED_SKIPPED_ROOT_NAMES.has(segment));
}

function isIgnoredByScopes(relativePath: string, isDirectory: boolean, ignoreScopes: readonly CodeIgnoreScope[]): boolean {
    let ignored = false;
    for (const scope of ignoreScopes) {
        const scopedPath = createScopedIgnorePath(relativePath, scope.relativePath, isDirectory);
        if (!scopedPath) {
            continue;
        }
        const result = scope.matcher.test(scopedPath);
        if (result.ignored) {
            ignored = true;
        }
        if (result.unignored) {
            ignored = false;
        }
    }
    return ignored;
}

function createScopedIgnorePath(relativePath: string, scopeRelativePath: string, isDirectory: boolean): string | undefined {
    if (scopeRelativePath && relativePath !== scopeRelativePath && !relativePath.startsWith(`${scopeRelativePath}/`)) {
        return undefined;
    }
    const scopedPath = scopeRelativePath ? relativePath.slice(scopeRelativePath.length + 1) : relativePath;
    if (!scopedPath) {
        return undefined;
    }
    return isDirectory ? `${scopedPath}/` : scopedPath;
}

async function readIndexableTextFile(filePath: string): Promise<string | undefined> {
    const fileStat = await fs.stat(filePath);
    if (fileStat.size > MAX_INDEXED_FILE_SIZE_BYTES) {
        return undefined;
    }
    const content = await fs.readFile(filePath);
    if (isLikelyBinary(content)) {
        return undefined;
    }
    return content.toString('utf8');
}

function isLikelyBinary(content: Buffer): boolean {
    const sample = content.subarray(0, Math.min(content.length, 8000));
    if (sample.includes(0)) {
        return true;
    }
    let controlByteCount = 0;
    for (const byte of sample) {
        const isAllowedControl = byte === 9 || byte === 10 || byte === 13 || byte === 27;
        if (byte < 32 && !isAllowedControl) {
            controlByteCount += 1;
        }
    }
    return sample.length > 0 && controlByteCount / sample.length > 0.3;
}

function createRootFingerprint(files: CodeIndexedFileDraft[]): string {
    const hash = createHash('sha256');
    hash.update(CODE_INDEXER_VERSION);
    for (const file of files) {
        hash.update('\0');
        hash.update(file.path);
        hash.update('\0');
        hash.update(file.language);
        hash.update('\0');
        hash.update(file.contentHash);
    }
    return hash.digest('hex');
}

function hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

function classifyFileObjectKind(filePath: string, language: string): 'file' | 'document' {
    if (language === 'markdown' || language === 'unknown' || filePath.endsWith('.md') || filePath.endsWith('.mdx')) {
        return 'document';
    }
    return 'file';
}