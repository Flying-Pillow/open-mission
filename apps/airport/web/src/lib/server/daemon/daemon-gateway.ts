// /apps/airport/web/src/lib/server/daemon/daemon-gateway.ts: Daemon-backed gateway for Airport, mission, runtime, and terminal operations.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
    type ControlDocumentResponse,
    DaemonApi,
    type Notification,
    type RepositoryCandidate,
    type MissionAgentSessionState,
    RepositoryEntity,
    deriveRepositoryIdentity,
    listRegisteredRepositories,
    resolveGitWorkspaceRoot,
    type MissionEntity,
} from '@flying-pillow/mission-core/node';
import {
    type AgentSession,
    type AirportHomeSnapshot,
    type AirportRuntimeEventEnvelope,
    type MissionReference,
    type MissionSessionTerminalSnapshot,
    type MissionTerminalSnapshot,
    type Repository,
    agentSessionSchema,
    airportHomeSnapshotSchema,
    airportRuntimeEventEnvelopeSchema,
    missionReferenceSchema,
    missionSessionTerminalSnapshotSchema,
    missionTerminalSnapshotSchema,
    repositorySchema
} from '@flying-pillow/mission-core/schemas';
import {
    connectDedicatedAuthenticatedDaemonClient,
    connectSharedAuthenticatedDaemonClient
} from './connections.server';
const AIRPORT_WEB_TERMINAL_SCREEN_LIMIT = 40_000;
const AIRPORT_HOME_STATUS_TIMEOUT_MS = 8_000;
const DAEMON_CONNECT_TIMEOUT_MS = 12_000;

export class DaemonGateway {
    public constructor(private readonly locals?: App.Locals) { }

    public readonly airport = {
        getHomeSnapshot: () => this.getAirportHomeSnapshot(),
        inspectRepositoryPath: (repositoryPath: string) => this.inspectRepositoryPath(repositoryPath),
        addRepository: (repositoryPath: string) => this.addRepository(repositoryPath)
    };

    public async readControlDocument(filePath: string, surfacePath?: string): Promise<ControlDocumentResponse> {
        const normalizedPath = filePath.trim();
        if (!normalizedPath) {
            throw new Error('Document read requires a filePath.');
        }

        const daemon = await this.connectSharedDaemonClient(surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            return await withTimeout(
                api.control.readDocument(normalizedPath),
                2500,
                `Document read timed out for '${normalizedPath}'.`
            );
        } finally {
            daemon.dispose();
        }
    }

    public async writeControlDocument(input: {
        filePath: string;
        content: string;
        surfacePath?: string;
    }): Promise<ControlDocumentResponse> {
        const normalizedPath = input.filePath.trim();
        if (!normalizedPath) {
            throw new Error('Document write requires a filePath.');
        }

        const daemon = await this.connectSharedDaemonClient(input.surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            return await withTimeout(
                api.control.writeDocument(normalizedPath, input.content),
                2500,
                `Document write timed out for '${normalizedPath}'.`
            );
        } finally {
            daemon.dispose();
        }
    }

    public async getAirportHomeSnapshot(): Promise<AirportHomeSnapshot> {
        if (this.locals?.appContext.daemon.running === false) {
            return this.createEmptyAirportHomeSnapshot();
        }

        const registeredRepositories = await listRegisteredRepositories();
        let daemon: Awaited<ReturnType<DaemonGateway['connectSharedDaemonClient']>> | undefined;
        try {
            daemon = await this.connectSharedDaemonClient();
            const api = new DaemonApi(daemon.client);
            const status = await withTimeout(
                api.control.getStatus({ includeMissions: false }),
                AIRPORT_HOME_STATUS_TIMEOUT_MS,
                'Airport home status request timed out.'
            );
            const repositories = await withTimeout(
                api.control.listRegisteredRepositories(),
                AIRPORT_HOME_STATUS_TIMEOUT_MS,
                'Airport repository list request timed out.'
            );

            return airportHomeSnapshotSchema.parse({
                ...(status.operationalMode ? { operationalMode: status.operationalMode } : {}),
                ...(status.control?.controlRoot ? { controlRoot: status.control.controlRoot } : {}),
                ...(status.control?.currentBranch ? { currentBranch: status.control.currentBranch } : {}),
                ...(typeof status.control?.settingsComplete === 'boolean'
                    ? { settingsComplete: status.control.settingsComplete }
                    : {}),
                repositories: repositories.map((repository) => this.toRepositorySnapshot(repository))
            });
        } catch {
            return airportHomeSnapshotSchema.parse({
                repositories: registeredRepositories.map((repository) =>
                    this.toRepositorySnapshotFromCandidate(repository)
                )
            });
        } finally {
            daemon?.dispose();
        }
    }

