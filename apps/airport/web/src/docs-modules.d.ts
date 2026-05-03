declare module '$docs/*' {
    const component: import('svelte').Component;
    export default component;
    export const metadata: Record<string, unknown>;
}

declare module '$docs/index.md' {
    const component: import('svelte').Component;
    export default component;
    export const metadata: Record<string, unknown>;
}