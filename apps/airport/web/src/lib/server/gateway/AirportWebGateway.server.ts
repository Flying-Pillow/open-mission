// /apps/airport/web/src/lib/server/gateway/AirportWebGateway.server.ts: Thin SvelteKit gateway over the existing Mission daemon API and notifications for Airport web.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
    DaemonApi,
    deriveRepositoryIdentity,
    getMissionArtifactDefinition,
    getMissionStageDefinition,
    isMissionStageId,
    resolveGitWorkspaceRoot,
    type RepositoryCandidate,
    type MissionSelectionCandidate,
    type MissionAgentSessionRecord,
    type Notification,
    type OperatorActionExecutionStep,
    type OperatorActionListSnapshot,
    type OperatorActionQueryContext,
    type OperatorStatus,
    type TrackedIssueSummary
} from '@flying-pillow/mission-core/node';
import type {
    AgentCommand,
    AgentPrompt,
    AirportHomeSnapshotDto,
    AirportRuntimeEventEnvelopeDto,
    ControlDocumentResponse,
    GitHubVisibleRepositoryDto,
    GitHubIssueDetailDto,
    MissionAgentSessionDto,
    MissionSessionTerminalSnapshotDto,
    MissionTerminalSnapshotDto,
    MissionRuntimeSnapshotDto,
    MissionSelectionCandidateDto,
    RepositoryCandidateDto,
    RepositorySurfaceSnapshotDto,
    TrackedIssueSummaryDto
} from '@flying-pillow/mission-core';
import {
    airportHomeSnapshotDtoSchema,
    airportRuntimeEventEnvelopeSchema,
    githubVisibleRepositoryDtoSchema,
    githubIssueDetailDtoSchema,
    missionAgentSessionDtoSchema,
    missionSessionTerminalSnapshotDtoSchema,
    missionTerminalSnapshotDtoSchema,
    missionRuntimeSnapshotDtoSchema,
    missionSelectionCandidateDtoSchema,
    repositoryCandidateDtoSchema,
    repositorySurfaceSnapshotDtoSchema,
    trackedIssueSummaryDtoSchema
} from '@flying-pillow/mission-core';
import {
    connectDedicatedAuthenticatedDaemonClient,
    connectSharedAuthenticatedDaemonClient
} from '../daemon/connections.server';
const AIRPORT_WEB_TERMINAL_SCREEN_LIMIT = 40_000;
const MISSION_STATUS_TIMEOUT_MS = 8_000;

export class AirportWebGateway {
    public constructor(private readonly locals?: App.Locals) { }

    private async buildMissionRuntimeSnapshot(input: {
        api: DaemonApi;
        missionId: string;
        status?: OperatorStatus;
    }): Promise<MissionRuntimeSnapshotDto> {
        const normalizedMissionId = input.missionId.trim();
        const status = input.status
            ?? await withTimeout(
                input.api.mission.getStatus({ missionId: normalizedMissionId }),
                MISSION_STATUS_TIMEOUT_MS,
                'Mission status request timed out.'
            );
        const sessions = await withTimeout(
            input.api.mission.listSessions({ missionId: normalizedMissionId }),
            2500,
            'Mission session listing timed out.'
        );

        return missionRuntimeSnapshotDtoSchema.parse({
            missionId: normalizedMissionId,
            status: this.toMissionStatusSummary(status, normalizedMissionId),
            sessions: sessions.map((session) => this.toMissionSessionDto(session))
        });
    }

    public async getRepositoryIssues(input: {
        repositoryId: string;
        repositoryRootPath?: string;
    }): Promise<TrackedIssueSummaryDto[]> {
        const repositoryRootPath = input.repositoryRootPath?.trim()
            || (await this.resolveRepositoryCandidate({
                repositoryId: input.repositoryId
            })).repositoryRootPath;

        const daemon = await this.connectSharedDaemonClient(repositoryRootPath);
        try {
            const api = new DaemonApi(daemon.client);
            const status = await withTimeout(
                api.control.getStatus(),
                2500,
                'Repository issues status request timed out.'
            );

            if (status.control?.trackingProvider !== 'github') {
                return [];
            }

            const issues = await withTimeout(
                api.control.listOpenIssues(25),
                2500,
                'Issue listing timed out.'
            ).catch(() => []);

            return issues.map((issue) => this.toTrackedIssueSummaryDto(issue));
        } finally {
            daemon.dispose();
        }
    }