    public async addRepository(repositoryPath: string): Promise<Repository> {
        const normalizedRepositoryPath = repositoryPath.trim();
        if (!normalizedRepositoryPath) {
            throw new Error('Repository registration requires a repositoryPath.');
        }

        const daemon = await this.connectSharedDaemonClient();
        try {
            const api = new DaemonApi(daemon.client);
            return this.toRepositorySnapshot(
                await withTimeout(
                    api.control.addRepository(normalizedRepositoryPath),
                    2500,
                    'Repository registration timed out.'
                )
            );
        } finally {
            daemon.dispose();
        }
    }

    public async inspectRepositoryPath(repositoryPath: string): Promise<Repository> {
        const normalizedRepositoryPath = repositoryPath.trim();
        if (!normalizedRepositoryPath) {
            throw new Error('Repository registration requires a repositoryPath.');
        }

        const resolvedRepositoryPath = path.resolve(normalizedRepositoryPath);
        if (!fs.existsSync(resolvedRepositoryPath)) {
            throw new Error(`Local checkout path '${normalizedRepositoryPath}' does not exist on the daemon host.`);
        }

        const repositoryRootPath = resolveGitWorkspaceRoot(resolvedRepositoryPath);
        if (!repositoryRootPath) {
            throw new Error(`Mission could not resolve a Git repository from '${normalizedRepositoryPath}'. Select the local checkout root on disk.`);
        }

        const repositoryIdentity = deriveRepositoryIdentity(repositoryRootPath);
        return repositorySchema.parse({
            repositoryId: repositoryIdentity.repositoryId,
            repositoryRootPath: repositoryIdentity.repositoryRootPath,
            label: repositoryIdentity.githubRepository?.split('/').pop()
                ?? (path.basename(repositoryIdentity.repositoryRootPath) || repositoryIdentity.repositoryRootPath),
            description: repositoryIdentity.githubRepository ?? repositoryIdentity.repositoryRootPath,
            ...(repositoryIdentity.githubRepository ? { githubRepository: repositoryIdentity.githubRepository } : {})
        });
    }

    public async openEventSubscription(input: {
        missionId?: string;
        surfacePath?: string;
        onEvent: (event: AirportRuntimeEventEnvelope) => void;
    }): Promise<{ dispose(): void }> {
        const missionId = input.missionId?.trim();
        const daemon = await this.connectDedicatedDaemonClient(input.surfacePath);
        await daemon.client.request<null>('event.subscribe', {
            eventTypes: [
                'mission.snapshot.changed',
                'mission.actions.changed',
                'mission.status',
                'stage.snapshot.changed',
                'task.snapshot.changed',
                'artifact.snapshot.changed',
                'agentSession.snapshot.changed',
                'session.event',
                'session.lifecycle'
            ],
            ...(missionId ? { missionId } : {})
        });
        const subscription = daemon.client.onDidEvent((event) => {
            if (!this.matchesMission(event, missionId) || !this.shouldForwardRuntimeEvent(event)) {
                return;
            }

            input.onEvent(this.toRuntimeEventEnvelope(event));
        });

        return {
            dispose: () => {
                subscription.dispose();
                daemon.dispose();
            }
        };
    }

