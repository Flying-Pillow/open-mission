export type ArtifactViewerKind = 'markdown' | 'image' | 'text' | 'unsupported';

const imageArtifactExtensions = new Set([
    '.gif',
    '.jpg',
    '.jpeg',
    '.png',
    '.svg',
    '.webp'
]);

const monacoLanguagesByExtension = new Map<string, string>([
    ['.css', 'css'],
    ['.html', 'html'],
    ['.js', 'javascript'],
    ['.mjs', 'javascript'],
    ['.cjs', 'javascript'],
    ['.json', 'json'],
    ['.md', 'markdown'],
    ['.markdown', 'markdown'],
    ['.mts', 'typescript'],
    ['.cts', 'typescript'],
    ['.svelte', 'html'],
    ['.ts', 'typescript'],
    ['.xml', 'xml'],
    ['.yaml', 'yaml'],
    ['.yml', 'yaml']
]);

const textArtifactExtensions = new Set([
    ...monacoLanguagesByExtension.keys(),
    '.txt'
]);

export function resolveArtifactViewerKind(fileNameOrPath: string | undefined): ArtifactViewerKind {
    const extension = resolveExtension(fileNameOrPath);
    if (extension === '.md' || extension === '.markdown') {
        return 'markdown';
    }

    if (imageArtifactExtensions.has(extension)) {
        return 'image';
    }

    if (isArtifactTextEditable(fileNameOrPath)) {
        return 'text';
    }

    return 'unsupported';
}

export function isArtifactTextEditable(fileNameOrPath: string | undefined): boolean {
    return textArtifactExtensions.has(resolveExtension(fileNameOrPath));
}

export function resolveMonacoLanguage(fileNameOrPath: string | undefined): string {
    return monacoLanguagesByExtension.get(resolveExtension(fileNameOrPath)) ?? 'plaintext';
}

function resolveExtension(fileNameOrPath: string | undefined): string {
    const normalized = fileNameOrPath?.trim().toLowerCase();
    if (!normalized) {
        return '';
    }

    const basename = normalized.split(/[\\/]/u).pop() ?? normalized;
    const extensionStart = basename.lastIndexOf('.');
    return extensionStart > -1 ? basename.slice(extensionStart) : '';
}