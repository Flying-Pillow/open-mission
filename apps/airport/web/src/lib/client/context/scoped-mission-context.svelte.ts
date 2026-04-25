import { getContext, hasContext, setContext } from 'svelte';
import type { Mission } from '$lib/components/entities/Mission/Mission.svelte.js';
import type { Repository } from '$lib/components/entities/Repository/Repository.svelte.js';

type ScopedMissionContext = {
    repositoryId?: string;
    missionId?: string;
    mission?: Mission;
    repository?: Repository;
    loading: boolean;
    error?: string | null;
};

const scopedMissionContextKey = Symbol('scoped-mission-context');

export function setScopedMissionContext(value: ScopedMissionContext): ScopedMissionContext {
    setContext(scopedMissionContextKey, value);
    return value;
}

export function getScopedMissionContext(): ScopedMissionContext {
    return getContext(scopedMissionContextKey);
}

export function maybeGetScopedMissionContext(): ScopedMissionContext | undefined {
    return hasContext(scopedMissionContextKey)
        ? getContext(scopedMissionContextKey)
        : undefined;
}