    public async getMissionSessionTerminalSnapshot(input: {
        missionId: string;
        sessionId: string;
        surfacePath?: string;
    }): Promise<MissionSessionTerminalSnapshot> {
        const missionId = input.missionId.trim();
        const sessionId = input.sessionId.trim();
        if (!missionId || !sessionId) {
            return missionSessionTerminalSnapshotSchema.parse({
                missionId,
                sessionId,
                connected: false,
                dead: true,
                exitCode: null,
                screen: ''
            });
        }

        const daemon = await this.connectSharedDaemonClient(input.surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            const state = await withTimeout(
                api.mission.getSessionTerminalState({ missionId }, sessionId),
                2500,
                'Mission terminal snapshot request timed out.'
            );
            if (!state) {
                return missionSessionTerminalSnapshotSchema.parse({
                    missionId,
                    sessionId,
                    connected: false,
                    dead: true,
                    exitCode: null,
                    screen: ''
                });
            }

            const terminalScreen = clipMissionSessionTerminalScreen(state);

            return missionSessionTerminalSnapshotSchema.parse({
                missionId,
                sessionId,
                connected: state.connected,
                dead: state.dead,
                exitCode: state.dead ? state.exitCode : null,
                screen: terminalScreen.screen,
                ...(state.truncated || terminalScreen.truncated ? { truncated: true } : {}),
                ...(state.terminalHandle ? { terminalHandle: state.terminalHandle } : {})
            });
        } finally {
            daemon.dispose();
        }
    }

    public async sendMissionSessionTerminalInput(input: {
        missionId: string;
        sessionId: string;
        data?: string;
        literal?: boolean;
        cols?: number;
        rows?: number;
        surfacePath?: string;
    }): Promise<MissionSessionTerminalSnapshot> {
        const missionId = input.missionId.trim();
        const sessionId = input.sessionId.trim();
        const daemon = await this.connectSharedDaemonClient(input.surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            const state = await withTimeout(
                api.mission.sendSessionTerminalInput(
                    { missionId },
                    sessionId,
                    {
                        ...(input.data !== undefined ? { data: input.data } : {}),
                        ...(input.literal !== undefined ? { literal: input.literal } : {}),
                        ...(input.cols !== undefined ? { cols: input.cols } : {}),
                        ...(input.rows !== undefined ? { rows: input.rows } : {})
                    }
                ),
                2500,
                'Mission terminal input request timed out.'
            );
            if (!state) {
                throw new Error(`Mission session '${sessionId}' is not available as a terminal-backed session.`);
            }
            const terminalScreen = clipTerminalScreen(state.screen);
            return missionSessionTerminalSnapshotSchema.parse({
                missionId,
                sessionId,
                connected: state.connected,
                dead: state.dead,
                exitCode: state.dead ? state.exitCode : null,
                screen: terminalScreen.screen,
                ...(state.truncated || terminalScreen.truncated ? { truncated: true } : {}),
                ...(state.terminalHandle ? { terminalHandle: state.terminalHandle } : {})
            });
        } finally {
            daemon.dispose();
        }
    }

    public async getMissionTerminalSnapshot(input: {
        missionId: string;
        surfacePath?: string;
    }): Promise<MissionTerminalSnapshot> {
        const missionId = input.missionId.trim();
        if (!missionId) {
            return missionTerminalSnapshotSchema.parse({
                missionId,
                connected: false,
                dead: true,
                exitCode: null,
                screen: ''
            });
        }

        const daemon = await this.connectSharedDaemonClient(input.surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            const state = await withTimeout(
                api.mission.getMissionTerminalState({ missionId }),
                2500,
                'Mission terminal snapshot request timed out.'
            );
            if (!state) {
                return missionTerminalSnapshotSchema.parse({
                    missionId,
                    connected: false,
                    dead: true,
                    exitCode: null,
                    screen: ''
                });
            }

            const terminalScreen = clipTerminalScreen(state.screen);

            return missionTerminalSnapshotSchema.parse({
                missionId,
                connected: state.connected,
                dead: state.dead,
                exitCode: state.dead ? state.exitCode : null,
                screen: terminalScreen.screen,
                ...(state.truncated || terminalScreen.truncated ? { truncated: true } : {}),
                ...(state.terminalHandle ? { terminalHandle: state.terminalHandle } : {})
            });
        } finally {
            daemon.dispose();
        }
    }

