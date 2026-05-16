import * as ts from 'typescript';
import * as path from 'node:path';
import { createCodeFileObjectKey, createCodeSymbolObjectKey, type CodeSymbolKind } from './CodeGraphSchema.js';
import { createEmptyCodeExtractionResult, type CodeExtractionProvider, type CodeExtractionResult, type CodeIndexedFileDraft } from './CodeExtractionProvider.js';

const TYPESCRIPT_PROVIDER_LANGUAGES = ['typescript', 'tsx', 'javascript', 'jsx'] as const;

export class TypeScriptCodeExtractionProvider implements CodeExtractionProvider {
    public readonly id = 'typescript-compiler-api';
    public readonly languages = TYPESCRIPT_PROVIDER_LANGUAGES;
    public readonly capabilities = ['symbols', 'imports', 'types'] as const;

    public canExtract(file: CodeIndexedFileDraft): boolean {
        return TYPESCRIPT_PROVIDER_LANGUAGES.includes(file.language as (typeof TYPESCRIPT_PROVIDER_LANGUAGES)[number]);
    }

    public extract(input: { file: CodeIndexedFileDraft }): CodeExtractionResult {
        if (!this.canExtract(input.file)) {
            return createEmptyCodeExtractionResult();
        }
        return {
            objects: extractExportedSymbols(input.file),
            relations: extractImportRelations(input.file, input.files)
        };
    }
}

export function createDefaultCodeExtractionProviders(): CodeExtractionProvider[] {
    return [new TypeScriptCodeExtractionProvider()];
}

function extractExportedSymbols(file: CodeIndexedFileDraft): CodeExtractionResult['objects'] {
    const symbols: CodeExtractionResult['objects'] = [];
    const sourceFile = createSourceFile(file);
    sourceFile.forEachChild((node) => {
        if (ts.isClassDeclaration(node) && isExportedDeclaration(node)) {
            appendNamedSymbol(symbols, sourceFile, file.path, node, 'class', node.name?.text ?? 'default');
            return;
        }
        if (ts.isFunctionDeclaration(node) && isExportedDeclaration(node)) {
            appendNamedSymbol(symbols, sourceFile, file.path, node, 'function', node.name?.text ?? 'default');
            return;
        }
        if (ts.isInterfaceDeclaration(node) && isExportedDeclaration(node)) {
            appendNamedSymbol(symbols, sourceFile, file.path, node, 'interface', node.name.text);
            return;
        }
        if (ts.isTypeAliasDeclaration(node) && isExportedDeclaration(node)) {
            appendNamedSymbol(symbols, sourceFile, file.path, node, 'type', node.name.text);
            return;
        }
        if (ts.isVariableStatement(node) && isExportedDeclaration(node)) {
            const kind = readVariableStatementKind(node);
            for (const declaration of node.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name)) {
                    appendNamedSymbol(symbols, sourceFile, file.path, declaration, kind, declaration.name.text);
                }
            }
        }
    });
    return symbols;
}

function extractImportRelations(file: CodeIndexedFileDraft, files: readonly CodeIndexedFileDraft[]): CodeExtractionResult['relations'] {
    const relations: CodeExtractionResult['relations'] = [];
    const seenTargets = new Set<string>();

    function appendTarget(target: string): void {
        const trimmedTarget = target.trim();
        if (!trimmedTarget || seenTargets.has(trimmedTarget)) {
            return;
        }
        const resolvedTargetPath = resolveImportTargetPath({ fromFilePath: file.path, target: trimmedTarget, files });
        if (!resolvedTargetPath) {
            return;
        }
        seenTargets.add(trimmedTarget);
        relations.push({
            inObjectKey: createCodeFileObjectKey(file.path),
            relationKind: 'imports',
            outObjectKey: createCodeFileObjectKey(resolvedTargetPath)
        });
    }

    function visit(node: ts.Node): void {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            appendTarget(node.moduleSpecifier.text);
            return ts.forEachChild(node, visit);
        }

        if (ts.isCallExpression(node)
            && ts.isIdentifier(node.expression)
            && node.expression.text === 'require'
            && node.arguments.length === 1) {
            const [firstArgument] = node.arguments;
            if (firstArgument && ts.isStringLiteralLike(firstArgument)) {
                appendTarget(firstArgument.text);
            }
            return ts.forEachChild(node, visit);
        }

        if (ts.isImportTypeNode(node)
            && ts.isLiteralTypeNode(node.argument)
            && ts.isStringLiteral(node.argument.literal)) {
            appendTarget(node.argument.literal.text);
        }
        ts.forEachChild(node, visit);
    }

    visit(createSourceFile(file));
    return relations;
}

