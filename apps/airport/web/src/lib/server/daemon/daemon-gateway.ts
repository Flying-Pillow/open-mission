// /apps/airport/web/src/lib/server/daemon/daemon-gateway.ts: Daemon-backed gateway for Airport, mission, runtime, and terminal operations.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
    DaemonApi,
    deriveRepositoryIdentity,
    listRegisteredRepositories,
    resolveGitWorkspaceRoot,
} from '@flying-pillow/mission-core/node';
import {
    type AgentCommand,
    type AgentPrompt,
    type AgentSession,
    type AirportHomeSnapshot,
    type AirportRuntimeEventEnvelope,
    type GitHubVisibleRepository,
    type MissionReference,
    type MissionRuntimeSnapshot,
    type MissionSessionTerminalSnapshot,
    type MissionTerminalSnapshot,
    type Repository,
    agentSessionSchema,
    airportHomeSnapshotSchema,
    airportRuntimeEventEnvelopeSchema,
    githubVisibleRepositorySchema,
    missionReferenceSchema,
    missionRuntimeSnapshotSchema,
    missionSessionTerminalSnapshotSchema,
    missionTerminalSnapshotSchema,
    repositorySchema
} from '@flying-pillow/mission-core/airport/runtime';
import { toMission, type Mission as MissionEntity } from '@flying-pillow/mission-core/entities/Mission/Mission';
import type {
    OperatorActionExecutionStep,
    OperatorActionListSnapshot,
    OperatorActionQueryContext,
    OperatorStatus
} from '@flying-pillow/mission-core/types.js';
import type { ControlDocumentResponse, Notification } from '@flying-pillow/mission-core/daemon/protocol/contracts';
import { operatorStatusSchema } from '../../types/mission-control.js';
import {
    connectDedicatedAuthenticatedDaemonClient,
    connectSharedAuthenticatedDaemonClient
} from './connections.server';
const AIRPORT_WEB_TERMINAL_SCREEN_LIMIT = 40_000;
const MISSION_STATUS_TIMEOUT_MS = 8_000;
const AIRPORT_HOME_STATUS_TIMEOUT_MS = 8_000;
const DAEMON_CONNECT_TIMEOUT_MS = 12_000;
const GITHUB_REPOSITORY_LIST_TIMEOUT_MS = 15_000;

export class DaemonGateway {
    public constructor(private readonly locals?: App.Locals) { }

    public readonly airport = {
        getHomeSnapshot: () => this.getAirportHomeSnapshot(),
        listVisibleGitHubRepositories: (surfacePath?: string) => this.listVisibleGitHubRepositories(surfacePath),
        inspectRepositoryPath: (repositoryPath: string) => this.inspectRepositoryPath(repositoryPath),
        addRepository: (repositoryPath: string) => this.addRepository(repositoryPath),
        cloneGitHubRepository: (githubRepository: string, destinationPath: string) => this.cloneGitHubRepository(githubRepository, destinationPath)
    };

    public readonly entities = {
        readMissionRuntime: (missionId: string, surfacePath?: string) => this.readMissionRuntime(missionId, surfacePath),
        readMissionControl: (input: {
            missionId: string;
            surfacePath?: string;
        }) => this.readMissionControl(input),
        readMissionStatus: (missionId: string, surfacePath?: string) => this.readMissionStatus(missionId, surfacePath),
        listMissionActions: (input: {
            missionId: string;
            context?: OperatorActionQueryContext;
            surfacePath?: string;
        }) => this.listMissionActions(input),
        executeMissionAction: (input: {
            missionId: string;
            actionId: string;
            steps?: OperatorActionExecutionStep[];
            terminalSessionName?: string;
            surfacePath?: string;
        }) => this.executeMissionAction(input)
    };

    private async buildMissionRuntimeSnapshot(input: {
        api: DaemonApi;
        missionId: string;
        mission?: MissionEntity;
    }): Promise<MissionRuntimeSnapshot> {
        const normalizedMissionId = input.missionId.trim();
        const mission = input.mission
            ?? await withTimeout(
                input.api.mission.getMission({ missionId: normalizedMissionId }),
                MISSION_STATUS_TIMEOUT_MS,
                'Mission status request timed out.'
            );
        const sessions = await withTimeout(
            input.api.mission.listSessions({ missionId: normalizedMissionId }),
            2500,
            'Mission session listing timed out.'
        );

        return missionRuntimeSnapshotSchema.parse({
            missionId: normalizedMissionId,
            status: this.toMissionStatusSummary(mission, normalizedMissionId),
            sessions: sessions.map((session) => this.toMissionSessionSnapshot(session))
        });
    }