    public async sendMissionTerminalInput(input: {
        missionId: string;
        data?: string;
        literal?: boolean;
        cols?: number;
        rows?: number;
        surfacePath?: string;
    }): Promise<MissionTerminalSnapshot> {
        const missionId = input.missionId.trim();
        const daemon = await this.connectSharedDaemonClient(input.surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            const state = await withTimeout(
                api.mission.sendMissionTerminalInput(
                    { missionId },
                    {
                        ...(input.data !== undefined ? { data: input.data } : {}),
                        ...(input.literal !== undefined ? { literal: input.literal } : {}),
                        ...(input.cols !== undefined ? { cols: input.cols } : {}),
                        ...(input.rows !== undefined ? { rows: input.rows } : {})
                    }
                ),
                2500,
                'Mission terminal input request timed out.'
            );
            if (!state) {
                throw new Error(`Mission terminal for '${missionId}' is not available.`);
            }
            const terminalScreen = clipTerminalScreen(state.screen);
            return missionTerminalSnapshotSchema.parse({
                missionId,
                connected: state.connected,
                dead: state.dead,
                exitCode: state.dead ? state.exitCode : null,
                screen: terminalScreen.screen,
                ...(state.truncated || terminalScreen.truncated ? { truncated: true } : {}),
                ...(state.terminalHandle ? { terminalHandle: state.terminalHandle } : {})
            });
        } finally {
            daemon.dispose();
        }
    }

    private matchesMission(event: Notification, missionId?: string): boolean {
        if (!missionId) {
            return event.type !== 'control.workflow.settings.updated';
        }

        switch (event.type) {
            case 'mission.snapshot.changed':
            case 'mission.actions.changed':
            case 'mission.status':
            case 'stage.snapshot.changed':
            case 'task.snapshot.changed':
            case 'artifact.snapshot.changed':
            case 'agentSession.snapshot.changed':
            case 'session.console':
            case 'session.terminal':
            case 'session.event':
            case 'session.lifecycle':
                return event.missionId === missionId;
            case 'airport.state':
                return true;
            case 'control.workflow.settings.updated':
                return false;
        }
    }

    private toRuntimeEventEnvelope(event: Notification): AirportRuntimeEventEnvelope {
        return airportRuntimeEventEnvelopeSchema.parse({
            eventId: randomUUID(),
            type: event.type,
            occurredAt: this.resolveOccurredAt(event),
            ...(this.resolveMissionId(event) ? { missionId: this.resolveMissionId(event) } : {}),
            payload: this.toRuntimeEventPayload(event)
        });
    }

    private toRuntimeEventPayload(event: Notification): unknown {
        switch (event.type) {
            case 'airport.state':
                return { snapshot: event.snapshot };
            case 'mission.snapshot.changed':
            case 'stage.snapshot.changed':
            case 'task.snapshot.changed':
            case 'artifact.snapshot.changed':
            case 'agentSession.snapshot.changed':
                return {
                    reference: event.reference,
                    snapshot: event.snapshot
                };
            case 'mission.actions.changed':
                return {
                    missionId: event.missionId,
                    ...(event.reference ? { reference: event.reference } : {}),
                    ...(event.actions ? { actions: event.actions } : {}),
                    ...(event.revision ? { revision: event.revision } : {})
                };
            case 'mission.status':
                return {
                    missionId: event.missionId,
                    status: this.toMissionStatusSummary(event.status, event.missionId)
                };
            case 'session.event':
                return {
                    missionId: event.missionId,
                    sessionId: event.sessionId,
                    session: this.toMissionSessionSnapshot(event.event.state)
                };
            case 'session.lifecycle':
                return {
                    missionId: event.missionId,
                    sessionId: event.sessionId,
                    phase: event.phase,
                    lifecycleState: event.lifecycleState
                };
            case 'session.console':
            case 'session.terminal':
            case 'control.workflow.settings.updated':
                return event;
        }
    }

    private resolveOccurredAt(event: Notification): string {
        switch (event.type) {
            case 'airport.state':
                return event.snapshot.state.airport.substrate.lastObservedAt
                    ?? event.snapshot.state.airport.substrate.lastAppliedAt
                    ?? new Date().toISOString();
            case 'mission.snapshot.changed':
                return event.snapshot.workflow?.updatedAt
                    ?? event.snapshot.status?.workflow?.updatedAt
                    ?? new Date().toISOString();
            case 'mission.status':
                return event.status.updatedAt ?? new Date().toISOString();
            case 'stage.snapshot.changed':
            case 'task.snapshot.changed':
            case 'artifact.snapshot.changed':
            case 'agentSession.snapshot.changed':
                return new Date().toISOString();
            case 'session.console':
            case 'session.terminal':
                return new Date().toISOString();
            case 'session.event':
                return event.event.state.lastUpdatedAt;
            case 'mission.actions.changed':
            case 'session.lifecycle':
            case 'control.workflow.settings.updated':
                return new Date().toISOString();
        }
    }

