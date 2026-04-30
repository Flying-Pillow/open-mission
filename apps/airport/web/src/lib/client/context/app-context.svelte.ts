// /apps/airport/web/src/lib/client/context/app-context.svelte.ts: App-wide client context for daemon identity, repository shell state, and active Airport selection.
import { createContext } from "svelte";
import { app, type AirportApplication } from "$lib/client/Application.svelte.js";
import type { Mission } from "$lib/components/entities/Mission/Mission.svelte.js";
import type { Repository as RepositoryEntity } from "$lib/components/entities/Repository/Repository.svelte.js";
import type { MissionTowerTreeNode } from '@flying-pillow/mission-core/types';
import type { AirportRuntimeEventEnvelope } from "$lib/contracts/runtime-events";
import type { SidebarRepositoryData } from "$lib/components/entities/types";
import type { RuntimeSubscription } from "$lib/client/runtime/transport/EntityRuntimeTransport";

export type GithubStatus = "connected" | "disconnected" | "unknown";

export type AppContextServerValue = {
    daemon: {
        running: boolean;
        startedByHook: boolean;
        message: string;
        endpointPath?: string;
        lastCheckedAt: string;
        nextRetryAt?: string;
        failureCount?: number;
    };
    githubStatus: GithubStatus;
    user?: {
        name: string;
        email?: string;
        avatarUrl?: string;
        githubStatus: GithubStatus;
    };
};

export type ActiveMissionOutline = {
    title?: string;
    currentStageId?: string;
    briefPath?: string;
    treeNodes: MissionTowerTreeNode[];
};

export type AppContextValue = {
    readonly application: AirportApplication;
    daemon: AppContextServerValue["daemon"];
    githubStatus: GithubStatus;
    user?: AppContextServerValue["user"];
    airport: {
        repositories: SidebarRepositoryData[];
        activeRepositoryLoading: boolean;
        activeRepositoryError?: string;
        activeRepositoryId?: string;
        activeRepositoryRootPath?: string;
        activeRepository?: RepositoryEntity;
        activeMissionLoading: boolean;
        activeMissionError?: string;
        activeMissionId?: string;
        activeMission?: Mission;
        activeMissionOutline?: ActiveMissionOutline;
        activeMissionSelectedNodeId?: string;
    };
    syncServerContext(next: AppContextServerValue): void;
    refreshMission(input: {
        missionId: string;
        repositoryRootPath?: string;
    }): Promise<Mission>;
    observeMission(input: {
        missionId: string;
        repositoryRootPath?: string;
        onUpdate?: (mission: Mission, event: AirportRuntimeEventEnvelope) => void;
        onError?: (error: Error) => void;
    }): RuntimeSubscription;
    setRepositories(repositories: SidebarRepositoryData[]): void;
    setActiveRepository(input?: {
        id?: string;
        repositoryRootPath?: string;
    }): void;
    setActiveMission(missionId?: string): void;
    setActiveMissionOutline(next?: ActiveMissionOutline): void;
    setActiveMissionSelectedNodeId(nodeId?: string): void;
};

const [getAppContext, setAppContext] = createContext<AppContextValue>();

export { getAppContext, setAppContext };

export function createAppContext(
    initial: AppContextServerValue | (() => AppContextServerValue),
): AppContextValue {
    const initialValue =
        typeof initial === "function" ? initial() : initial;

    const state = $state({
        application: app,
        daemon: initialValue.daemon,
        githubStatus: initialValue.githubStatus,
        user: initialValue.user,
        airport: {
            repositories: [] as SidebarRepositoryData[],
        },
    });

    return {
        get application() {
            return state.application;
        },
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
            return {
                repositories: state.application.repositoriesState,
                activeRepositoryLoading: state.application.activeRepositoryLoading,
                activeRepositoryError: state.application.activeRepositoryError,
                activeRepositoryId: state.application.activeRepositoryId,
                activeRepositoryRootPath: state.application.activeRepositoryRootPath,
                activeRepository: state.application.activeRepository,
                activeMissionLoading: state.application.activeMissionLoading,
                activeMissionError: state.application.activeMissionError,
                activeMissionId: state.application.activeMissionId,
                activeMission: state.application.activeMission,
                activeMissionOutline: state.application.activeMissionOutline,
                activeMissionSelectedNodeId: state.application.activeMissionSelectedNodeId,
            };
        },
        syncServerContext(next) {
            state.daemon = next.daemon;
            state.githubStatus = next.githubStatus;
            state.user = next.user;
        },
        async refreshMission(input) {
            return state.application.refreshMission(input);
        },
        observeMission(input) {
            return state.application.observeMission({
                ...input,
                onUpdate: (mission, event) => {
                    input.onUpdate?.(mission, event);
                },
            });
        },
        setRepositories(repositories) {
            state.application.setRepositories(repositories);
        },
        setActiveRepository(input) {
            state.application.setActiveRepositorySelection(input);
        },
        setActiveMission(missionId) {
            state.application.setActiveMissionSelection(missionId);
        },
        setActiveMissionOutline(next) {
            state.application.setActiveMissionOutline(next
                ? {
                    title: next.title?.trim() || undefined,
                    currentStageId: next.currentStageId?.trim() || undefined,
                    treeNodes: [...next.treeNodes],
                }
                : undefined);
        },
        setActiveMissionSelectedNodeId(nodeId) {
            state.application.setActiveMissionSelectedNodeId(
                nodeId?.trim() || undefined,
            );
        },
    };
}