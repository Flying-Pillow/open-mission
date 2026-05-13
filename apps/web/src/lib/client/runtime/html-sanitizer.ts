type SanitizeHtmlOptions = {
    allowedTags: string[];
    allowedAttributes?: Record<string, string[]>;
    allowedSchemes?: string[];
    allowedStyles?: Record<string, string[]>;
};

const TEMPLATE_TAGS = new Set(['html', 'head', 'body']);

export function sanitizeBrowserHtml(html: string, options: SanitizeHtmlOptions): string {
    const parser = new DOMParser();
    const document = parser.parseFromString(`<body>${html}</body>`, 'text/html');
    sanitizeChildren(document.body, options);
    return document.body.innerHTML;
}

function sanitizeChildren(parent: Element, options: SanitizeHtmlOptions): void {
    for (const child of Array.from(parent.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE) {
            sanitizeElement(child as Element, options);
        } else if (child.nodeType !== Node.TEXT_NODE) {
            child.remove();
        }
    }
}

function sanitizeElement(element: Element, options: SanitizeHtmlOptions): void {
    const tagName = element.tagName.toLowerCase();
    if (!options.allowedTags.includes(tagName) || TEMPLATE_TAGS.has(tagName)) {
        const fragment = element.ownerDocument.createDocumentFragment();
        while (element.firstChild) {
            fragment.appendChild(element.firstChild);
        }
        element.replaceWith(fragment);
        sanitizeChildren(element.parentElement ?? element.ownerDocument.body, options);
        return;
    }

    sanitizeAttributes(element, options, tagName);
    sanitizeChildren(element, options);
}

function sanitizeAttributes(
    element: Element,
    options: SanitizeHtmlOptions,
    tagName: string,
): void {
    const allowedAttributes = new Set([
        ...(options.allowedAttributes?.['*'] ?? []),
        ...(options.allowedAttributes?.[tagName] ?? []),
    ]);

    for (const attribute of Array.from(element.attributes)) {
        if (attribute.name === 'style') {
            sanitizeStyleAttribute(element, options, tagName);
            continue;
        }

        if (!allowedAttributes.has(attribute.name)) {
            element.removeAttribute(attribute.name);
            continue;
        }

        if ((attribute.name === 'href' || attribute.name === 'src')
            && !hasAllowedScheme(attribute.value, options.allowedSchemes ?? [])) {
            element.removeAttribute(attribute.name);
        }
    }
}

function sanitizeStyleAttribute(
    element: Element,
    options: SanitizeHtmlOptions,
    tagName: string,
): void {
    const allowedProperties = new Set([
        ...(options.allowedStyles?.['*'] ?? []),
        ...(options.allowedStyles?.[tagName] ?? []),
    ]);
    if (allowedProperties.size === 0) {
        element.removeAttribute('style');
        return;
    }

    const safeDeclarations: string[] = [];
    for (const declaration of element.getAttribute('style')?.split(';') ?? []) {
        const separatorIndex = declaration.indexOf(':');
        if (separatorIndex < 0) {
            continue;
        }

        const property = declaration.slice(0, separatorIndex).trim().toLowerCase();
        const value = declaration.slice(separatorIndex + 1).trim();
        if (!allowedProperties.has(property) || !isSafeCssValue(value)) {
            continue;
        }

        safeDeclarations.push(`${property}: ${value}`);
    }

    if (safeDeclarations.length === 0) {
        element.removeAttribute('style');
        return;
    }

    element.setAttribute('style', safeDeclarations.join('; '));
}

function hasAllowedScheme(value: string, allowedSchemes: string[]): boolean {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
        return false;
    }

    if (trimmedValue.startsWith('#') || trimmedValue.startsWith('/')) {
        return true;
    }

    const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(trimmedValue);
    return schemeMatch ? allowedSchemes.includes(schemeMatch[1].toLowerCase()) : true;
}

function isSafeCssValue(value: string): boolean {
    return !/[<>]/.test(value) && !/url\s*\(/i.test(value) && !/expression\s*\(/i.test(value);
}
