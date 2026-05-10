export type ArtifactViewerKind = 'markdown' | 'image' | 'svg' | 'text' | 'unsupported';

type ArtifactSyntaxLanguage = {
    monacoLanguage: string;
    shikiLanguage?: string;
};

type ArtifactSyntaxLanguageDefinition = {
    monacoLanguage: string;
    shikiLanguage?: string;
    extensions?: string[];
    basenames?: string[];
    basenamePrefixes?: string[];
    basenameSuffixes?: string[];
};

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

const artifactSyntaxLanguageDefinitions: ArtifactSyntaxLanguageDefinition[] = [
    {
        monacoLanguage: 'plaintext',
        basenames: [
            '.env',
            '.gitignore',
            '.dockerignore',
            '.eslintignore',
            '.prettierignore',
            '.npmignore',
            '.gitattributes',
            '.gitmodules',
            '.npmrc',
            '.yarnrc',
            '.gitconfig',
            '.tool-versions',
            '.bashrc',
            '.bash_profile',
            '.zshrc',
            '.zprofile',
            '.zshenv'
        ]
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'dotenv',
        basenamePrefixes: ['.env.']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'docker',
        basenames: ['dockerfile', 'containerfile'],
        basenamePrefixes: ['dockerfile.', 'containerfile.']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'make',
        basenames: ['makefile', 'gnumakefile'],
        extensions: ['.mk', '.mak']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'cmake',
        basenames: ['cmakelists.txt'],
        extensions: ['.cmake']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'codeowners',
        basenames: ['codeowners']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'just',
        basenames: ['justfile'],
        extensions: ['.just']
    },
    {
        monacoLanguage: 'groovy',
        shikiLanguage: 'groovy',
        basenames: ['jenkinsfile'],
        extensions: ['.groovy', '.gradle', '.gvy', '.gy', '.gsh']
    },
    {
        monacoLanguage: 'ruby',
        shikiLanguage: 'ruby',
        basenames: ['gemfile', 'rakefile', 'podfile', 'vagrantfile', 'brewfile'],
        extensions: ['.rb', '.rake', '.gemspec', '.ru']
    },
    {
        monacoLanguage: 'php',
        shikiLanguage: 'blade',
        basenameSuffixes: ['.blade.php']
    },
    {
        monacoLanguage: 'javascript',
        shikiLanguage: 'javascript',
        extensions: ['.js', '.mjs', '.cjs']
    },
    {
        monacoLanguage: 'javascript',
        shikiLanguage: 'jsx',
        extensions: ['.jsx']
    },
    {
        monacoLanguage: 'typescript',
        shikiLanguage: 'typescript',
        extensions: ['.ts', '.mts', '.cts', '.d.ts']
    },
    {
        monacoLanguage: 'typescript',
        shikiLanguage: 'tsx',
        extensions: ['.tsx']
    },
    {
        monacoLanguage: 'css',
        shikiLanguage: 'css',
        extensions: ['.css']
    },
    {
        monacoLanguage: 'scss',
        shikiLanguage: 'scss',
        extensions: ['.scss']
    },
    {
        monacoLanguage: 'scss',
        shikiLanguage: 'sass',
        extensions: ['.sass']
    },
    {
        monacoLanguage: 'less',
        shikiLanguage: 'less',
        extensions: ['.less']
    },
    {
        monacoLanguage: 'css',
        shikiLanguage: 'stylus',
        extensions: ['.styl']
    },
    {
        monacoLanguage: 'css',
        shikiLanguage: 'postcss',
        extensions: ['.pcss', '.postcss']
    },
    {
        monacoLanguage: 'html',
        shikiLanguage: 'html',
        extensions: ['.html', '.htm', '.xhtml']
    },
    {
        monacoLanguage: 'xml',
        shikiLanguage: 'xml',
        extensions: ['.xml', '.xsd', '.xsl', '.xslt', '.wsdl', '.plist', '.svg']
    },
    {
        monacoLanguage: 'html',
        shikiLanguage: 'svelte',
        extensions: ['.svelte']
    },
    {
        monacoLanguage: 'html',
        shikiLanguage: 'vue',
        extensions: ['.vue']
    },
    {
        monacoLanguage: 'html',
        shikiLanguage: 'astro',
        extensions: ['.astro']
    },
    {
        monacoLanguage: 'html',
        shikiLanguage: 'marko',
        extensions: ['.marko']
    },
    {
        monacoLanguage: 'html',
        shikiLanguage: 'handlebars',
        extensions: ['.hbs', '.handlebars']
    },
    {
        monacoLanguage: 'html',
        shikiLanguage: 'pug',
        extensions: ['.pug', '.jade']
    },
    {
        monacoLanguage: 'html',
        shikiLanguage: 'haml',
        extensions: ['.haml']
    },
    {
        monacoLanguage: 'html',
        shikiLanguage: 'erb',
        extensions: ['.erb']
    },
    {
        monacoLanguage: 'html',
        shikiLanguage: 'liquid',
        extensions: ['.liquid']
    },
    {
        monacoLanguage: 'html',
        shikiLanguage: 'jinja',
        extensions: ['.jinja', '.j2', '.jinja2']
    },
    {
        monacoLanguage: 'markdown',
        shikiLanguage: 'markdown',
        extensions: ['.md', '.markdown']
    },
    {
        monacoLanguage: 'markdown',
        shikiLanguage: 'mdx',
        extensions: ['.mdx']
    },
    {
        monacoLanguage: 'markdown',
        shikiLanguage: 'mdc',
        extensions: ['.mdc']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'asciidoc',
        extensions: ['.adoc', '.asciidoc']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'rst',
        extensions: ['.rst']
    },
    {
        monacoLanguage: 'json',
        shikiLanguage: 'json',
        extensions: ['.json', '.map', '.geojson']
    },
    {
        monacoLanguage: 'json',
        shikiLanguage: 'jsonc',
        extensions: ['.jsonc', '.code-snippets']
    },
    {
        monacoLanguage: 'json',
        shikiLanguage: 'json5',
        extensions: ['.json5']
    },
    {
        monacoLanguage: 'json',
        shikiLanguage: 'hjson',
        extensions: ['.hjson']
    },
    {
        monacoLanguage: 'json',
        shikiLanguage: 'jsonl',
        extensions: ['.jsonl']
    },
    {
        monacoLanguage: 'yaml',
        shikiLanguage: 'yaml',
        extensions: ['.yaml', '.yml']
    },
    {
        monacoLanguage: 'ini',
        shikiLanguage: 'toml',
        extensions: ['.toml']
    },
    {
        monacoLanguage: 'ini',
        shikiLanguage: 'ini',
        extensions: ['.ini', '.cfg', '.conf', '.properties', '.prop', '.editorconfig']
    },
    {
        monacoLanguage: 'shell',
        shikiLanguage: 'shellscript',
        extensions: ['.sh', '.bash', '.zsh', '.ksh', '.command']
    },
    {
        monacoLanguage: 'shell',
        shikiLanguage: 'fish',
        extensions: ['.fish']
    },
    {
        monacoLanguage: 'powershell',
        shikiLanguage: 'powershell',
        extensions: ['.ps1', '.psm1', '.psd1']
    },
    {
        monacoLanguage: 'python',
        shikiLanguage: 'python',
        extensions: ['.py', '.pyi', '.pyw']
    },
    {
        monacoLanguage: 'ruby',
        shikiLanguage: 'ruby',
        extensions: ['.rb', '.rbs']
    },
    {
        monacoLanguage: 'php',
        shikiLanguage: 'php',
        extensions: ['.php', '.phtml', '.phar', '.inc']
    },
    {
        monacoLanguage: 'java',
        shikiLanguage: 'java',
        extensions: ['.java']
    },
    {
        monacoLanguage: 'kotlin',
        shikiLanguage: 'kotlin',
        extensions: ['.kt', '.kts']
    },
    {
        monacoLanguage: 'scala',
        shikiLanguage: 'scala',
        extensions: ['.scala', '.sc', '.sbt']
    },
    {
        monacoLanguage: 'go',
        shikiLanguage: 'go',
        extensions: ['.go']
    },
    {
        monacoLanguage: 'rust',
        shikiLanguage: 'rust',
        extensions: ['.rs']
    },
    {
        monacoLanguage: 'c',
        shikiLanguage: 'c',
        extensions: ['.c']
    },
    {
        monacoLanguage: 'cpp',
        shikiLanguage: 'cpp',
        extensions: ['.cc', '.cpp', '.cxx', '.c++', '.h', '.hh', '.hpp', '.hxx', '.ipp', '.ixx', '.mxx']
    },
    {
        monacoLanguage: 'objective-c',
        shikiLanguage: 'objective-c',
        extensions: ['.m']
    },
    {
        monacoLanguage: 'objective-cpp',
        shikiLanguage: 'objective-cpp',
        extensions: ['.mm']
    },
    {
        monacoLanguage: 'csharp',
        shikiLanguage: 'csharp',
        extensions: ['.cs', '.csx']
    },
    {
        monacoLanguage: 'fsharp',
        shikiLanguage: 'fsharp',
        extensions: ['.fs', '.fsi', '.fsx', '.fsscript']
    },
    {
        monacoLanguage: 'vb',
        shikiLanguage: 'vb',
        extensions: ['.vb', '.vbs']
    },
    {
        monacoLanguage: 'bat',
        shikiLanguage: 'bat',
        extensions: ['.bat', '.cmd']
    },
    {
        monacoLanguage: 'dart',
        shikiLanguage: 'dart',
        extensions: ['.dart']
    },
    {
        monacoLanguage: 'swift',
        shikiLanguage: 'swift',
        extensions: ['.swift']
    },
    {
        monacoLanguage: 'lua',
        shikiLanguage: 'lua',
        extensions: ['.lua']
    },
    {
        monacoLanguage: 'perl',
        shikiLanguage: 'perl',
        extensions: ['.pl', '.pm', '.perl']
    },
    {
        monacoLanguage: 'r',
        shikiLanguage: 'r',
        extensions: ['.r']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'julia',
        extensions: ['.jl']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'graphql',
        extensions: ['.graphql', '.gql', '.graphqls']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'prisma',
        extensions: ['.prisma']
    },
    {
        monacoLanguage: 'sql',
        shikiLanguage: 'sql',
        extensions: ['.sql', '.psql']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'proto',
        extensions: ['.proto']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'terraform',
        extensions: ['.tf', '.tfvars']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'hcl',
        extensions: ['.hcl']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'docker',
        extensions: ['.dockerfile']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'http',
        extensions: ['.http']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'hurl',
        extensions: ['.hurl']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'mermaid',
        extensions: ['.mmd', '.mermaid']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'csv',
        extensions: ['.csv']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'tsv',
        extensions: ['.tsv']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'diff',
        extensions: ['.diff', '.patch']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'log',
        extensions: ['.log']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'nix',
        extensions: ['.nix']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'nushell',
        extensions: ['.nu']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'zig',
        extensions: ['.zig']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'nim',
        extensions: ['.nim', '.nims']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'gleam',
        extensions: ['.gleam']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'elm',
        extensions: ['.elm']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'elixir',
        extensions: ['.ex', '.exs', '.eex', '.heex']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'erlang',
        extensions: ['.erl', '.hrl']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'clojure',
        extensions: ['.clj', '.cljs', '.cljc', '.edn']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'haskell',
        extensions: ['.hs', '.lhs']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'ocaml',
        extensions: ['.ml', '.mli']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'scheme',
        extensions: ['.scm', '.ss']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'common-lisp',
        extensions: ['.lisp', '.cl']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'emacs-lisp',
        extensions: ['.el']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'racket',
        extensions: ['.rkt']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'fennel',
        extensions: ['.fnl']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'purescript',
        extensions: ['.purs']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'solidity',
        extensions: ['.sol']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'move',
        extensions: ['.move']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'cairo',
        extensions: ['.cairo']
    },
    {
        monacoLanguage: 'plaintext',
        shikiLanguage: 'zig',
        extensions: ['.zon']
    },
    {
        monacoLanguage: 'plaintext',
        extensions: ['.txt']
    }
];