    public async readMissionRuntime(missionId: string, surfacePath?: string): Promise<MissionRuntimeSnapshot> {
        const normalizedMissionId = missionId.trim();
        if (!normalizedMissionId) {
            throw new Error('Mission runtime snapshot requires a missionId.');
        }

        const daemon = await this.connectSharedDaemonClient(surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            return await this.buildMissionRuntimeSnapshot({
                api,
                missionId: normalizedMissionId
            });
        } finally {
            daemon.dispose();
        }
    }

    public async readMissionControl(input: {
        missionId: string;
        surfacePath?: string;
    }): Promise<{
        missionRuntime: MissionRuntimeSnapshot;
        operatorStatus: OperatorStatus;
    }> {
        const missionId = input.missionId.trim();
        if (!missionId) {
            throw new Error('Mission control snapshot requires a missionId.');
        }

        const daemon = await this.connectSharedDaemonClient(input.surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            const operatorStatus = await withTimeout(
                api.mission.getOperatorStatus({ missionId }),
                MISSION_STATUS_TIMEOUT_MS,
                'Mission operator status request timed out.'
            );

            return {
                missionRuntime: await this.buildMissionRuntimeSnapshot({
                    api,
                    missionId,
                    mission: toMission(operatorStatusSchema.parse(operatorStatus))
                }),
                operatorStatus: operatorStatusSchema.parse(operatorStatus)
            };
        } finally {
            daemon.dispose();
        }
    }

    public async readMissionStatus(missionId: string, surfacePath?: string): Promise<OperatorStatus> {
        const normalizedMissionId = missionId.trim();
        if (!normalizedMissionId) {
            throw new Error('Mission operator status requires a missionId.');
        }

        const daemon = await this.connectSharedDaemonClient(surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            return operatorStatusSchema.parse(
                await withTimeout(
                    api.mission.getStatus({ missionId: normalizedMissionId }),
                    MISSION_STATUS_TIMEOUT_MS,
                    'Mission operator status request timed out.'
                )
            );
        } finally {
            daemon.dispose();
        }
    }

    public async listMissionActions(input: {
        missionId: string;
        context?: OperatorActionQueryContext;
        surfacePath?: string;
    }): Promise<OperatorActionListSnapshot> {
        const missionId = input.missionId.trim();
        if (!missionId) {
            throw new Error('Mission action snapshot requires a missionId.');
        }

        const daemon = await this.connectSharedDaemonClient(input.surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            return await withTimeout(
                api.mission.listAvailableActionsSnapshot(
                    { missionId },
                    input.context,
                ),
                8000,
                'Mission action snapshot request timed out.'
            );
        } finally {
            daemon.dispose();
        }
    }

    public async executeMissionAction(input: {
        missionId: string;
        actionId: string;
        steps?: OperatorActionExecutionStep[];
        terminalSessionName?: string;
        surfacePath?: string;
    }): Promise<OperatorStatus> {
        const missionId = input.missionId.trim();
        const actionId = input.actionId.trim();
        if (!missionId || !actionId) {
            throw new Error('Mission action execution requires missionId and actionId.');
        }

        const daemon = await this.connectSharedDaemonClient(input.surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            return await withTimeout(
                api.mission.executeAction(
                    { missionId },
                    actionId,
                    input.steps ?? [],
                    input.terminalSessionName?.trim()
                        ? { terminalSessionName: input.terminalSessionName.trim() }
                        : {},
                ),
                2500,
                `Mission action '${actionId}' timed out.`
            );
        } finally {
            daemon.dispose();
        }
    }

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