    public async getMissionRuntimeSnapshot(missionId: string, surfacePath?: string): Promise<MissionRuntimeSnapshotDto> {
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

    public async getMissionControlSnapshot(input: {
        missionId: string;
        surfacePath?: string;
    }): Promise<{
        missionRuntime: MissionRuntimeSnapshotDto;
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
                api.mission.getStatus({ missionId }),
                MISSION_STATUS_TIMEOUT_MS,
                'Mission operator status request timed out.'
            );

            return {
                missionRuntime: await this.buildMissionRuntimeSnapshot({
                    api,
                    missionId,
                    status: operatorStatus
                }),
                operatorStatus
            };
        } finally {
            daemon.dispose();
        }
    }

    public async getMissionOperatorStatus(missionId: string, surfacePath?: string): Promise<OperatorStatus> {
        const normalizedMissionId = missionId.trim();
        if (!normalizedMissionId) {
            throw new Error('Mission operator status requires a missionId.');
        }

        const daemon = await this.connectSharedDaemonClient(surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            return await withTimeout(
                api.mission.getStatus({ missionId: normalizedMissionId }),
                MISSION_STATUS_TIMEOUT_MS,
                'Mission operator status request timed out.'
            );
        } finally {
            daemon.dispose();
        }
    }

    public async getMissionActionSnapshot(input: {
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
                2500,
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
        action: 'start' | 'complete' | 'block' | 'reopen';
        terminalSessionName?: string;
        surfacePath?: string;
    }): Promise<MissionRuntimeSnapshotDto> {
        const missionId = input.missionId.trim();
        const taskId = input.taskId.trim();
        if (!missionId || !taskId) {
            throw new Error('Mission task command requires missionId and taskId.');
        }

        const actionId = this.resolveMissionTaskActionId(taskId, input.action);
        const daemon = await this.connectSharedDaemonClient(input.surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            const status = await withTimeout(
                api.mission.executeAction(
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
                status
            });
        } finally {
            daemon.dispose();
        }
    }

    public async executeMissionCommand(input: {
        missionId: string;
        action: 'pause' | 'resume' | 'panic' | 'clearPanic' | 'restartQueue' | 'deliver';
        surfacePath?: string;
    }): Promise<MissionRuntimeSnapshotDto> {
        const missionId = input.missionId.trim();
        if (!missionId) {
            throw new Error('Mission command requires a missionId.');
        }

        const daemon = await this.connectSharedDaemonClient(input.surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            const status = await withTimeout(
                api.mission.executeAction({ missionId }, this.resolveMissionActionId(input.action)),
                2500,
                `Mission command '${input.action}' timed out.`
            );

            return await this.buildMissionRuntimeSnapshot({
                api,
                missionId,
                status
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
    }): Promise<MissionRuntimeSnapshotDto> {
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

    public async getAirportHomeSnapshot(): Promise<AirportHomeSnapshotDto> {
        if (this.locals?.appContext.daemon.running === false) {
            return this.createEmptyAirportHomeSnapshot();
        }

        let daemon: Awaited<ReturnType<AirportWebGateway['connectSharedDaemonClient']>> | undefined;
        try {
            daemon = await this.connectSharedDaemonClient();
            const api = new DaemonApi(daemon.client);
            const status = await withTimeout(
                api.control.getStatus(),
                2500,
                'Airport home status request timed out.'
            );

            return airportHomeSnapshotDtoSchema.parse({
                ...(status.operationalMode ? { operationalMode: status.operationalMode } : {}),
                ...(status.control?.controlRoot ? { controlRoot: status.control.controlRoot } : {}),
                ...(status.control?.currentBranch ? { currentBranch: status.control.currentBranch } : {}),
                ...(typeof status.control?.settingsComplete === 'boolean'
                    ? { settingsComplete: status.control.settingsComplete }
                    : {}),
                repositories: (status.availableRepositories ?? []).map((repository) =>
                    this.toRepositoryCandidateDto(repository)
                ),
                ...(status.system?.state.airport.repositoryRootPath
                    ? { selectedRepositoryRoot: status.system.state.airport.repositoryRootPath }
                    : {})
            });
        } catch {
            return this.createEmptyAirportHomeSnapshot();
        } finally {
            daemon?.dispose();
        }
    }

    public async addRepository(repositoryPath: string): Promise<RepositoryCandidateDto> {
        const normalizedRepositoryPath = repositoryPath.trim();
        if (!normalizedRepositoryPath) {
            throw new Error('Repository registration requires a repositoryPath.');
        }

        const daemon = await this.connectSharedDaemonClient();
        try {
            const api = new DaemonApi(daemon.client);
            return this.toRepositoryCandidateDto(
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

    public async listVisibleGitHubRepositories(surfacePath?: string): Promise<GitHubVisibleRepositoryDto[]> {
        const daemon = await this.connectSharedDaemonClient(surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            const repositories = await withTimeout(
                api.control.listVisibleGitHubRepositories(),
                2500,
                'GitHub repository listing timed out.'
            );
            return repositories.map((repository) => githubVisibleRepositoryDtoSchema.parse(repository));
        } finally {
            daemon.dispose();
        }
    }

    public async cloneGitHubRepository(
        githubRepository: string,
        destinationPath: string
    ): Promise<RepositoryCandidateDto> {
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
            return this.toRepositoryCandidateDto(
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

    public async inspectRepositoryPath(repositoryPath: string): Promise<RepositoryCandidateDto> {
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
        return repositoryCandidateDtoSchema.parse({
            repositoryId: repositoryIdentity.repositoryId,
            repositoryRootPath: repositoryIdentity.repositoryRootPath,
            label: repositoryIdentity.githubRepository?.split('/').pop()
                ?? (path.basename(repositoryIdentity.repositoryRootPath) || repositoryIdentity.repositoryRootPath),
            description: repositoryIdentity.githubRepository ?? repositoryIdentity.repositoryRootPath,
            ...(repositoryIdentity.githubRepository ? { githubRepository: repositoryIdentity.githubRepository } : {})
        });
    }

    public async getRepositorySurfaceSnapshot(input: {
        repositoryId: string;
        repository?: RepositoryCandidateDto;
        repositoryRootPath?: string;
        selectedMissionId?: string;
    }): Promise<RepositorySurfaceSnapshotDto> {
        const repository = input.repository
            ?? await this.resolveRepositoryCandidate({
                repositoryId: input.repositoryId,
                repositoryRootPath: input.repositoryRootPath
            });

        const daemon = await this.connectSharedDaemonClient(repository.repositoryRootPath);
        try {
            const api = new DaemonApi(daemon.client);
            const status = await withTimeout(
                api.control.getStatus(),
                2500,
                'Repository surface status request timed out.'
            );
            const selectedMissionId = input.selectedMissionId?.trim();
            const selectedMission = selectedMissionId
                && (status.availableMissions ?? []).some((candidate) => candidate.missionId === selectedMissionId)
                ? await this.getMissionRuntimeSnapshot(selectedMissionId, repository.repositoryRootPath).catch(() => undefined)
                : undefined;

            return repositorySurfaceSnapshotDtoSchema.parse({
                repository,
                ...(status.operationalMode ? { operationalMode: status.operationalMode } : {}),
                ...(status.control?.controlRoot ? { controlRoot: status.control.controlRoot } : {}),
                ...(status.control?.currentBranch ? { currentBranch: status.control.currentBranch } : {}),
                ...(typeof status.control?.settingsComplete === 'boolean'
                    ? { settingsComplete: status.control.settingsComplete }
                    : {}),
                ...(status.control?.githubRepository ? { githubRepository: status.control.githubRepository } : {}),
                missions: (status.availableMissions ?? []).map((mission) => this.toMissionSelectionCandidateDto(mission)),
                ...(selectedMissionId ? { selectedMissionId } : {}),
                ...(selectedMission ? { selectedMission } : {})
            });
        } finally {
            daemon.dispose();
        }
    }

    public async getRepositoryIssueDetail(input: {
        repositoryId: string;
        repositoryRootPath?: string;
        issueNumber: number;
    }): Promise<GitHubIssueDetailDto> {
        const repositoryRootPath = input.repositoryRootPath?.trim()
            || (await this.resolveRepositoryCandidate({
                repositoryId: input.repositoryId
            })).repositoryRootPath;

        const daemon = await this.connectSharedDaemonClient(repositoryRootPath);
        try {
            const api = new DaemonApi(daemon.client);
            return githubIssueDetailDtoSchema.parse(
                await withTimeout(
                    api.control.getGitHubIssueDetail(input.issueNumber),
                    2500,
                    'Repository issue detail request timed out.'
                )
            );
        } finally {
            daemon.dispose();
        }
    }

    public async createMissionFromIssue(input: {
        repositoryId: string;
        issueNumber: number;
    }): Promise<OperatorStatus> {
        const repositoryId = input.repositoryId.trim();
        if (!repositoryId) {
            throw new Error('Mission creation from issue requires a repositoryId.');
        }

        const repository = await this.resolveRepositoryCandidate({ repositoryId });

        const daemon = await this.connectSharedDaemonClient(repository.repositoryRootPath);
        try {
            const api = new DaemonApi(daemon.client);
            return await withTimeout(
                api.mission.fromIssue(input.issueNumber),
                8000,
                'Mission creation from issue timed out.'
            );
        } finally {
            daemon.dispose();
        }
    }

    public async createMissionFromBrief(input: {
        repositoryId: string;
        brief: {
            title: string;
            body: string;
            type: 'feature' | 'fix' | 'docs' | 'refactor' | 'task';
        };
    }): Promise<OperatorStatus> {
        const repositoryId = input.repositoryId.trim();
        if (!repositoryId) {
            throw new Error('Mission creation from brief requires a repositoryId.');
        }

        const repository = await this.resolveRepositoryCandidate({ repositoryId });

        const daemon = await this.connectSharedDaemonClient(repository.repositoryRootPath);
        try {
            const api = new DaemonApi(daemon.client);
            return await withTimeout(
                api.mission.fromBrief({
                    brief: {
                        title: input.brief.title.trim(),
                        body: input.brief.body.trim(),
                        type: input.brief.type
                    }
                }),
                8000,
                'Mission creation from brief timed out.'
            );
        } finally {
            daemon.dispose();
        }
    }

    public async openEventSubscription(input: {
        missionId?: string;
        surfacePath?: string;
        onEvent: (event: AirportRuntimeEventEnvelopeDto) => void;
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
    }): Promise<MissionSessionTerminalSnapshotDto> {
        const missionId = input.missionId.trim();
        const sessionId = input.sessionId.trim();
        if (!missionId || !sessionId) {
            return missionSessionTerminalSnapshotDtoSchema.parse({
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
                return missionSessionTerminalSnapshotDtoSchema.parse({
                    missionId,
                    sessionId,
                    connected: false,
                    dead: true,
                    exitCode: null,
                    screen: ''
                });
            }

            const terminalScreen = clipTerminalScreen(state.screen);

            return missionSessionTerminalSnapshotDtoSchema.parse({
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
    }): Promise<MissionSessionTerminalSnapshotDto> {
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
            return missionSessionTerminalSnapshotDtoSchema.parse({
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
    }): Promise<MissionTerminalSnapshotDto> {
        const missionId = input.missionId.trim();
        if (!missionId) {
            return missionTerminalSnapshotDtoSchema.parse({
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
                return missionTerminalSnapshotDtoSchema.parse({
                    missionId,
                    connected: false,
                    dead: true,
                    exitCode: null,
                    screen: ''
                });
            }

            const terminalScreen = clipTerminalScreen(state.screen);

            return missionTerminalSnapshotDtoSchema.parse({
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
    }): Promise<MissionTerminalSnapshotDto> {
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
            return missionTerminalSnapshotDtoSchema.parse({
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
        action: 'start' | 'complete' | 'block' | 'reopen'
    ): string {
        switch (action) {
            case 'start':
                return `task.start.${taskId}`;
            case 'complete':
                return `task.done.${taskId}`;
            case 'block':
                return `task.block.${taskId}`;
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

    private toRuntimeEventEnvelope(event: Notification): AirportRuntimeEventEnvelopeDto {
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
                return event.status.workflow?.updatedAt ?? new Date().toISOString();
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

    private toMissionStatusSummary(status: OperatorStatus, missionId: string) {
        const workflow = status.workflow;
        const tasksById = new Map((workflow?.tasks ?? []).map((task) => [task.taskId, task]));

        return {
            missionId: status.missionId?.trim() || missionId,
            ...(status.operationalMode ? { operationalMode: status.operationalMode } : {}),
            ...(workflow
                ? {
                    workflow: {
                        ...(workflow.lifecycle ? { lifecycle: workflow.lifecycle } : {}),
                        ...(workflow.updatedAt ? { updatedAt: workflow.updatedAt } : {}),
                        ...(workflow.currentStageId ? { currentStageId: workflow.currentStageId } : {}),
                        stages: workflow.stages.map((stage) => ({
                            stageId: stage.stageId,
                            lifecycle: stage.lifecycle,
                            isCurrentStage: workflow.currentStageId === stage.stageId,
                            artifacts: this.toStageArtifacts(stage.stageId),
                            tasks: stage.taskIds
                                .map((taskId) => tasksById.get(taskId))
                                .filter((task): task is NonNullable<typeof task> => Boolean(task))
                                .map((task) => ({
                                    taskId: task.taskId,
                                    title: task.title,
                                    lifecycle: task.lifecycle,
                                    dependsOn: task.dependsOn,
                                    blockedByTaskIds: task.blockedByTaskIds
                                }))
                        }))
                    }
                }
                : {})
        };
    }

    private toStageArtifacts(stageId: string): Array<{ key: string; label: string; fileName: string }> {
        if (!isMissionStageId(stageId)) {
            return [];
        }

        try {
            const stageDefinition = getMissionStageDefinition(stageId);
            return stageDefinition.artifacts.map((artifactKey) => {
                const artifact = getMissionArtifactDefinition(artifactKey);
                return {
                    key: artifact.key,
                    label: artifact.label,
                    fileName: artifact.fileName
                };
            });
        } catch {
            return [];
        }
    }

    private toMissionSessionDto(session: MissionAgentSessionRecord): MissionAgentSessionDto {
        return missionAgentSessionDtoSchema.parse({
            sessionId: session.sessionId,
            runnerId: session.runnerId,
            ...(session.transportId ? { transportId: session.transportId } : {}),
            runnerLabel: session.runnerLabel,
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
        session: MissionAgentSessionRecord;
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

    private toRepositoryCandidateDto(repository: RepositoryCandidate & { repositoryId?: string }): RepositoryCandidateDto {
        return repositoryCandidateDtoSchema.parse({
            repositoryId: repository.repositoryId,
            repositoryRootPath: repository.repositoryRootPath,
            label: repository.label,
            description: repository.description,
            ...(repository.githubRepository ? { githubRepository: repository.githubRepository } : {})
        });
    }

    private toMissionSelectionCandidateDto(candidate: MissionSelectionCandidate): MissionSelectionCandidateDto {
        return missionSelectionCandidateDtoSchema.parse({
            missionId: candidate.missionId,
            title: candidate.title,
            branchRef: candidate.branchRef,
            createdAt: candidate.createdAt,
            ...(candidate.issueId !== undefined ? { issueId: candidate.issueId } : {})
        });
    }

    private toTrackedIssueSummaryDto(issue: TrackedIssueSummary): TrackedIssueSummaryDto {
        return trackedIssueSummaryDtoSchema.parse({
            number: issue.number,
            title: issue.title,
            url: issue.url,
            ...(issue.updatedAt ? { updatedAt: issue.updatedAt } : {}),
            labels: [...issue.labels],
            assignees: [...issue.assignees]
        });
    }

    public async resolveRepositoryCandidate(input: {
        repositoryId: string;
        repositoryRootPath?: string;
    }): Promise<RepositoryCandidateDto> {
        const repositoryId = input.repositoryId.trim();
        if (!repositoryId) {
            throw new Error('Repository access requires a repositoryId.');
        }

        const repositoryRootPath = input.repositoryRootPath?.trim();
        if (repositoryRootPath) {
            return repositoryCandidateDtoSchema.parse({
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

    private async connectSharedDaemonClient(surfacePath?: string) {
        return withTimeout(
            connectSharedAuthenticatedDaemonClient({
                locals: this.locals,
                allowStart: true,
                ...(surfacePath?.trim() ? { surfacePath: surfacePath.trim() } : {})
            }),
            5000,
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
            5000,
            'Mission daemon connection timed out.'
        );
    }

    private createEmptyAirportHomeSnapshot(): AirportHomeSnapshotDto {
        return airportHomeSnapshotDtoSchema.parse({
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