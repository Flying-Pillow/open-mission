// /apps/airport/web/src/lib/client/context/app-context.svelte.ts: App-wide client context for daemon identity, repository shell state, and active Airport selection.
import { createContext } from "svelte";
import { app, type AirportApplication } from "$lib/client/Application.svelte.js";
import type { Mission } from "$lib/components/entities/Mission/Mission.svelte.js";
import type { Repository as RepositoryEntity } from "$lib/components/entities/Repository/Repository.svelte.js";
import type {
    AirportRuntimeEventEnvelope,
    MissionTowerTreeNode,
} from "@flying-pillow/mission-core/schemas";
import type { SidebarRepositorySummary } from "$lib/components/entities/types";
import type { RuntimeSubscription } from "$lib/client/runtime/transport/EntityRuntimeTransport";
import type { AirportRouteData } from "../../../routes/api/airport/airport.remote";

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
        repositories: SidebarRepositorySummary[];
        activeRepositoryId?: string;
        activeRepositoryRootPath?: string;
        activeRepository?: RepositoryEntity;
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
    setRepositories(repositories: SidebarRepositorySummary[]): void;
    setActiveRepository(input?: {
        repositoryId?: string;
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
    airportRouteData?: AirportRouteData,
): AppContextValue {
    const initialValue =
        typeof initial === "function" ? initial() : initial;

    if (airportRouteData) {
        app.syncAirportRouteData(airportRouteData);
    }

    const state = $state({
        application: app,
        daemon: initialValue.daemon,
        githubStatus: initialValue.githubStatus,
        user: initialValue.user,
        airport: {
            repositories: [] as SidebarRepositorySummary[],
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
                activeRepositoryId: state.application.activeRepositoryId,
                activeRepositoryRootPath: state.application.activeRepositoryRootPath,
                activeRepository: state.application.activeRepository,
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