    public async executeMissionTaskCommand(input: {
        missionId: string;
        taskId: string;
        action: 'start' | 'complete' | 'reopen';
        terminalSessionName?: string;
        surfacePath?: string;
    }): Promise<MissionRuntimeSnapshot> {
        const missionId = input.missionId.trim();
        const taskId = input.taskId.trim();
        if (!missionId || !taskId) {
            throw new Error('Mission task command requires missionId and taskId.');
        }

        const actionId = this.resolveMissionTaskActionId(taskId, input.action);
        const daemon = await this.connectSharedDaemonClient(input.surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            const mission = await withTimeout(
                api.mission.executeMissionAction(
                    { missionId },
                    actionId,
                    [],
                    input.action === 'start' && input.terminalSessionName?.trim()
                        ? { terminalSessionName: input.terminalSessionName.trim() }
                        : {}
                ),
                8000,
                `Mission task command '${input.action}' timed out.`
            );

            return await this.buildMissionRuntimeSnapshot({
                api,
                missionId,
                mission
            });
        } finally {
            daemon.dispose();
        }
    }

    public async executeMissionCommand(input: {
        missionId: string;
        action: 'pause' | 'resume' | 'panic' | 'clearPanic' | 'restartQueue' | 'deliver';
        surfacePath?: string;
    }): Promise<MissionRuntimeSnapshot> {
        const missionId = input.missionId.trim();
        if (!missionId) {
            throw new Error('Mission command requires a missionId.');
        }

        const daemon = await this.connectSharedDaemonClient(input.surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            const mission = await withTimeout(
                api.mission.executeMissionAction({ missionId }, this.resolveMissionActionId(input.action)),
                2500,
                `Mission command '${input.action}' timed out.`
            );

            return await this.buildMissionRuntimeSnapshot({
                api,
                missionId,
                mission
            });
        } finally {
            daemon.dispose();
        }
    }

