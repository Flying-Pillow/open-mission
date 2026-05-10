import sanitizeHtml from 'sanitize-html';
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { bundledLanguages } from 'shiki/langs';
import { bundledThemes } from 'shiki/themes';

const shikiThemes = {
    light: 'vitesse-light',
    dark: 'vitesse-dark'
} as const;

type ShikiBundledLanguage = keyof typeof bundledLanguages;

const highlighterPromise = createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    themes: [bundledThemes[shikiThemes.light], bundledThemes[shikiThemes.dark]],
    langs: []
});

const shikiHtmlSanitizerOptions = {
    allowedTags: ['pre', 'code', 'span'],
    allowedAttributes: {
        pre: ['class', 'style', 'tabindex'],
        code: ['class'],
        span: ['class', 'style']
    },
    allowedStyles: {
        pre: {
            '--mission-shiki-light': [/^.*$/],
            '--mission-shiki-dark': [/^.*$/],
            '--mission-shiki-light-bg': [/^.*$/],
            '--mission-shiki-dark-bg': [/^.*$/]
        },
        span: {
            '--mission-shiki-light': [/^.*$/],
            '--mission-shiki-dark': [/^.*$/]
        }
    }
};

export async function renderArtifactTextHtml(input: {
    source: string;
    language?: string;
}): Promise<string> {
    const { source, language } = input;
    if (!language) {
        return renderPlainTextHtml(source);
    }

    const highlighter = await highlighterPromise;
    const resolvedLanguage = highlighter.resolveLangAlias(language) ?? language;
    const bundledLanguage = bundledLanguages[resolvedLanguage as ShikiBundledLanguage];
    if (!bundledLanguage) {
        return renderPlainTextHtml(source);
    }

    if (!highlighter.getLoadedLanguages().includes(resolvedLanguage)) {
        await highlighter.loadLanguage(bundledLanguage);
    }

    return sanitizeHtml(
        highlighter.codeToHtml(source, {
            lang: resolvedLanguage,
            themes: shikiThemes,
            defaultColor: false,
            cssVariablePrefix: '--mission-shiki-'
        }),
        shikiHtmlSanitizerOptions,
    );
}

export function renderPlainTextHtml(source: string): string {
    return `<pre class="artifact-text-viewer__plain">${escapeHtml(source)}</pre>`;
}

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}