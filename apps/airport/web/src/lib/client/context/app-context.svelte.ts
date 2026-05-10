// /apps/airport/web/src/lib/client/context/app-context.svelte.ts: App-wide client context for daemon identity, repository shell state, and active Airport selection.
import { createContext } from "svelte";
import { app, type AirportApplication } from "$lib/client/Application.svelte.js";
import type { Mission } from "$lib/components/entities/Mission/Mission.svelte.js";
import type { Repository as RepositoryEntity } from "$lib/components/entities/Repository/Repository.svelte.js";
import type { MissionRuntimeEventEnvelopeType } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import type { TaskConfigureCommandOptionsType } from '@flying-pillow/mission-core/entities/Task/TaskSchema';
import type { SidebarRepositoryData } from "$lib/components/entities/types";
import type { RuntimeSubscription } from "$lib/client/runtime/RuntimeSubscription";

export type GithubStatus = "connected" | "disconnected" | "unknown";

export type AppContextServerValue = {
    daemon: {
        running: boolean;
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
        activeMissionSelectedFocusId?: string;
        activeMissionSelectedArtifactId?: string;
    };
    syncServerContext(next: AppContextServerValue): void;
    loadAirportRepositories(): Promise<void>;
    loadRepositoryPage(input: { repositoryId: string }): Promise<void>;
    loadMissionPage(input: { repositoryId: string; missionId: string }): Promise<void>;
    clearAirportSelection(): void;
    refreshMission(input: {
        missionId: string;
        repositoryRootPath?: string;
    }): Promise<Mission>;
    observeMission(input: {
        missionId: string;
        repositoryRootPath?: string;
        onUpdate?: (mission: Mission, event: MissionRuntimeEventEnvelopeType) => void;
        onConnected?: (mission: Mission) => void;
        onError?: (error: Error) => void;
    }): RuntimeSubscription;
    configureActiveMissionTask(input: {
        taskId: string;
        options: TaskConfigureCommandOptionsType;
    }): Promise<void>;
    setRepositories(repositories: SidebarRepositoryData[]): void;
    setActiveRepository(input?: {
        id?: string;
        repositoryRootPath?: string;
    }): void;
    setActiveMission(missionId?: string): void;
    setActiveMissionSelectedFocusId(focusId?: string): void;
    setActiveMissionSelectedArtifactId(artifactId?: string): void;
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
                activeMissionSelectedFocusId: state.application.activeMissionSelectedFocusId,
                activeMissionSelectedArtifactId: state.application.activeMissionSelectedArtifactId,
            };
        },
        syncServerContext(next) {
            state.daemon = next.daemon;
            state.githubStatus = next.githubStatus;
            state.user = next.user;
        },
        async loadAirportRepositories() {
            await state.application.loadAirportRepositories();
        },
        async loadRepositoryPage(input) {
            await state.application.loadRepositoryPage(input);
        },
        async loadMissionPage(input) {
            await state.application.loadMissionPage(input);
        },
        clearAirportSelection() {
            state.application.clearAirportSelection();
        },
        async refreshMission(input) {
            return state.application.refreshMission(input);
        },
        observeMission(input) {
            return state.application.observeMission({
                ...input,
                onConnected: (mission) => {
                    input.onConnected?.(mission);
                },
                onUpdate: (mission, event) => {
                    input.onUpdate?.(mission, event);
                },
            });
        },
        async configureActiveMissionTask(input) {
            await state.application.configureActiveMissionTask(input);
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
        setActiveMissionSelectedFocusId(focusId) {
            state.application.setActiveMissionSelectedFocusId(
                focusId?.trim() || undefined,
            );
        },
        setActiveMissionSelectedArtifactId(artifactId) {
            state.application.setActiveMissionSelectedArtifactId(
                artifactId?.trim() || undefined,
            );
        },
    };
}