    private resolveMissionId(event: Notification): string | undefined {
        switch (event.type) {
            case 'mission.snapshot.changed':
            case 'mission.actions.changed':
            case 'mission.status':
            case 'stage.snapshot.changed':
            case 'task.snapshot.changed':
            case 'artifact.snapshot.changed':
            case 'agentSession.snapshot.changed':
            case 'session.console':
            case 'session.terminal':
            case 'session.event':
            case 'session.lifecycle':
                return event.missionId;
            case 'airport.state':
            case 'control.workflow.settings.updated':
                return undefined;
        }
    }

    private shouldForwardRuntimeEvent(event: Notification): boolean {
        switch (event.type) {
            case 'airport.state':
            case 'mission.snapshot.changed':
            case 'mission.actions.changed':
            case 'mission.status':
            case 'stage.snapshot.changed':
            case 'task.snapshot.changed':
            case 'artifact.snapshot.changed':
            case 'agentSession.snapshot.changed':
            case 'session.event':
            case 'session.lifecycle':
                return true;
            case 'session.console':
            case 'session.terminal':
            case 'control.workflow.settings.updated':
                return false;
        }
    }

    private toMissionStatusSummary(mission: MissionEntity, missionId: string) {
        return {
            missionId: mission.missionId.trim() || missionId,
            ...(mission.title ? { title: mission.title } : {}),
            ...(mission.issueId !== undefined ? { issueId: mission.issueId } : {}),
            ...(mission.type ? { type: mission.type } : {}),
            ...(mission.operationalMode ? { operationalMode: mission.operationalMode } : {}),
            ...(mission.branchRef ? { branchRef: mission.branchRef } : {}),
            ...(mission.missionDir ? { missionDir: mission.missionDir } : {}),
            ...(mission.missionRootDir ? { missionRootDir: mission.missionRootDir } : {}),
            ...(mission.artifacts.length > 0 ? { artifacts: structuredClone(mission.artifacts) } : {}),
            ...(mission.lifecycle || mission.updatedAt || mission.currentStageId || mission.stages.length > 0
                ? {
                    workflow: {
                        ...(mission.lifecycle ? { lifecycle: mission.lifecycle } : {}),
                        ...(mission.updatedAt ? { updatedAt: mission.updatedAt } : {}),
                        ...(mission.currentStageId ? { currentStageId: mission.currentStageId } : {}),
                        stages: mission.stages.map((stage) => structuredClone(stage))
                    }
                }
                : {}),
            ...(mission.recommendedAction ? { recommendedAction: mission.recommendedAction } : {})
        };
    }

    private toMissionSessionSnapshot(session: AgentSession | MissionAgentSessionState): AgentSession {
        return agentSessionSchema.parse({
            sessionId: session.sessionId,
            runnerId: session.runnerId,
            ...(session.transportId ? { transportId: session.transportId } : {}),
            runnerLabel: session.runnerLabel,
            ...(session.sessionLogPath ? { sessionLogPath: session.sessionLogPath } : {}),
            lifecycleState: session.lifecycleState,
            ...(session.terminalSessionName ? { terminalSessionName: session.terminalSessionName } : {}),
            ...(session.terminalPaneId ? { terminalPaneId: session.terminalPaneId } : {}),
            ...(session.terminalSessionName && session.terminalPaneId
                ? {
                    terminalHandle: {
                        sessionName: session.terminalSessionName,
                        paneId: session.terminalPaneId
                    }
                }
                : {}),
            ...(session.workingDirectory ? { workingDirectory: session.workingDirectory } : {}),
            ...(session.currentTurnTitle ? { currentTurnTitle: session.currentTurnTitle } : {}),
            ...(session.taskId ? { taskId: session.taskId } : {})
        });
    }

