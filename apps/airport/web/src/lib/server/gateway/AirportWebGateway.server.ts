// /apps/airport/web/src/lib/server/gateway/AirportWebGateway.server.ts: Thin SvelteKit gateway over the existing Mission daemon API and notifications for Airport web.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
    DaemonApi,
    getMissionArtifactDefinition,
    getMissionStageDefinition,
    isMissionStageId,
    TerminalAgentTransport,
    type MissionRepositoryCandidate,
    type MissionSelectionCandidate,
    type MissionAgentSessionRecord,
    type Notification,
    type OperatorStatus,
    type TrackedIssueSummary
} from '@flying-pillow/mission-core';
import type {
    AirportHomeSnapshotDto,
    AirportRuntimeEventEnvelopeDto,
    GitHubIssueDetailDto,
    MissionAgentSessionDto,
    MissionSessionTerminalSnapshotDto,
    MissionRuntimeSnapshotDto,
    MissionSelectionCandidateDto,
    RepositoryCandidateDto,
    RepositorySurfaceSnapshotDto,
    TrackedIssueSummaryDto
} from '@flying-pillow/mission-core';
import {
    airportHomeSnapshotDtoSchema,
    airportRuntimeEventEnvelopeSchema,
    githubIssueDetailDtoSchema,
    missionAgentSessionDtoSchema,
    missionSessionTerminalSnapshotDtoSchema,
    missionRuntimeSnapshotDtoSchema,
    missionSelectionCandidateDtoSchema,
    repositoryCandidateDtoSchema,
    repositorySurfaceSnapshotDtoSchema,
    trackedIssueSummaryDtoSchema
} from '@flying-pillow/mission-core';
import { connectAuthenticatedDaemonClient, logAirportWebPerf } from '$lib/server/daemon.server';
import { fetchGitHubIssueDetail } from '$lib/server/github-issues.server';

export class AirportWebGateway {
    public constructor(private readonly locals?: App.Locals) { }

    public async getRepositoryIssues(input: {
        repositoryId: string;
        repositoryRootPath?: string;
    }): Promise<TrackedIssueSummaryDto[]> {
        const startedAt = performance.now();
        const repositoryRootPath = input.repositoryRootPath?.trim()
            || (await this.resolveRepositoryCandidate({
                repositoryId: input.repositoryId
            })).repositoryRootPath;

        const daemon = await this.connectDaemon(repositoryRootPath);
        try {
            const api = new DaemonApi(daemon.client);
            const statusStartedAt = performance.now();
            const status = await withTimeout(
                api.control.getStatus(),
                2500,
                'Repository issues status request timed out.'
            );
            logAirportWebPerf('gateway.repositoryIssues.controlStatus', statusStartedAt, {
                repositoryId: input.repositoryId,
                repositoryRootPath
            });

            if (status.control?.trackingProvider !== 'github') {
                return [];
            }

            const issuesStartedAt = performance.now();
            const issues = await withTimeout(
                api.control.listOpenIssues(25),
                2500,
                'Issue listing timed out.'
            ).catch(() => []);
            logAirportWebPerf('gateway.repositoryIssues.listOpenIssues', issuesStartedAt, {
                repositoryId: input.repositoryId,
                repositoryRootPath,
                issueCount: issues.length
            });

            return issues.map((issue) => this.toTrackedIssueSummaryDto(issue));
        } finally {
            logAirportWebPerf('gateway.repositoryIssues.total', startedAt, {
                repositoryId: input.repositoryId,
                repositoryRootPath
            });
            daemon.dispose();
        }
    }

    public async getMissionRuntimeSnapshot(missionId: string, surfacePath?: string): Promise<MissionRuntimeSnapshotDto> {
        const startedAt = performance.now();
        const normalizedMissionId = missionId.trim();
        if (!normalizedMissionId) {
            throw new Error('Mission runtime snapshot requires a missionId.');
        }

        const daemon = await this.connectDaemon(surfacePath);
        try {
            const api = new DaemonApi(daemon.client);
            const [status, sessions] = await Promise.all([
                withTimeout(api.mission.getStatus({ missionId: normalizedMissionId }), 2500, 'Mission status request timed out.'),
                withTimeout(api.mission.listSessions({ missionId: normalizedMissionId }), 2500, 'Mission session listing timed out.')
            ]);

            return missionRuntimeSnapshotDtoSchema.parse({
                missionId: normalizedMissionId,
                status: this.toMissionStatusSummary(status, normalizedMissionId),
                sessions: sessions.map((session) => this.toMissionSessionDto(session))
            });
        } finally {
            logAirportWebPerf('gateway.missionRuntimeSnapshot.total', startedAt, {
                missionId: normalizedMissionId,
                surfacePath: surfacePath?.trim()
            });
            daemon.dispose();
        }
    }

