// /apps/airport/web/src/lib/client/context/app-context.svelte.ts: App-wide client context for daemon identity, repository shell state, and active Airport selection.
import { createContext } from "svelte";
import type { RepositorySummary } from "$lib/components/entities/types";

export type GithubStatus = "connected" | "disconnected" | "unknown";

export type AppContextServerValue = {
    daemon: {
        running: boolean;
        startedByHook: boolean;
        message: string;
        endpointPath?: string;
        lastCheckedAt: string;
    };
    githubStatus: GithubStatus;
    user?: {
        name: string;
        email?: string;
        avatarUrl?: string;
        githubStatus: GithubStatus;
    };
};

export type AppContextValue = {
    daemon: AppContextServerValue["daemon"];
    githubStatus: GithubStatus;
    user?: AppContextServerValue["user"];
    airport: {
        repositories: RepositorySummary[];
        activeRepositoryId?: string;
        activeRepositoryRootPath?: string;
        activeMissionId?: string;
    };
    syncServerContext(next: AppContextServerValue): void;
    setRepositories(repositories: RepositorySummary[]): void;
    setActiveRepository(input?: {
        repositoryId?: string;
        repositoryRootPath?: string;
    }): void;
    setActiveMission(missionId?: string): void;
};

const [getAppContext, setAppContext] = createContext<AppContextValue>();

export { getAppContext, setAppContext };

export function createAppContext(
    initial: AppContextServerValue | (() => AppContextServerValue),
): AppContextValue {
    const initialValue =
        typeof initial === "function" ? initial() : initial;
    const state = $state({
        daemon: initialValue.daemon,
        githubStatus: initialValue.githubStatus,
        user: initialValue.user,
        airport: {
            repositories: [] as RepositorySummary[],
            activeRepositoryId: undefined as string | undefined,
            activeRepositoryRootPath: undefined as string | undefined,
            activeMissionId: undefined as string | undefined,
        },
    });

    return {
        get daemon() {
            return state.daemon;
        },
        get githubStatus() {
            return state.githubStatus;
        },
        get user() {
            return state.user;
        },
        get airport() {
            return state.airport;
        },
        syncServerContext(next) {
            state.daemon = next.daemon;
            state.githubStatus = next.githubStatus;
            state.user = next.user;
        },
        setRepositories(repositories) {
            state.airport.repositories = repositories;
        },
        setActiveRepository(input) {
            state.airport.activeRepositoryId = input?.repositoryId?.trim() || undefined;
            state.airport.activeRepositoryRootPath =
                input?.repositoryRootPath?.trim() || undefined;
        },
        setActiveMission(missionId) {
            state.airport.activeMissionId = missionId?.trim() || undefined;
        },
    };
}