    private async resolveTerminalSessionContext(input: {
        missionId: string;
        sessionId: string;
    }): Promise<{
        missionId: string;
        session: AgentSession;
        sharedSessionName?: string;
    } | undefined> {
        const missionId = input.missionId.trim();
        const sessionId = input.sessionId.trim();
        if (!missionId || !sessionId) {
            return undefined;
        }

        const daemon = await this.connectSharedDaemonClient();
        try {
            const api = new DaemonApi(daemon.client);
            const sessions = await withTimeout(
                api.mission.listSessions({ missionId }),
                2500,
                'Mission session listing timed out.'
            );
            const session = sessions.find((candidate) => candidate.sessionId === sessionId);
            if (!session || session.transportId !== 'terminal' || !session.terminalSessionName) {
                return undefined;
            }

            const airportSessionName = await withTimeout(
                api.airport.getStatus(),
                2500,
                'Airport status request timed out.'
            )
                .then((status) => status.state.airport.substrate.sessionName)
                .catch(() => undefined);

            const sharedSessionName = airportSessionName?.trim() === session.terminalSessionName.trim()
                ? airportSessionName
                : undefined;

            return {
                missionId,
                session,
                ...(sharedSessionName ? { sharedSessionName } : {})
            };
        } finally {
            daemon.dispose();
        }
    }

    public async resolveRepositoryCandidate(input: {
        repositoryId: string;
        repositoryRootPath?: string;
    }): Promise<Repository> {
        const repositoryId = input.repositoryId.trim();
        if (!repositoryId) {
            throw new Error('Repository access requires a repositoryId.');
        }

        const repositoryRootPath = input.repositoryRootPath?.trim();
        if (repositoryRootPath) {
            return repositorySchema.parse({
                repositoryId,
                repositoryRootPath,
                label: path.basename(repositoryRootPath) || repositoryRootPath,
                description: ''
            });
        }

        const airportHome = await this.getAirportHomeSnapshot();
        const repository = airportHome.repositories.find((candidate) => candidate.repositoryId === repositoryId);
        if (!repository) {
            throw new Error(`Repository '${repositoryId}' is not registered in Airport.`);
        }

        return repository;
    }

    private toRepositorySnapshot(repository: Repository): Repository {
        return repositorySchema.parse(repository);
    }

    private toRepositorySnapshotFromCandidate(repository: RepositoryCandidate): Repository {
        return RepositoryEntity.open(repository.repositoryRootPath, {
            label: repository.label,
            description: repository.description,
            ...(repository.githubRepository ? { githubRepository: repository.githubRepository } : {})
        }).toSchema();
    }

    private toMissionReferenceSnapshot(candidate: MissionReference): MissionReference {
        return missionReferenceSchema.parse({
            missionId: candidate.missionId,
            title: candidate.title,
            branchRef: candidate.branchRef,
            createdAt: candidate.createdAt,
            ...(candidate.issueId !== undefined ? { issueId: candidate.issueId } : {})
        });
    }

    private async connectSharedDaemonClient(surfacePath?: string) {
        return withTimeout(
            connectSharedAuthenticatedDaemonClient({
                locals: this.locals,
                allowStart: true,
                ...(surfacePath?.trim() ? { surfacePath: surfacePath.trim() } : {})
            }),
            DAEMON_CONNECT_TIMEOUT_MS,
            'Mission daemon connection timed out.'
        );
    }

    private async connectDedicatedDaemonClient(surfacePath?: string) {
        return withTimeout(
            connectDedicatedAuthenticatedDaemonClient({
                locals: this.locals,
                allowStart: true,
                ...(surfacePath?.trim() ? { surfacePath: surfacePath.trim() } : {})
            }),
            DAEMON_CONNECT_TIMEOUT_MS,
            'Mission daemon connection timed out.'
        );
    }

    private createEmptyAirportHomeSnapshot(): AirportHomeSnapshot {
        return airportHomeSnapshotSchema.parse({
            repositories: [],
            ...(this.locals?.appContext.daemon.running ? {} : { settingsComplete: false })
        });
    }
}

function clipTerminalScreen(screen: string): { screen: string; truncated: boolean } {
    if (screen.length <= AIRPORT_WEB_TERMINAL_SCREEN_LIMIT) {
        return { screen, truncated: false };
    }

    return {
        screen: screen.slice(-AIRPORT_WEB_TERMINAL_SCREEN_LIMIT),
        truncated: true
    };
}

function clipMissionSessionTerminalScreen(state: {
    connected: boolean;
    dead: boolean;
    screen: string;
}): { screen: string; truncated: boolean } {
    if (!state.connected && state.dead) {
        return { screen: state.screen, truncated: false };
    }

    return clipTerminalScreen(state.screen);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(message));
        }, timeoutMs);

        promise.then(
            (value) => {
                clearTimeout(timeout);
                resolve(value);
            },
            (error: unknown) => {
                clearTimeout(timeout);
                reject(error);
            }
        );
    });
}