function createSourceFile(file: CodeIndexedFileDraft): ts.SourceFile {
    return ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, readScriptKind(file.path));
}

function readScriptKind(filePath: string): ts.ScriptKind {
    if (filePath.endsWith('.tsx')) {
        return ts.ScriptKind.TSX;
    }
    if (filePath.endsWith('.jsx')) {
        return ts.ScriptKind.JSX;
    }
    if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
        return ts.ScriptKind.JS;
    }
    return ts.ScriptKind.TS;
}

function isExportedDeclaration(node: ts.Node): boolean {
    return Boolean(ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export);
}

function readVariableStatementKind(node: ts.VariableStatement): Extract<CodeSymbolKind, 'const' | 'let' | 'var'> {
    const flags = node.declarationList.flags;
    if (flags & ts.NodeFlags.Const) {
        return 'const';
    }
    if (flags & ts.NodeFlags.Let) {
        return 'let';
    }
    return 'var';
}

function appendNamedSymbol(
    symbols: CodeExtractionResult['objects'],
    sourceFile: ts.SourceFile,
    filePath: string,
    node: ts.Node,
    kind: CodeSymbolKind,
    name: string
): void {
    const trimmedName = name.trim();
    if (!trimmedName) {
        return;
    }
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    symbols.push({
        objectKey: createCodeSymbolObjectKey({
            filePath,
            symbolKind: kind,
            name: trimmedName,
            startLine: start.line + 1
        }),
        objectKind: 'symbol',
        name: trimmedName,
        path: filePath,
        symbolKind: kind,
        exported: true,
        startLine: start.line + 1,
        endLine: end.line + 1
    });
}

function resolveImportTargetPath(input: { fromFilePath: string; target: string; files: readonly CodeIndexedFileDraft[] }): string | undefined {
    if (!input.target.startsWith('.')) {
        return undefined;
    }
    const knownPaths = new Set(input.files.map((file) => file.path));
    const basePath = path.posix.normalize(path.posix.join(path.posix.dirname(input.fromFilePath), input.target));
    for (const candidate of createImportResolutionCandidates(basePath)) {
        if (knownPaths.has(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

function createImportResolutionCandidates(basePath: string): string[] {
    const ext = path.posix.extname(basePath);
    const withoutExt = ext ? basePath.slice(0, -ext.length) : basePath;
    const directCandidates = ext
        ? [
            basePath,
            ...mapImportExtension(ext, withoutExt)
        ]
        : [withoutExt];
    const extensionCandidates = directCandidates.flatMap((candidate) => [
        candidate,
        `${candidate}.ts`,
        `${candidate}.tsx`,
        `${candidate}.js`,
        `${candidate}.jsx`,
        `${candidate}.mts`,
        `${candidate}.cts`,
        `${candidate}.mjs`,
        `${candidate}.cjs`,
        `${candidate}/index.ts`,
        `${candidate}/index.tsx`,
        `${candidate}/index.js`,
        `${candidate}/index.jsx`
    ]);
    return Array.from(new Set(extensionCandidates));
}

function mapImportExtension(ext: string, basePathWithoutExt: string): string[] {
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
        return [
            `${basePathWithoutExt}.ts`,
            `${basePathWithoutExt}.tsx`,
            `${basePathWithoutExt}.js`,
            `${basePathWithoutExt}.jsx`,
            `${basePathWithoutExt}.mts`,
            `${basePathWithoutExt}.cts`,
            `${basePathWithoutExt}.mjs`,
            `${basePathWithoutExt}.cjs`
        ];
    }
    return [];
}