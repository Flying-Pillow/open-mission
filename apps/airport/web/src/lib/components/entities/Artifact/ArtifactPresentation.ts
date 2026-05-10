export type ArtifactViewerKind = 'markdown' | 'image' | 'svg' | 'text' | 'unsupported';

const jsonlMediaTypes = new Set([
    'application/jsonl',
    'application/x-ndjson',
    'application/x-jsonlines',
    'application/x-jsonl',
    'text/jsonl',
    'text/x-jsonl'
]);

const imageArtifactExtensions = new Set([
    '.avif',
    '.bmp',
    '.gif',
    '.ico',
    '.jpg',
    '.jpeg',
    '.png',
    '.svg',
    '.tif',
    '.tiff',
    '.webp'
]);

const monacoLanguagesByExtension = new Map<string, string>([
    ['.css', 'css'],
    ['.html', 'html'],
    ['.js', 'javascript'],
    ['.mjs', 'javascript'],
    ['.cjs', 'javascript'],
    ['.json', 'json'],
    ['.jsonl', 'json'],
    ['.md', 'markdown'],
    ['.markdown', 'markdown'],
    ['.mts', 'typescript'],
    ['.cts', 'typescript'],
    ['.svg', 'xml'],
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
    if (isJsonlMediaType(fileNameOrPath)) {
        return 'text';
    }

    const extension = resolveExtension(fileNameOrPath);
    if (extension === '.md' || extension === '.markdown') {
        return 'markdown';
    }

    if (extension === '.svg') {
        return 'svg';
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
    if (isJsonlMediaType(fileNameOrPath)) {
        return true;
    }

    return textArtifactExtensions.has(resolveExtension(fileNameOrPath));
}

export function resolveMonacoLanguage(fileNameOrPath: string | undefined): string {
    if (isJsonlMediaType(fileNameOrPath)) {
        return 'json';
    }

    return monacoLanguagesByExtension.get(resolveExtension(fileNameOrPath)) ?? 'plaintext';
}

export function resolveArtifactIcon(fileNameOrPath: string | undefined, mediaType?: string): string {
    const normalizedMediaType = mediaType?.trim().toLowerCase();
    if (normalizedMediaType?.startsWith('image/')) {
        return 'lucide:image';
    }

    const viewerKind = resolveArtifactViewerKind(fileNameOrPath);
    if (viewerKind === 'image') {
        return 'lucide:image';
    }

    const extension = resolveExtension(fileNameOrPath);
    if (extension === '.json' || extension === '.jsonl') {
        return 'lucide:file-json';
    }

    if (extension === '.md' || extension === '.markdown' || extension === '.txt') {
        return 'lucide:file-text';
    }

    if (monacoLanguagesByExtension.has(extension)) {
        return 'lucide:file-code';
    }

    return 'lucide:file';
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

function isJsonlMediaType(value: string | undefined): boolean {
    const normalizedValue = value?.trim().toLowerCase();
    if (!normalizedValue) {
        return false;
    }

    const [mediaType] = normalizedValue.split(';', 1);
    return jsonlMediaTypes.has(mediaType);
}