    public async executeMissionSessionCommand(input: {
        missionId: string;
        sessionId: string;
        surfacePath?: string;
        action: 'complete';
    } | {
        missionId: string;
        sessionId: string;
        surfacePath?: string;
        action: 'cancel' | 'terminate';
        reason?: string;
    } | {
        missionId: string;
        sessionId: string;
        surfacePath?: string;
        action: 'prompt';
        prompt: AgentPrompt;
    } | {
        missionId: string;
        sessionId: string;
        surfacePath?: string;
        action: 'command';
        command: AgentCommand;
    }): Promise<MissionRuntimeSnapshot> {
        const missionId = input.missionId.trim();
        const sessionId = input.sessionId.trim();
        if (!missionId || !sessionId) {
            throw new Error('Mission session command requires missionId and sessionId.');
        }

        const daemon = await this.connectSharedDaemonClient(input.surfacePath);
        try {
            const api = new DaemonApi(daemon.client);

            switch (input.action) {
                case 'complete':
                    await withTimeout(
                        api.mission.completeSession({ missionId }, sessionId),
                        2500,
                        'Mission session completion timed out.'
                    );
                    break;
                case 'cancel':
                    await withTimeout(
                        api.mission.cancelSession({ missionId }, sessionId, input.reason?.trim()),
                        2500,
                        'Mission session cancel timed out.'
                    );
                    break;
                case 'terminate':
                    await withTimeout(
                        api.mission.terminateSession({ missionId }, sessionId, input.reason?.trim()),
                        2500,
                        'Mission session terminate timed out.'
                    );
                    break;
                case 'prompt':
                    await withTimeout(
                        api.mission.promptSession({ missionId }, sessionId, input.prompt),
                        2500,
                        'Mission session prompt timed out.'
                    );
                    break;
                case 'command':
                    await withTimeout(
                        api.mission.commandSession({ missionId }, sessionId, input.command),
                        2500,
                        'Mission session command timed out.'
                    );
                    break;
            }

            return await this.buildMissionRuntimeSnapshot({
                api,
                missionId
            });
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

            return airportHomeSnapshotSchema.parse({
                ...(status.operationalMode ? { operationalMode: status.operationalMode } : {}),
                ...(status.control?.controlRoot ? { controlRoot: status.control.controlRoot } : {}),
                ...(status.control?.currentBranch ? { currentBranch: status.control.currentBranch } : {}),
                ...(typeof status.control?.settingsComplete === 'boolean'
                    ? { settingsComplete: status.control.settingsComplete }
                    : {}),
                repositories: registeredRepositories.map((repository) =>
                    this.toRepositorySnapshot(repository)
                )
            });
        } catch {
            return airportHomeSnapshotSchema.parse({
                repositories: registeredRepositories.map((repository) =>
                    this.toRepositorySnapshot(repository)
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

    public async listVisibleGitHubRepositories(surfacePath?: string): Promise<GitHubVisibleRepository[]> {
        const daemon = await this.connectSharedDaemonClient(surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            const repositories = await withTimeout(
                api.control.listVisibleGitHubRepositories(),
                GITHUB_REPOSITORY_LIST_TIMEOUT_MS,
                'GitHub repository listing timed out.'
            );
            return repositories.map((repository) => githubVisibleRepositorySchema.parse(repository));
        } finally {
            daemon.dispose();
        }
    }

    public async cloneGitHubRepository(
        githubRepository: string,
        destinationPath: string
    ): Promise<Repository> {
        const normalizedGitHubRepository = githubRepository.trim();
        const normalizedDestinationPath = destinationPath.trim();
        if (!normalizedGitHubRepository) {
            throw new Error('GitHub repository clone requires a githubRepository.');
        }
        if (!normalizedDestinationPath) {
            throw new Error('GitHub repository clone requires a destinationPath.');
        }

        const daemon = await this.connectSharedDaemonClient();
        try {
            const api = new DaemonApi(daemon.client);
            return this.toRepositorySnapshot(
                await withTimeout(
                    api.control.cloneGitHubRepository(normalizedGitHubRepository, normalizedDestinationPath),
                    30_000,
                    'GitHub repository clone timed out.'
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
            eventTypes: ['mission.actions.changed', 'mission.status', 'session.lifecycle'],
            ...(missionId ? { missionId } : {})
        });
        const subscription = daemon.client.onDidEvent((event) => {
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
            case 'mission.actions.changed':
            case 'mission.status':
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

    private resolveMissionTaskActionId(
        taskId: string,
        action: 'start' | 'complete' | 'reopen'
    ): string {
        switch (action) {
            case 'start':
                return `task.start.${taskId}`;
            case 'complete':
                return `task.done.${taskId}`;
            case 'reopen':
                return `task.reopen.${taskId}`;
        }
    }

    private resolveMissionActionId(
        action: 'pause' | 'resume' | 'panic' | 'clearPanic' | 'restartQueue' | 'deliver'
    ): string {
        switch (action) {
            case 'pause':
                return 'mission.pause';
            case 'resume':
                return 'mission.resume';
            case 'panic':
                return 'mission.panic';
            case 'clearPanic':
                return 'mission.clear-panic';
            case 'restartQueue':
                return 'mission.restart-queue';
            case 'deliver':
                return 'mission.deliver';
        }
    }

    private toRuntimeEventEnvelope(event: Notification): AirportRuntimeEventEnvelope {
        return airportRuntimeEventEnvelopeSchema.parse({
            eventId: randomUUID(),
            type: event.type,
            occurredAt: this.resolveOccurredAt(event),
            ...(this.resolveMissionId(event) ? { missionId: this.resolveMissionId(event) } : {}),
            payload: event
        });
    }

    private resolveOccurredAt(event: Notification): string {
        switch (event.type) {
            case 'airport.state':
                return event.snapshot.state.airport.substrate.lastObservedAt
                    ?? event.snapshot.state.airport.substrate.lastAppliedAt
                    ?? new Date().toISOString();
            case 'mission.status':
                return event.status.updatedAt ?? new Date().toISOString();
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
            case 'mission.actions.changed':
            case 'mission.status':
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
            case 'mission.actions.changed':
            case 'mission.status':
            case 'session.lifecycle':
                return true;
            case 'session.console':
            case 'session.terminal':
            case 'session.event':
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

    private toMissionSessionSnapshot(session: AgentSession): AgentSession {
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

    private toRepositorySnapshot(repository: Repository & { repositoryId?: string }): Repository {
        return repositorySchema.parse({
            repositoryId: repository.repositoryId,
            repositoryRootPath: repository.repositoryRootPath,
            label: repository.label,
            description: repository.description,
            ...(repository.githubRepository ? { githubRepository: repository.githubRepository } : {})
        });
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