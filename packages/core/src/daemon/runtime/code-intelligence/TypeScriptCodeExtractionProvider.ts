import * as ts from 'typescript';
import type { CodeSymbolKind } from './CodeGraphSchema.js';
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
            symbols: extractExportedSymbols(input.file),
            relations: extractImportRelations(input.file)
        };
    }
}

export function createDefaultCodeExtractionProviders(): CodeExtractionProvider[] {
    return [new TypeScriptCodeExtractionProvider()];
}

function extractExportedSymbols(file: CodeIndexedFileDraft): CodeExtractionResult['symbols'] {
    const symbols: CodeExtractionResult['symbols'] = [];
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

function extractImportRelations(file: CodeIndexedFileDraft): CodeExtractionResult['relations'] {
    const relations: CodeExtractionResult['relations'] = [];
    const seenTargets = new Set<string>();

    function appendTarget(target: string): void {
        const trimmedTarget = target.trim();
        if (!trimmedTarget || seenTargets.has(trimmedTarget)) {
            return;
        }
        seenTargets.add(trimmedTarget);
        relations.push({
            fromFilePath: file.path,
            kind: 'imports',
            target: trimmedTarget
        });
    }

    function visit(node: ts.Node): void {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            appendTarget(node.moduleSpecifier.text);
        } else if (ts.isCallExpression(node)
            && ts.isIdentifier(node.expression)
            && node.expression.text === 'require'
            && node.arguments.length === 1
            && ts.isStringLiteralLike(node.arguments[0])) {
            appendTarget(node.arguments[0].text);
        } else if (ts.isImportTypeNode(node)
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
    symbols: CodeExtractionResult['symbols'],
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
        filePath,
        name: trimmedName,
        kind,
        exported: true,
        startLine: start.line + 1,
        endLine: end.line + 1
    });
}