const artifactSyntaxLanguagesByExtension = new Map<string, ArtifactSyntaxLanguage>();
const artifactSyntaxLanguagesByBasename = new Map<string, ArtifactSyntaxLanguage>();
const artifactSyntaxLanguagesByBasenamePrefix: Array<[string, ArtifactSyntaxLanguage]> = [];
const artifactSyntaxLanguagesByBasenameSuffix: Array<[string, ArtifactSyntaxLanguage]> = [];

for (const definition of artifactSyntaxLanguageDefinitions) {
    const syntaxLanguage = createArtifactSyntaxLanguage(definition);
    for (const extension of definition.extensions ?? []) {
        artifactSyntaxLanguagesByExtension.set(extension, syntaxLanguage);
    }
    for (const basename of definition.basenames ?? []) {
        artifactSyntaxLanguagesByBasename.set(basename, syntaxLanguage);
    }
    for (const basenamePrefix of definition.basenamePrefixes ?? []) {
        artifactSyntaxLanguagesByBasenamePrefix.push([basenamePrefix, syntaxLanguage]);
    }
    for (const basenameSuffix of definition.basenameSuffixes ?? []) {
        artifactSyntaxLanguagesByBasenameSuffix.push([basenameSuffix, syntaxLanguage]);
    }
}

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

    return resolveArtifactSyntaxLanguage(fileNameOrPath) !== undefined;
}