    public async getAirportHomeSnapshot(): Promise<AirportHomeSnapshotDto> {
        const startedAt = performance.now();
        if (this.locals?.appContext.daemon.running === false) {
            return this.createEmptyAirportHomeSnapshot();
        }

        let daemon: Awaited<ReturnType<AirportWebGateway['connectDaemon']>> | undefined;
        try {
            daemon = await this.connectDaemon();
            const api = new DaemonApi(daemon.client);
            const statusStartedAt = performance.now();
            const status = await withTimeout(
                api.control.getStatus(),
                2500,
                'Airport home status request timed out.'
            );
            logAirportWebPerf('gateway.airportHome.controlStatus', statusStartedAt, {
                repositoryCount: status.availableRepositories?.length ?? 0
            });

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
            logAirportWebPerf('gateway.airportHome.total', startedAt);
            daemon?.dispose();
        }
    }

    public async addRepository(repositoryPath: string): Promise<RepositoryCandidateDto> {
        const normalizedRepositoryPath = repositoryPath.trim();
        if (!normalizedRepositoryPath) {
            throw new Error('Repository registration requires a repositoryPath.');
        }

        const daemon = await this.connectDaemon();
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

    public async getRepositorySurfaceSnapshot(input: {
        repositoryId: string;
        repository?: RepositoryCandidateDto;
        repositoryRootPath?: string;
        selectedMissionId?: string;
    }): Promise<RepositorySurfaceSnapshotDto> {
        const startedAt = performance.now();
        const repository = input.repository
            ?? await this.resolveRepositoryCandidate({
                repositoryId: input.repositoryId,
                repositoryRootPath: input.repositoryRootPath
            });

        const daemon = await this.connectDaemon(repository.repositoryRootPath);
        try {
            const api = new DaemonApi(daemon.client);
            const statusStartedAt = performance.now();
            const status = await withTimeout(
                api.control.getStatus(),
                2500,
                'Repository surface status request timed out.'
            );
            logAirportWebPerf('gateway.repositorySurface.controlStatus', statusStartedAt, {
                repositoryId: input.repositoryId,
                repositoryRootPath: repository.repositoryRootPath,
                missionCount: status.availableMissions?.length ?? 0
            });
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
            logAirportWebPerf('gateway.repositorySurface.total', startedAt, {
                repositoryId: input.repositoryId,
                repositoryRootPath: repository.repositoryRootPath,
                selectedMissionId: input.selectedMissionId?.trim()
            });
            daemon.dispose();
        }
    }

    public async getRepositoryIssueDetail(input: {
        repositoryId: string;
        repositoryRootPath?: string;
        issueNumber: number;
    }): Promise<GitHubIssueDetailDto> {
        const startedAt = performance.now();
        const repositoryRootPath = input.repositoryRootPath?.trim()
            || (await this.resolveRepositoryCandidate({
                repositoryId: input.repositoryId
            })).repositoryRootPath;

        const daemon = await this.connectDaemon(repositoryRootPath);
        try {
            const api = new DaemonApi(daemon.client);
            const status = await withTimeout(
                api.control.getStatus(),
                2500,
                'Repository issue detail status request timed out.'
            );

            if (status.control?.trackingProvider !== 'github') {
                throw new Error('This repository is not configured for GitHub issue tracking.');
            }

            return this.getGitHubIssueDetail({
                repositoryRootPath,
                githubRepository: status.control?.githubRepository,
                issueNumber: input.issueNumber
            });
        } finally {
            logAirportWebPerf('gateway.repositoryIssueDetail.total', startedAt, {
                repositoryId: input.repositoryId,
                repositoryRootPath,
                issueNumber: input.issueNumber
            });
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

        const daemon = await this.connectDaemon(repositoryId);
        try {
            const api = new DaemonApi(daemon.client);
            return await withTimeout(
                api.mission.fromIssue(input.issueNumber),
                2500,
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

        const daemon = await this.connectDaemon(repositoryId);
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
                2500,
                'Mission creation from brief timed out.'
            );
        } finally {
            daemon.dispose();
        }
    }

    public async openEventSubscription(input: {
        missionId?: string;
        onEvent: (event: AirportRuntimeEventEnvelopeDto) => void;
    }): Promise<{ dispose(): void }> {
        const missionId = input.missionId?.trim();
        const daemon = await this.connectDaemon();
        const subscription = daemon.client.onDidEvent((event) => {
            if (!this.matchesMission(event, missionId)) {
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
    }): Promise<MissionSessionTerminalSnapshotDto> {
        const context = await this.resolveTerminalSessionContext(input);
        if (!context) {
            return missionSessionTerminalSnapshotDtoSchema.parse({
                missionId: input.missionId.trim(),
                sessionId: input.sessionId.trim(),
                connected: false,
                dead: true,
                exitCode: null,
                screen: ''
            });
        }

        const terminalTransport = new TerminalAgentTransport({
            ...(context.sharedSessionName ? { sharedSessionName: context.sharedSessionName } : {})
        });
        const handle = await terminalTransport.attachSession(context.session.terminalSessionName as string, {
            ...(context.sharedSessionName ? { sharedSessionName: context.sharedSessionName } : {}),
            ...(context.session.terminalPaneId ? { paneId: context.session.terminalPaneId } : {})
        });
        if (!handle) {
            return missionSessionTerminalSnapshotDtoSchema.parse({
                missionId: context.missionId,
                sessionId: context.session.sessionId,
                connected: false,
                dead: true,
                exitCode: null,
                screen: ''
            });
        }

        const [paneState, screen] = await Promise.all([
            terminalTransport.readPaneState(handle),
            terminalTransport.capturePane(handle).catch(() => '')
        ]);

        return missionSessionTerminalSnapshotDtoSchema.parse({
            missionId: context.missionId,
            sessionId: context.session.sessionId,
            connected: true,
            dead: paneState.dead,
            exitCode: paneState.dead ? paneState.exitCode : null,
            screen,
            terminalHandle: {
                sessionName: handle.sessionName,
                paneId: handle.paneId,
                ...(handle.sharedSessionName ? { sharedSessionName: handle.sharedSessionName } : {})
            }
        });
    }

    public async sendMissionSessionTerminalInput(input: {
        missionId: string;
        sessionId: string;
        data: string;
        literal?: boolean;
    }): Promise<MissionSessionTerminalSnapshotDto> {
        const context = await this.resolveTerminalSessionContext(input);
        if (!context) {
            throw new Error(`Mission session '${input.sessionId}' is not available as a terminal-backed session.`);
        }

        const terminalTransport = new TerminalAgentTransport({
            ...(context.sharedSessionName ? { sharedSessionName: context.sharedSessionName } : {})
        });
        const handle = await terminalTransport.attachSession(context.session.terminalSessionName as string, {
            ...(context.sharedSessionName ? { sharedSessionName: context.sharedSessionName } : {}),
            ...(context.session.terminalPaneId ? { paneId: context.session.terminalPaneId } : {})
        });
        if (!handle) {
            throw new Error(`Unable to attach terminal handle for session '${input.sessionId}'.`);
        }

        await terminalTransport.sendKeys(handle, input.data, {
            ...(input.literal !== undefined ? { literal: input.literal } : {})
        });

        return this.getMissionSessionTerminalSnapshot({
            missionId: context.missionId,
            sessionId: context.session.sessionId
        });
    }

    private matchesMission(event: Notification, missionId?: string): boolean {
        if (!missionId) {
            return event.type !== 'control.workflow.settings.updated';
        }

        switch (event.type) {
            case 'mission.actions.changed':
            case 'mission.status':
            case 'session.console':
            case 'session.event':
            case 'session.lifecycle':
                return event.missionId === missionId;
            case 'airport.state':
                return true;
            case 'control.workflow.settings.updated':
                return false;
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
            case 'session.event':
            case 'session.lifecycle':
                return event.missionId;
            case 'airport.state':
            case 'control.workflow.settings.updated':
                return undefined;
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

        const daemon = await this.connectDaemon();
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

            const sharedSessionName = await withTimeout(
                api.airport.getStatus(),
                2500,
                'Airport status request timed out.'
            )
                .then((status) => status.state.airport.substrate.sessionName)
                .catch(() => undefined);

            return {
                missionId,
                session,
                ...(sharedSessionName ? { sharedSessionName } : {})
            };
        } finally {
            daemon.dispose();
        }
    }

    private toRepositoryCandidateDto(repository: MissionRepositoryCandidate & { repositoryId?: string }): RepositoryCandidateDto {
        return repositoryCandidateDtoSchema.parse({
            repositoryId: repository.repositoryId ?? repository.repositoryRootPath,
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

    private async resolveRepositoryCandidate(input: {
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

    private async getGitHubIssueDetail(input: {
        repositoryRootPath: string;
        githubRepository?: string;
        issueNumber: number;
    }): Promise<GitHubIssueDetailDto> {
        return githubIssueDetailDtoSchema.parse(
            await fetchGitHubIssueDetail({
                workspaceRoot: input.repositoryRootPath,
                issueNumber: input.issueNumber,
                repository: input.githubRepository,
                authToken: this.locals?.githubAuthToken
            })
        );
    }

    private async connectDaemon(surfacePath?: string) {
        return withTimeout(
            connectAuthenticatedDaemonClient({
                locals: this.locals,
                allowStart: false,
                ...(surfacePath?.trim() ? { surfacePath: surfacePath.trim() } : {})
            }),
            2000,
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