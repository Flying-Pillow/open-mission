import { getContext, hasContext, setContext } from 'svelte';
import type { Repository } from '$lib/components/entities/Repository/Repository.svelte.js';

type ScopedRepositoryContext = {
    repositoryId?: string;
    repository?: Repository;
    loading: boolean;
    error?: string | null;
};

const scopedRepositoryContextKey = Symbol('scoped-repository-context');

export function setScopedRepositoryContext(value: ScopedRepositoryContext): ScopedRepositoryContext {
    setContext(scopedRepositoryContextKey, value);
    return value;
}

export function getScopedRepositoryContext(): ScopedRepositoryContext {
    return getContext(scopedRepositoryContextKey);
}

export function maybeGetScopedRepositoryContext(): ScopedRepositoryContext | undefined {
    return hasContext(scopedRepositoryContextKey)
        ? getContext(scopedRepositoryContextKey)
        : undefined;
}