export function resolveMonacoLanguage(fileNameOrPath: string | undefined): string {
    if (isJsonlMediaType(fileNameOrPath)) {
        return 'json';
    }

    return resolveArtifactSyntaxLanguage(fileNameOrPath)?.monacoLanguage ?? 'plaintext';
}

export function resolveShikiLanguage(fileNameOrPath: string | undefined): string | undefined {
    if (isJsonlMediaType(fileNameOrPath)) {
        return 'json';
    }

    if (resolveExtension(fileNameOrPath) === '.jsonl') {
        return 'json';
    }

    return resolveArtifactSyntaxLanguage(fileNameOrPath)?.shikiLanguage;
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

    if (resolveArtifactSyntaxLanguage(fileNameOrPath)) {
        return 'lucide:file-code';
    }

    return 'lucide:file';
}

function resolveArtifactSyntaxLanguage(fileNameOrPath: string | undefined): ArtifactSyntaxLanguage | undefined {
    const basename = resolveBasename(fileNameOrPath);
    if (!basename) {
        return undefined;
    }

    const basenameLanguage = artifactSyntaxLanguagesByBasename.get(basename);
    if (basenameLanguage) {
        return basenameLanguage;
    }

    for (const [basenamePrefix, syntaxLanguage] of artifactSyntaxLanguagesByBasenamePrefix) {
        if (basename.startsWith(basenamePrefix)) {
            return syntaxLanguage;
        }
    }

    for (const [basenameSuffix, syntaxLanguage] of artifactSyntaxLanguagesByBasenameSuffix) {
        if (basename.endsWith(basenameSuffix)) {
            return syntaxLanguage;
        }
    }

    return artifactSyntaxLanguagesByExtension.get(resolveExtensionFromBasename(basename));
}

