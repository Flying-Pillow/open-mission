import * as path from 'node:path';
import type { CodeFileLanguage } from './CodeGraphSchema.js';

export type CodeLanguageDefinition = {
    language: CodeFileLanguage;
    extensions?: readonly string[];
    filenames?: readonly string[];
};

const DEFAULT_LANGUAGE_DEFINITIONS: readonly CodeLanguageDefinition[] = [
    { language: 'typescript', extensions: ['.ts', '.mts', '.cts'] },
    { language: 'tsx', extensions: ['.tsx'] },
    { language: 'javascript', extensions: ['.js', '.mjs', '.cjs'] },
    { language: 'jsx', extensions: ['.jsx'] },
    { language: 'python', extensions: ['.py', '.pyw'] },
    { language: 'java', extensions: ['.java'] },
    { language: 'kotlin', extensions: ['.kt', '.kts'] },
    { language: 'go', extensions: ['.go'] },
    { language: 'rust', extensions: ['.rs'] },
    { language: 'c', extensions: ['.c', '.h'] },
    { language: 'cpp', extensions: ['.cc', '.cpp', '.cxx', '.hh', '.hpp', '.hxx'] },
    { language: 'csharp', extensions: ['.cs'] },
    { language: 'php', extensions: ['.php'] },
    { language: 'ruby', extensions: ['.rb'], filenames: ['Gemfile', 'Rakefile'] },
    { language: 'swift', extensions: ['.swift'] },
    { language: 'dart', extensions: ['.dart'] },
    { language: 'vue', extensions: ['.vue'] },
    { language: 'svelte', extensions: ['.svelte'] },
    { language: 'cobol', extensions: ['.cbl', '.cob', '.cobol', '.cpy'] },
    { language: 'markdown', extensions: ['.md', '.mdx'], filenames: ['README', 'CHANGELOG'] },
    { language: 'json', extensions: ['.json', '.jsonc'] },
    { language: 'yaml', extensions: ['.yaml', '.yml'] },
    { language: 'toml', extensions: ['.toml'] },
    { language: 'shell', extensions: ['.sh', '.bash', '.zsh'], filenames: ['Dockerfile'] },
    { language: 'sql', extensions: ['.sql'] },
    { language: 'html', extensions: ['.html', '.htm'] },
    { language: 'css', extensions: ['.css'] },
    { language: 'scss', extensions: ['.scss'] },
    { language: 'protobuf', extensions: ['.proto'] },
    { language: 'xml', extensions: ['.xml'] }
];

export class CodeLanguageRegistry {
    private readonly languageByExtension = new Map<string, CodeFileLanguage>();
    private readonly languageByFilename = new Map<string, CodeFileLanguage>();

    public constructor(definitions: readonly CodeLanguageDefinition[] = DEFAULT_LANGUAGE_DEFINITIONS) {
        for (const definition of definitions) {
            for (const extension of definition.extensions ?? []) {
                this.languageByExtension.set(extension.toLowerCase(), definition.language);
            }
            for (const filename of definition.filenames ?? []) {
                this.languageByFilename.set(filename.toLowerCase(), definition.language);
            }
        }
    }

    public detectLanguage(filePath: string): CodeFileLanguage {
        const basename = path.basename(filePath).toLowerCase();
        return this.languageByFilename.get(basename) ?? this.languageByExtension.get(path.extname(basename)) ?? 'unknown';
    }
}

export function createDefaultCodeLanguageRegistry(): CodeLanguageRegistry {
    return new CodeLanguageRegistry();
}