function resolveExtension(fileNameOrPath: string | undefined): string {
    return resolveExtensionFromBasename(resolveBasename(fileNameOrPath));
}

function resolveBasename(fileNameOrPath: string | undefined): string {
    const normalized = fileNameOrPath?.trim().toLowerCase();
    if (!normalized) {
        return '';
    }

    return normalized.split(/[\\/]/u).pop() ?? normalized;
}

function resolveExtensionFromBasename(basename: string | undefined): string {
    if (!basename) {
        return '';
    }

    const extensionStart = basename.lastIndexOf('.');
    return extensionStart > -1 ? basename.slice(extensionStart) : '';
}

function createArtifactSyntaxLanguage(definition: ArtifactSyntaxLanguageDefinition): ArtifactSyntaxLanguage {
    return definition.shikiLanguage
        ? {
            monacoLanguage: definition.monacoLanguage,
            shikiLanguage: definition.shikiLanguage,
        }
        : {
            monacoLanguage: definition.monacoLanguage,
        };
}

function isJsonlMediaType(value: string | undefined): boolean {
    const normalizedValue = value?.trim().toLowerCase();
    if (!normalizedValue) {
        return false;
    }

    const [mediaType] = normalizedValue.split(';', 1);
    return jsonlMediaTypes.has(mediaType);
}