import { randomUUID } from 'node:crypto';
import type { AgentSession } from './AgentSession.js';
import type {
    AgentCommand,
    AgentLaunchConfig,
    AgentPrompt,
    AgentRunnerCapabilities,
    AgentRunnerId,
    AgentSessionEvent,
    AgentSessionId,
    AgentSessionReference,
    AgentSessionSnapshot
} from './AgentRuntimeTypes.js';
import { deriveAgentSessionInteractionCapabilities } from './AgentRuntimeTypes.js';
import {
    TerminalAgentTransport,
    type TerminalAgentTransportOptions,
    type TerminalSessionOwner
} from './TerminalAgentTransport.js';
import { Repository } from '../../../entities/Repository/Repository.js';
import type { AgentSessionSignalDecision } from './signals/AgentSessionSignal.js';

export type AgentRunnerDefinition = {
    id: AgentRunnerId;
    displayName: string;
};

export type AgentRunnerSessionController = {
    done(): Promise<AgentSessionSnapshot>;
    submitPrompt(prompt: AgentPrompt): Promise<AgentSessionSnapshot>;
    submitCommand(command: AgentCommand): Promise<AgentSessionSnapshot>;
    cancel(reason?: string): Promise<AgentSessionSnapshot>;
    terminate(reason?: string): Promise<AgentSessionSnapshot>;
    dispose?(): void;
};

export type AgentRunnerTerminalSessionHandle = {
    sessionName: string;
    sharedSessionName?: string | undefined;
    paneId: string;
};

export type AgentRunnerTerminalSessionState = {
    dead: boolean;
    exitCode: number | null;
};

export type AgentRunnerTerminalRuntimeOptions = {
    command: string;
    args?: string[];
    env?: NodeJS.ProcessEnv;
    sessionPrefix?: string;
    pollIntervalMs?: number;
    logLine?: (line: string) => void;
    openSession(request: {
        workingDirectory: string;
        command: string;
        args: string[];
        env?: NodeJS.ProcessEnv;
        sessionPrefix: string;
        sessionName: string;
        sharedSessionName?: string | undefined;
        owner?: TerminalSessionOwner;
    }): Promise<AgentRunnerTerminalSessionHandle>;
    attachSession(
        sessionId: string,
        options: { sharedSessionName?: string | undefined; paneId?: string | undefined }
    ): Promise<AgentRunnerTerminalSessionHandle | undefined>;
    sendKeys(
        handle: AgentRunnerTerminalSessionHandle,
        keys: string,
        options?: { literal?: boolean }
    ): Promise<void>;
    capturePane(handle: AgentRunnerTerminalSessionHandle): Promise<string>;
    readPaneState(handle: AgentRunnerTerminalSessionHandle): Promise<AgentRunnerTerminalSessionState>;
    killSession(handle: AgentRunnerTerminalSessionHandle): Promise<AgentRunnerTerminalSessionState>;
    isAvailable(): Promise<{ available: boolean; reason?: string }>;
};

export type AgentRunnerTerminalTransportRuntimeOptions = {
    command: string;
    args?: string[];
    env?: NodeJS.ProcessEnv;
    sessionPrefix?: string;
    pollIntervalMs?: number;
    logLine?: (line: string) => void;
    terminalBinary?: TerminalAgentTransportOptions['terminalBinary'];
    sharedSessionName?: TerminalAgentTransportOptions['sharedSessionName'];
    agentSessionPaneTitle?: TerminalAgentTransportOptions['agentSessionPaneTitle'];
    discoverSharedSessionName?: TerminalAgentTransportOptions['discoverSharedSessionName'];
    executor?: TerminalAgentTransportOptions['executor'];
    spawn?: TerminalAgentTransportOptions['spawn'];
    processController?: TerminalAgentTransportOptions['processController'];
    terminationGraceMs?: TerminalAgentTransportOptions['terminationGraceMs'];
    terminationPollIntervalMs?: TerminalAgentTransportOptions['terminationPollIntervalMs'];
};

type ManagedSessionRecord = {
    snapshot: AgentSessionSnapshot;
    controller: AgentRunnerSessionController;
    listeners: Set<(event: AgentSessionEvent) => void>;
};

type SnapshotOverrides = Omit<Partial<AgentSessionSnapshot>, 'failureMessage'> & {
    failureMessage?: string | undefined;
};

type ConfiguredTerminalRuntime = {
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv | undefined;
    sessionPrefix: string;
    pollIntervalMs: number;
    logLine: ((line: string) => void) | undefined;
    openSession: AgentRunnerTerminalRuntimeOptions['openSession'];
    attachSession: AgentRunnerTerminalRuntimeOptions['attachSession'];
    sendKeys: AgentRunnerTerminalRuntimeOptions['sendKeys'];
    capturePane: AgentRunnerTerminalRuntimeOptions['capturePane'];
    readPaneState: AgentRunnerTerminalRuntimeOptions['readPaneState'];
    killSession: AgentRunnerTerminalRuntimeOptions['killSession'];
    isAvailable: AgentRunnerTerminalRuntimeOptions['isAvailable'];
};

type ManagedTerminalSessionRecord = {
    transportHandle: AgentRunnerTerminalSessionHandle;
    lastCapture: string;
    pollTimer: ReturnType<typeof setInterval> | undefined;
    polling: boolean;
    pollFailureCount: number;
};

const MAX_TERMINAL_POLL_FAILURES = 3;

export abstract class AgentRunner {
    public readonly id: AgentRunnerId;
    public readonly displayName: string;

    private readonly sessions = new Map<AgentSessionId, ManagedSessionRecord>();
    private readonly terminalSessions = new Map<AgentSessionId, ManagedTerminalSessionRecord>();
    private terminalRuntime: ConfiguredTerminalRuntime | undefined;

    public constructor(definition: AgentRunnerDefinition) {
        this.id = definition.id.trim();
        this.displayName = definition.displayName.trim();
        if (!this.id) {
            throw new Error('AgentRunner requires a non-empty id.');
        }
        if (!this.displayName) {
            throw new Error(`AgentRunner '${this.id}' requires a non-empty display name.`);
        }
    }

    public abstract getCapabilities(): Promise<AgentRunnerCapabilities>;

    public abstract isAvailable(): Promise<{ available: boolean; reason?: string }>;

    public async validateLaunchConfig(config: AgentLaunchConfig): Promise<void> {
        if (!config.missionId.trim()) {
            throw new Error(`${this.displayName} requires a mission identifier.`);
        }
        if (!config.workingDirectory.trim()) {
            throw new Error(`${this.displayName} requires a working directory.`);
        }
        if (!config.task.taskId.trim()) {
            throw new Error(`${this.displayName} requires a task identifier.`);
        }
        if (!config.task.stageId.trim()) {
            throw new Error(`${this.displayName} requires a stage identifier.`);
        }
        if (!config.task.title.trim()) {
            throw new Error(`${this.displayName} requires a task title.`);
        }
        if (!config.task.instruction.trim()) {
            throw new Error(`${this.displayName} requires task instructions.`);
        }
        if (!config.specification.summary.trim()) {
            throw new Error(`${this.displayName} requires a specification summary.`);
        }
        await this.onValidateLaunchConfig(config);
    }

    public async startSession(config: AgentLaunchConfig): Promise<AgentSession> {
        await this.validateLaunchConfig(config);
        const availability = await this.isAvailable();
        if (!availability.available) {
            throw new Error(availability.reason ?? `${this.displayName} is unavailable.`);
        }
        return this.onStartSession(config);
    }

    public async reconcileSession(reference: AgentSessionReference): Promise<AgentSession> {
        return this.onReconcileSession(reference);
    }

    public dispose(): void {
        for (const sessionId of this.sessions.keys()) {
            this.disposeManagedSession(sessionId);
        }
    }

    protected async onValidateLaunchConfig(_config: AgentLaunchConfig): Promise<void> {
        return;
    }

    protected abstract onStartSession(config: AgentLaunchConfig): Promise<AgentSession>;

    protected abstract onReconcileSession(reference: AgentSessionReference): Promise<AgentSession>;

    protected configureTerminalCommandRuntime(options: AgentRunnerTerminalRuntimeOptions): void {
        const command = options.command.trim();
        if (!command) {
            throw new Error(`${this.displayName} requires a command.`);
        }
        this.terminalRuntime = {
            command,
            args: options.args ? [...options.args] : [],
            env: options.env,
            sessionPrefix: options.sessionPrefix?.trim() || 'mission-agent',
            pollIntervalMs: Math.max(100, options.pollIntervalMs ?? 1000),
            logLine: options.logLine,
            openSession: options.openSession,
            attachSession: options.attachSession,
            sendKeys: options.sendKeys,
            capturePane: options.capturePane,
            readPaneState: options.readPaneState,
            killSession: options.killSession,
            isAvailable: options.isAvailable
        };
    }

    protected configureTerminalTransportRuntime(options: AgentRunnerTerminalTransportRuntimeOptions): void {
        const transport = new TerminalAgentTransport({
            ...(options.terminalBinary ? { terminalBinary: options.terminalBinary } : {}),
            ...(options.sharedSessionName ? { sharedSessionName: options.sharedSessionName } : {}),
            ...(options.agentSessionPaneTitle ? { agentSessionPaneTitle: options.agentSessionPaneTitle } : {}),
            ...(options.discoverSharedSessionName !== undefined ? { discoverSharedSessionName: options.discoverSharedSessionName } : {}),
            ...(options.executor ? { executor: options.executor } : {}),
            ...(options.spawn ? { spawn: options.spawn } : {}),
            ...(options.logLine ? { logLine: options.logLine } : {}),
            ...(options.processController ? { processController: options.processController } : {}),
            ...(options.terminationGraceMs !== undefined ? { terminationGraceMs: options.terminationGraceMs } : {}),
            ...(options.terminationPollIntervalMs !== undefined ? { terminationPollIntervalMs: options.terminationPollIntervalMs } : {})
        });
        this.configureTerminalCommandRuntime({
            command: options.command,
            ...(options.args ? { args: [...options.args] } : {}),
            ...(options.env ? { env: options.env } : {}),
            ...(options.sessionPrefix ? { sessionPrefix: options.sessionPrefix } : {}),
            ...(options.pollIntervalMs ? { pollIntervalMs: options.pollIntervalMs } : {}),
            ...(options.logLine ? { logLine: options.logLine } : {}),
            openSession: (request) => transport.openSession({
                workingDirectory: request.workingDirectory,
                command: request.command,
                args: request.args,
                ...(request.env ? { env: request.env } : {}),
                sessionPrefix: request.sessionPrefix,
                sessionName: request.sessionName,
                ...(request.sharedSessionName ? { sharedSessionName: request.sharedSessionName } : {}),
                ...(request.owner ? { owner: request.owner } : {})
            }),
            attachSession: (sessionId, attachOptions) => transport.attachSession(sessionId, attachOptions),
            sendKeys: (handle, keys, sendOptions) => transport.sendKeys(handle, keys, sendOptions),
            capturePane: (handle) => transport.capturePane(handle),
            readPaneState: (handle) => transport.readPaneState(handle),
            killSession: (handle) => transport.killSession(handle),
            isAvailable: async () => {
                const availability = await transport.isAvailable();
                return availability.available
                    ? { available: true }
                    : { available: false, ...(availability.detail ? { reason: availability.detail } : {}) };
            }
        });
    }

    protected async getTerminalCommandCapabilities(): Promise<AgentRunnerCapabilities> {
        this.requireTerminalRuntime();
        return {
            acceptsPromptSubmission: true,
            acceptsCommands: true,
            supportsInterrupt: true,
            supportsResumeByReference: true,
            supportsCheckpoint: true,
            shareModes: ['terminal']
        };
    }

    protected async isTerminalCommandRuntimeAvailable(): Promise<{ available: boolean; reason?: string }> {
        return this.requireTerminalRuntime().isAvailable();
    }

    protected async startTerminalCommandSession(
        config: AgentLaunchConfig,
        options: {
            sessionId?: string;
            launchCommand?: string;
            launchArgs?: string[];
            launchEnv?: NodeJS.ProcessEnv;
            replaceBaseArgs?: boolean;
            skipInitialPromptSubmission?: boolean;
        } = {}
    ): Promise<AgentSession> {
        const runtime = this.requireTerminalRuntime();
        const requestedSharedSessionName = getRequestedTerminalSessionName(config);
        const sessionId = options.sessionId?.trim() || buildFreshAgentSessionId(config.task.taskId, this.id);
        const launchCommand = options.launchCommand?.trim() || runtime.command;
        if (!launchCommand) {
            throw new Error(`${this.displayName} requires a non-empty launch command.`);
        }
        const launchArgs = [
            ...(options.replaceBaseArgs ? [] : runtime.args),
            ...(options.launchArgs ?? [])
        ];
        const launchEnv = options.launchEnv ?? runtime.env;
        const transportHandle = await runtime.openSession({
            workingDirectory: config.workingDirectory,
            command: launchCommand,
            args: launchArgs,
            ...(launchEnv ? { env: launchEnv } : {}),
            sessionPrefix: runtime.sessionPrefix,
            sessionName: buildTaskTerminalSessionName(config.workingDirectory, config.missionId, config.task.taskId, sessionId),
            ...(requestedSharedSessionName ? { sharedSessionName: requestedSharedSessionName } : {}),
            owner: {
                kind: 'agent-session',
                missionId: config.missionId,
                taskId: config.task.taskId,
                agentSessionId: sessionId
            }
        });

        const snapshot = createRunningSnapshot({
            runnerId: this.id,
            sessionId,
            workingDirectory: config.workingDirectory,
            taskId: config.task.taskId,
            missionId: config.missionId,
            stageId: config.task.stageId,
            transport: toSnapshotTransport(transportHandle)
        });
        this.registerTerminalHandle(sessionId, transportHandle, snapshot);
        const session = this.createManagedSession({
            snapshot,
            controller: this.createTerminalSessionController(sessionId)
        });

        if (!options.skipInitialPromptSubmission && config.initialPrompt?.text) {
            await session.submitPrompt(config.initialPrompt);
        }

        return session;
    }

    protected async reconcileTerminalCommandSession(reference: AgentSessionReference): Promise<AgentSession> {
        const runtime = this.requireTerminalRuntime();
        if (this.terminalSessions.has(reference.sessionId)) {
            return this.attachManagedSession(reference.sessionId);
        }

        const transportHandle = reference.transport?.paneId
            ? await runtime.attachSession(reference.transport.terminalSessionName, {
                sharedSessionName: reference.transport.terminalSessionName,
                paneId: reference.transport.paneId
            })
            : await runtime.attachSession(reference.transport?.terminalSessionName ?? reference.sessionId, {
                sharedSessionName: reference.transport?.terminalSessionName
            });
        if (!transportHandle) {
            return this.createDetachedSession(
                createDetachedTerminalSnapshot(this.id, reference, 'Session no longer exists in terminal transport.')
            );
        }

        const paneState = await runtime.readPaneState(transportHandle);
        const initialCapture = paneState.dead ? '' : await runtime.capturePane(transportHandle).catch(() => '');
        const snapshot = paneState.dead
            ? createTerminalSnapshot({
                runnerId: this.id,
                sessionId: reference.sessionId,
                workingDirectory: 'unknown',
                taskId: 'unknown',
                missionId: 'unknown',
                stageId: 'unknown',
                transport: toSnapshotTransport(transportHandle),
                status: paneState.exitCode === 0 ? 'completed' : 'failed',
                progressState: paneState.exitCode === 0 ? 'done' : 'failed',
                acceptsPrompts: false,
                acceptedCommands: [],
                ...(paneState.exitCode === 0
                    ? {}
                    : { failureMessage: `terminal command exited with status ${String(paneState.exitCode)}.` }),
                endedAt: new Date().toISOString()
            })
            : createRunningSnapshot({
                runnerId: this.id,
                sessionId: reference.sessionId,
                workingDirectory: 'unknown',
                taskId: 'unknown',
                missionId: 'unknown',
                stageId: 'unknown',
                transport: toSnapshotTransport(transportHandle)
            });
        this.registerTerminalHandle(reference.sessionId, transportHandle, snapshot, initialCapture);
        return this.createManagedSession({
            snapshot,
            controller: this.createTerminalSessionController(reference.sessionId)
        });
    }

    protected createManagedSession(input: {
        snapshot: AgentSessionSnapshot;
        controller: AgentRunnerSessionController;
    }): AgentSession {
        const existing = this.sessions.get(input.snapshot.sessionId);
        if (existing) {
            existing.controller.dispose?.();
        }
        this.sessions.set(input.snapshot.sessionId, {
            snapshot: cloneSnapshot(input.snapshot),
            controller: input.controller,
            listeners: new Set()
        });
        return this.attachManagedSession(input.snapshot.sessionId);
    }

    protected attachManagedSession(sessionId: AgentSessionId): AgentSession {
        this.requireManagedSessionRecord(sessionId);
        return new ManagedAgentSession({
            getSnapshot: () => this.getManagedSnapshot(sessionId),
            observe: (listener) => this.observeManagedSession(sessionId, listener),
            done: () => this.invokeManagedDone(sessionId),
            submitPrompt: (prompt) => this.invokeManagedSubmitPrompt(sessionId, prompt),
            submitCommand: (command) => this.invokeManagedSubmitCommand(sessionId, command),
            cancel: (reason) => this.invokeManagedCancel(sessionId, reason),
            terminate: (reason) => this.invokeManagedTerminate(sessionId, reason),
            applySignalDecision: (decision) => this.applyManagedSignalDecision(sessionId, decision)
        });
    }

    protected createDetachedSession(snapshot: AgentSessionSnapshot): AgentSession {
        return new DetachedAgentSession(cloneSnapshot(snapshot));
    }

    protected getManagedSnapshot(sessionId: AgentSessionId): AgentSessionSnapshot {
        return cloneSnapshot(this.requireManagedSessionRecord(sessionId).snapshot);
    }

    protected updateManagedSnapshot(sessionId: AgentSessionId, overrides: SnapshotOverrides): AgentSessionSnapshot {
        const record = this.requireManagedSessionRecord(sessionId);
        const nextSnapshot: AgentSessionSnapshot = {
            ...record.snapshot,
            acceptedCommands: overrides.acceptedCommands
                ? [...overrides.acceptedCommands]
                : [...record.snapshot.acceptedCommands],
            progress: overrides.progress
                ? {
                    ...overrides.progress,
                    ...(overrides.progress.units ? { units: { ...overrides.progress.units } } : {})
                }
                : {
                    ...record.snapshot.progress,
                    ...(record.snapshot.progress.units ? { units: { ...record.snapshot.progress.units } } : {})
                },
            reference: overrides.reference
                ? {
                    ...overrides.reference,
                    ...(overrides.reference.transport ? { transport: { ...overrides.reference.transport } } : {})
                }
                : {
                    ...record.snapshot.reference,
                    ...(record.snapshot.reference.transport ? { transport: { ...record.snapshot.reference.transport } } : {})
                },
            updatedAt: new Date().toISOString()
        };
        for (const key of Object.keys(overrides) as Array<keyof SnapshotOverrides>) {
            const value = overrides[key];
            if (key === 'failureMessage' && value === undefined) {
                continue;
            }
            if (value !== undefined) {
                Object.assign(nextSnapshot, { [key]: value });
            }
        }
        if ('failureMessage' in overrides && overrides.failureMessage === undefined) {
            delete nextSnapshot.failureMessage;
        }
        nextSnapshot.interactionCapabilities = deriveAgentSessionInteractionCapabilities(nextSnapshot);
        record.snapshot = nextSnapshot;
        return cloneSnapshot(record.snapshot);
    }

    protected emitSessionEvent(event: AgentSessionEvent): void {
        const record = this.sessions.get(event.snapshot.sessionId);
        if (!record) {
            return;
        }
        record.snapshot = cloneSnapshot(event.snapshot);
        for (const listener of record.listeners) {
            listener(event);
        }
    }

    protected createFreshSessionId(config: AgentLaunchConfig): AgentSessionId {
        return buildFreshAgentSessionId(config.task.taskId, this.id);
    }

    protected applyManagedSignalDecision(
        sessionId: AgentSessionId,
        decision: Exclude<AgentSessionSignalDecision, { action: 'reject' }>
    ): AgentSessionSnapshot | void {
        switch (decision.action) {
            case 'emit-message': {
                this.emitSessionEvent({
                    ...decision.event,
                    snapshot: this.getManagedSnapshot(sessionId)
                });
                return this.getManagedSnapshot(sessionId);
            }
            case 'record-observation-only':
                return this.getManagedSnapshot(sessionId);
            case 'update-session': {
                const snapshot = this.updateManagedSnapshot(sessionId, {
                    ...decision.snapshotPatch,
                    ...toSignalDrivenInteractionPatch(decision.eventType)
                });
                this.emitSessionEvent(createSignalDrivenSessionEvent(decision.eventType, snapshot));
                return snapshot;
            }
        }
    }

    protected disposeManagedSession(sessionId: AgentSessionId): void {
        const record = this.sessions.get(sessionId);
        if (!record) {
            return;
        }
        record.controller.dispose?.();
        record.listeners.clear();
        this.sessions.delete(sessionId);
        this.terminalSessions.delete(sessionId);
    }

    private observeManagedSession(
        sessionId: AgentSessionId,
        listener: (event: AgentSessionEvent) => void
    ): { dispose(): void } {
        const record = this.requireManagedSessionRecord(sessionId);
        record.listeners.add(listener);
        return {
            dispose: () => {
                record.listeners.delete(listener);
            }
        };
    }

    private createTerminalSessionController(sessionId: string): AgentRunnerSessionController {
        return {
            done: async () => this.completeTerminalSession(sessionId),
            submitPrompt: async (prompt) => this.submitTerminalPrompt(sessionId, prompt),
            submitCommand: async (command) => this.submitTerminalCommand(sessionId, command),
            cancel: async (reason) => this.cancelTerminalSession(sessionId, reason),
            terminate: async (reason) => this.terminateTerminalSession(sessionId, reason),
            dispose: () => {
                this.stopTerminalPolling(sessionId);
            }
        };
    }

    private registerTerminalHandle(
        sessionId: string,
        transportHandle: AgentRunnerTerminalSessionHandle,
        snapshot: AgentSessionSnapshot,
        lastCapture = ''
    ): void {
        this.stopTerminalPolling(sessionId);
        this.terminalSessions.set(sessionId, {
            transportHandle,
            lastCapture,
            pollTimer: undefined,
            polling: false,
            pollFailureCount: 0
        });
        if (!isTerminalStatus(snapshot.status)) {
            this.startTerminalPolling(sessionId);
        }
    }

    private startTerminalPolling(sessionId: string): void {
        const runtime = this.requireTerminalRuntime();
        const handle = this.requireTerminalSession(sessionId);
        if (handle.pollTimer) {
            return;
        }
        handle.pollTimer = setInterval(() => {
            void this.pollTerminalSession(sessionId, runtime);
        }, runtime.pollIntervalMs);
    }

    private stopTerminalPolling(sessionId: string): void {
        const handle = this.terminalSessions.get(sessionId);
        if (!handle?.pollTimer) {
            return;
        }
        clearInterval(handle.pollTimer);
        handle.pollTimer = undefined;
    }

    private async submitTerminalPrompt(sessionId: string, prompt: AgentPrompt): Promise<AgentSessionSnapshot> {
        const runtime = this.requireTerminalRuntime();
        const handle = this.requireActiveTerminalSession(sessionId, 'submit a prompt', { requirePromptAcceptance: true });
        await sendTerminalText(runtime, handle.transportHandle, prompt.text);
        const snapshot = this.updateManagedSnapshot(sessionId, {
            status: 'running',
            attention: 'autonomous',
            waitingForInput: false,
            acceptsPrompts: true,
            acceptedCommands: ['interrupt', 'checkpoint', 'nudge'],
            progress: {
                state: 'working',
                updatedAt: new Date().toISOString()
            }
        });
        this.emitSessionEvent({
            type: 'session.updated',
            snapshot
        });
        this.emitSessionEvent({
            type: 'session.message',
            channel: prompt.source === 'operator' || prompt.source === 'system' ? 'system' : 'agent',
            text: prompt.text,
            snapshot
        });
        return snapshot;
    }

    private async submitTerminalCommand(sessionId: string, command: AgentCommand): Promise<AgentSessionSnapshot> {
        const runtime = this.requireTerminalRuntime();
        const handle = this.requireActiveTerminalSession(sessionId, `perform '${command.type}'`);
        if (command.type === 'interrupt') {
            await runtime.sendKeys(handle.transportHandle, 'C-c');
            const snapshot = this.updateManagedSnapshot(sessionId, {
                status: 'awaiting-input',
                attention: 'awaiting-operator',
                waitingForInput: true,
                acceptsPrompts: true,
                acceptedCommands: ['resume', 'checkpoint', 'nudge', 'interrupt'],
                progress: {
                    state: 'waiting-input',
                    ...(command.reason ? { detail: command.reason } : {}),
                    updatedAt: new Date().toISOString()
                }
            });
            this.emitSessionEvent({
                type: 'session.awaiting-input',
                snapshot
            });
            return snapshot;
        }

        return this.submitTerminalPrompt(sessionId, buildCommandPrompt(command));
    }

    private async cancelTerminalSession(sessionId: string, reason?: string): Promise<AgentSessionSnapshot> {
        const runtime = this.requireTerminalRuntime();
        const handle = this.requireActiveTerminalSession(sessionId, 'cancel');
        await runtime.sendKeys(handle.transportHandle, 'C-c');
        let paneState = await waitForTerminalSessionExit(runtime, handle.transportHandle, 1_500);
        if (!paneState.dead) {
            paneState = await runtime.killSession(handle.transportHandle);
        }
        if (!paneState.dead) {
            throw new Error(`Terminal session '${sessionId}' did not exit after cancellation was requested.`);
        }
        this.stopTerminalPolling(sessionId);
        const snapshot = this.updateManagedSnapshot(sessionId, {
            status: 'cancelled',
            attention: 'none',
            waitingForInput: false,
            acceptsPrompts: false,
            acceptedCommands: [],
            progress: {
                state: 'failed',
                ...(reason ? { detail: reason } : {}),
                updatedAt: new Date().toISOString()
            },
            endedAt: new Date().toISOString(),
            ...(reason ? { failureMessage: reason } : {})
        });
        this.emitSessionEvent({
            type: 'session.cancelled',
            ...(reason ? { reason } : {}),
            snapshot
        });
        return snapshot;
    }

    private async terminateTerminalSession(sessionId: string, reason?: string): Promise<AgentSessionSnapshot> {
        const runtime = this.requireTerminalRuntime();
        const handle = this.requireTerminalSession(sessionId);
        let paneState = await runtime.killSession(handle.transportHandle);
        if (!paneState.dead) {
            paneState = await waitForTerminalSessionExit(runtime, handle.transportHandle, 5_000);
        }
        if (!paneState.dead) {
            throw new Error(`Terminal session '${sessionId}' did not exit after termination was requested.`);
        }
        this.stopTerminalPolling(sessionId);
        const snapshot = this.updateManagedSnapshot(sessionId, {
            status: 'terminated',
            attention: 'none',
            waitingForInput: false,
            acceptsPrompts: false,
            acceptedCommands: [],
            progress: {
                state: 'failed',
                ...(reason ? { detail: reason } : {}),
                updatedAt: new Date().toISOString()
            },
            endedAt: new Date().toISOString(),
            ...(reason ? { failureMessage: reason } : {})
        });
        this.emitSessionEvent({
            type: 'session.terminated',
            ...(reason ? { reason } : {}),
            snapshot
        });
        return snapshot;
    }

    private async completeTerminalSession(sessionId: string): Promise<AgentSessionSnapshot> {
        this.requireActiveTerminalSession(sessionId, 'mark the session done');
        this.stopTerminalPolling(sessionId);
        const endedAt = new Date().toISOString();
        const snapshot = this.updateManagedSnapshot(sessionId, {
            status: 'completed',
            attention: 'none',
            waitingForInput: false,
            acceptsPrompts: false,
            acceptedCommands: [],
            progress: {
                state: 'done',
                updatedAt: endedAt
            },
            endedAt,
            failureMessage: undefined
        });
        this.emitSessionEvent({
            type: 'session.completed',
            snapshot
        });
        return snapshot;
    }

    private async pollTerminalSession(sessionId: string, runtime: ConfiguredTerminalRuntime): Promise<void> {
        const handle = this.terminalSessions.get(sessionId);
        if (!handle || handle.polling) {
            return;
        }
        handle.polling = true;

        try {
            const paneState = await runtime.readPaneState(handle.transportHandle);
            if (paneState.dead) {
                this.stopTerminalPolling(sessionId);
                const finalCapture = await runtime.capturePane(handle.transportHandle).catch(() => '');
                const finalLines = diffCapturedOutput(handle.lastCapture, finalCapture);
                handle.lastCapture = finalCapture;
                for (const line of finalLines) {
                    this.emitSessionEvent({
                        type: 'session.message',
                        channel: 'stdout',
                        text: line,
                        snapshot: this.getManagedSnapshot(sessionId)
                    });
                }
                const snapshot = paneState.exitCode === 0
                    ? this.updateManagedSnapshot(sessionId, {
                        status: 'completed',
                        attention: 'none',
                        acceptsPrompts: false,
                        waitingForInput: false,
                        acceptedCommands: [],
                        endedAt: new Date().toISOString(),
                        progress: {
                            state: 'done',
                            updatedAt: new Date().toISOString()
                        },
                        failureMessage: undefined
                    })
                    : this.updateManagedSnapshot(sessionId, {
                        status: 'failed',
                        attention: 'none',
                        acceptsPrompts: false,
                        waitingForInput: false,
                        acceptedCommands: [],
                        endedAt: new Date().toISOString(),
                        progress: {
                            state: 'failed',
                            updatedAt: new Date().toISOString()
                        },
                        failureMessage: `terminal command exited with status ${String(paneState.exitCode)}.`
                    });
                this.emitSessionEvent(
                    snapshot.status === 'completed'
                        ? {
                            type: 'session.completed',
                            snapshot
                        }
                        : {
                            type: 'session.failed',
                            reason: snapshot.failureMessage ?? 'terminal command failed.',
                            snapshot
                        }
                );
                handle.pollFailureCount = 0;
                return;
            }

            const capture = await runtime.capturePane(handle.transportHandle);
            const newLines = diffCapturedOutput(handle.lastCapture, capture);
            handle.lastCapture = capture;
            for (const line of newLines) {
                this.emitSessionEvent({
                    type: 'session.message',
                    channel: 'stdout',
                    text: line,
                    snapshot: this.getManagedSnapshot(sessionId)
                });
            }

            handle.pollFailureCount = 0;
        } catch (error) {
            runtime.logLine?.(
                `${this.displayName} poll failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
            );

            handle.pollFailureCount += 1;
            if (handle.pollFailureCount >= MAX_TERMINAL_POLL_FAILURES) {
                this.stopTerminalPolling(sessionId);
                const snapshot = this.updateManagedSnapshot(sessionId, {
                    status: 'failed',
                    attention: 'none',
                    acceptsPrompts: false,
                    waitingForInput: false,
                    acceptedCommands: [],
                    endedAt: new Date().toISOString(),
                    progress: {
                        state: 'failed',
                        detail: 'terminal polling failed repeatedly; marking session as failed.',
                        updatedAt: new Date().toISOString()
                    },
                    failureMessage: error instanceof Error
                        ? `terminal polling failed repeatedly: ${error.message}`
                        : `terminal polling failed repeatedly: ${String(error)}`
                });
                this.emitSessionEvent({
                    type: 'session.failed',
                    reason: snapshot.failureMessage ?? 'terminal polling failed repeatedly.',
                    snapshot
                });
            }
        } finally {
            handle.polling = false;
        }
    }

    private requireManagedSessionRecord(sessionId: AgentSessionId): ManagedSessionRecord {
        const record = this.sessions.get(sessionId);
        if (!record) {
            throw new Error(`Agent session '${sessionId}' is not attached.`);
        }
        return record;
    }

    private requireTerminalRuntime(): ConfiguredTerminalRuntime {
        if (!this.terminalRuntime) {
            throw new Error(`AgentRunner '${this.id}' has no configured terminal runtime.`);
        }
        return this.terminalRuntime;
    }

    private requireTerminalSession(sessionId: string): ManagedTerminalSessionRecord {
        const handle = this.terminalSessions.get(sessionId);
        if (!handle) {
            throw new Error(`Agent session '${sessionId}' is not attached.`);
        }
        return handle;
    }

    private requireActiveTerminalSession(
        sessionId: string,
        action: string,
        options: { requirePromptAcceptance?: boolean } = {}
    ): ManagedTerminalSessionRecord {
        const handle = this.requireTerminalSession(sessionId);
        const snapshot = this.getManagedSnapshot(sessionId);
        if (isTerminalStatus(snapshot.status)) {
            throw new Error(`Cannot ${action} for session '${sessionId}' because it is ${snapshot.status}.`);
        }
        if (options.requirePromptAcceptance && !snapshot.acceptsPrompts) {
            throw new Error(`Cannot ${action} for session '${sessionId}' because prompts are disabled.`);
        }
        return handle;
    }

    private async invokeManagedSubmitPrompt(
        sessionId: AgentSessionId,
        prompt: AgentPrompt
    ): Promise<AgentSessionSnapshot> {
        return this.requireManagedSessionRecord(sessionId).controller.submitPrompt(prompt);
    }

    private async invokeManagedDone(sessionId: AgentSessionId): Promise<AgentSessionSnapshot> {
        return this.requireManagedSessionRecord(sessionId).controller.done();
    }

    private async invokeManagedSubmitCommand(
        sessionId: AgentSessionId,
        command: AgentCommand
    ): Promise<AgentSessionSnapshot> {
        return this.requireManagedSessionRecord(sessionId).controller.submitCommand(command);
    }

    private async invokeManagedCancel(
        sessionId: AgentSessionId,
        reason?: string
    ): Promise<AgentSessionSnapshot> {
        return this.requireManagedSessionRecord(sessionId).controller.cancel(reason);
    }

    private async invokeManagedTerminate(
        sessionId: AgentSessionId,
        reason?: string
    ): Promise<AgentSessionSnapshot> {
        return this.requireManagedSessionRecord(sessionId).controller.terminate(reason);
    }
}

type ManagedAgentSessionOptions = {
    getSnapshot(): AgentSessionSnapshot;
    observe(listener: (event: AgentSessionEvent) => void): { dispose(): void };
    done(): Promise<AgentSessionSnapshot>;
    submitPrompt(prompt: AgentPrompt): Promise<AgentSessionSnapshot>;
    submitCommand(command: AgentCommand): Promise<AgentSessionSnapshot>;
    cancel(reason?: string): Promise<AgentSessionSnapshot>;
    terminate(reason?: string): Promise<AgentSessionSnapshot>;
    applySignalDecision(
        decision: Exclude<AgentSessionSignalDecision, { action: 'reject' }>
    ): Promise<AgentSessionSnapshot | void> | AgentSessionSnapshot | void;
};

class ManagedAgentSession implements AgentSession {
    public constructor(private readonly options: ManagedAgentSessionOptions) { }

    public get reference(): AgentSessionReference {
        return this.options.getSnapshot().reference;
    }

    public getSnapshot(): AgentSessionSnapshot {
        return this.options.getSnapshot();
    }

    public onDidEvent(listener: (event: AgentSessionEvent) => void): { dispose(): void } {
        return this.options.observe(listener);
    }

    public done(): Promise<AgentSessionSnapshot> {
        return this.options.done();
    }

    public submitPrompt(prompt: AgentPrompt): Promise<AgentSessionSnapshot> {
        return this.options.submitPrompt(prompt);
    }

    public submitCommand(command: AgentCommand): Promise<AgentSessionSnapshot> {
        return this.options.submitCommand(command);
    }

    public cancel(reason?: string): Promise<AgentSessionSnapshot> {
        return this.options.cancel(reason);
    }

    public terminate(reason?: string): Promise<AgentSessionSnapshot> {
        return this.options.terminate(reason);
    }

    public applySignalDecision(
        decision: Exclude<AgentSessionSignalDecision, { action: 'reject' }>
    ): Promise<AgentSessionSnapshot | void> | AgentSessionSnapshot | void {
        return this.options.applySignalDecision(decision);
    }
}

class DetachedAgentSession implements AgentSession {
    public constructor(private readonly snapshot: AgentSessionSnapshot) { }

    public get reference(): AgentSessionReference {
        return this.snapshot.reference;
    }

    public getSnapshot(): AgentSessionSnapshot {
        return cloneSnapshot(this.snapshot);
    }

    public onDidEvent(): { dispose(): void } {
        return { dispose() { } };
    }

    public async done(): Promise<AgentSessionSnapshot> {
        return this.getSnapshot();
    }

    public async submitPrompt(): Promise<AgentSessionSnapshot> {
        throw new Error(`Agent session '${this.snapshot.sessionId}' is no longer available.`);
    }

    public async submitCommand(): Promise<AgentSessionSnapshot> {
        throw new Error(`Agent session '${this.snapshot.sessionId}' is no longer available.`);
    }

    public async cancel(): Promise<AgentSessionSnapshot> {
        return this.getSnapshot();
    }

    public async terminate(): Promise<AgentSessionSnapshot> {
        return this.getSnapshot();
    }
}

function cloneSnapshot(snapshot: AgentSessionSnapshot): AgentSessionSnapshot {
    return {
        ...snapshot,
        acceptedCommands: [...snapshot.acceptedCommands],
        ...(snapshot.interactionCapabilities
            ? { interactionCapabilities: { ...snapshot.interactionCapabilities } }
            : {}),
        progress: {
            ...snapshot.progress,
            ...(snapshot.progress.units ? { units: { ...snapshot.progress.units } } : {})
        },
        reference: {
            ...snapshot.reference,
            ...(snapshot.reference.transport ? { transport: { ...snapshot.reference.transport } } : {})
        },
        ...(snapshot.transport ? { transport: { ...snapshot.transport } } : {})
    };
}

function toSignalDrivenInteractionPatch(
    eventType: 'session.updated' | 'session.awaiting-input' | 'session.completed' | 'session.failed'
): Pick<AgentSessionSnapshot, 'acceptsPrompts' | 'acceptedCommands' | 'waitingForInput'>
    & Partial<Pick<AgentSessionSnapshot, 'failureMessage'>> {
    switch (eventType) {
        case 'session.awaiting-input':
            return {
                acceptsPrompts: true,
                acceptedCommands: ['interrupt', 'checkpoint', 'nudge', 'resume'],
                waitingForInput: true
            };
        case 'session.completed':
            return {
                acceptsPrompts: false,
                acceptedCommands: [],
                waitingForInput: false
            };
        case 'session.failed':
            return {
                acceptsPrompts: false,
                acceptedCommands: [],
                waitingForInput: false
            };
        case 'session.updated':
            return {
                acceptsPrompts: true,
                acceptedCommands: ['interrupt', 'checkpoint', 'nudge'],
                waitingForInput: false
            };
    }
}

function createSignalDrivenSessionEvent(
    eventType: 'session.updated' | 'session.awaiting-input' | 'session.completed' | 'session.failed',
    snapshot: AgentSessionSnapshot
): AgentSessionEvent {
    switch (eventType) {
        case 'session.updated':
            return { type: 'session.updated', snapshot };
        case 'session.awaiting-input':
            return { type: 'session.awaiting-input', snapshot };
        case 'session.completed':
            return { type: 'session.completed', snapshot };
        case 'session.failed':
            return {
                type: 'session.failed',
                reason: snapshot.failureMessage ?? snapshot.progress.detail ?? 'Agent session failed.',
                snapshot
            };
    }
}

function toSnapshotTransport(
    handle: AgentRunnerTerminalSessionHandle
): NonNullable<AgentSessionSnapshot['transport']> {
    return {
        kind: 'terminal',
        terminalSessionName: handle.sessionName,
        ...(handle.paneId !== handle.sessionName ? { paneId: handle.paneId } : {})
    };
}

function buildFreshAgentSessionId(taskId: string, runnerId: string): string {
    const taskSegment = taskId.split('/').at(-1)?.trim() || taskId.trim();
    const normalizedTaskSegment = slugSessionSegment(taskSegment);
    const normalizedRunnerId = slugSessionSegment(runnerId);
    const suffix = randomUUID().slice(0, 8);
    if (!normalizedTaskSegment) {
        return normalizedRunnerId ? `${normalizedRunnerId}-${suffix}` : `mission-agent-${suffix}`;
    }
    return normalizedRunnerId
        ? `${normalizedTaskSegment}-${normalizedRunnerId}-${suffix}`
        : `${normalizedTaskSegment}-${suffix}`;
}

function buildTaskTerminalSessionName(
    workingDirectory: string,
    missionId: string,
    taskId: string,
    agentSessionId: string
): string {
    const repositoryId = Repository.deriveIdentity(workingDirectory).id;
    return [
        repositoryId,
        Repository.slugIdentitySegment(missionId) || 'mission',
        slugSessionSegment(taskId) || 'task',
        slugSessionSegment(agentSessionId) || 'session'
    ].join(':');
}

function slugSessionSegment(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

async function sendTerminalText(
    runtime: ConfiguredTerminalRuntime,
    handle: AgentRunnerTerminalSessionHandle,
    text: string
): Promise<void> {
    const normalized = text.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if (line.length > 0) {
            await runtime.sendKeys(handle, line, { literal: true });
        }
        if (index < lines.length - 1 || normalized.length === 0 || line.length > 0) {
            await runtime.sendKeys(handle, 'Enter');
        }
    }
}

async function waitForTerminalSessionExit(
    runtime: ConfiguredTerminalRuntime,
    handle: AgentRunnerTerminalSessionHandle,
    timeoutMs = 5_000
): Promise<AgentRunnerTerminalSessionState> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    let lastState: AgentRunnerTerminalSessionState;
    do {
        lastState = await runtime.readPaneState(handle);
        if (lastState.dead) {
            return lastState;
        }
        await delay(50);
    } while (Date.now() <= deadline);
    return lastState;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalStatus(status: AgentSessionSnapshot['status']): boolean {
    return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'terminated';
}

function diffCapturedOutput(previous: string, next: string): string[] {
    if (!next || next === previous) {
        return [];
    }
    if (!previous) {
        return splitLines(next);
    }
    if (next.startsWith(previous)) {
        return splitLines(next.slice(previous.length));
    }

    const previousLines = splitLines(previous);
    const nextLines = splitLines(next);
    const maxOverlap = Math.min(previousLines.length, nextLines.length);
    for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
        const previousTail = previousLines.slice(-overlap).join('\n');
        const nextHead = nextLines.slice(0, overlap).join('\n');
        if (previousTail === nextHead) {
            return nextLines.slice(overlap);
        }
    }
    return nextLines;
}

function splitLines(text: string): string[] {
    return text
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0);
}

function createRunningSnapshot(input: {
    runnerId: string;
    sessionId: string;
    workingDirectory: string;
    taskId: string;
    missionId: string;
    stageId: string;
    transport: NonNullable<AgentSessionSnapshot['transport']>;
}): AgentSessionSnapshot {
    return createTerminalSnapshot({
        ...input,
        status: 'running',
        progressState: 'working',
        acceptsPrompts: true,
        acceptedCommands: ['interrupt', 'checkpoint', 'nudge']
    });
}

function createTerminalSnapshot(input: {
    runnerId: string;
    sessionId: string;
    workingDirectory: string;
    taskId: string;
    missionId: string;
    stageId: string;
    transport: NonNullable<AgentSessionSnapshot['transport']>;
    status: AgentSessionSnapshot['status'];
    progressState: AgentSessionSnapshot['progress']['state'];
    acceptsPrompts: boolean;
    acceptedCommands: AgentCommand['type'][];
    failureMessage?: string;
    endedAt?: string;
}): AgentSessionSnapshot {
    const timestamp = new Date().toISOString();
    const reference: AgentSessionReference = {
        runnerId: input.runnerId,
        sessionId: input.sessionId,
        transport: {
            kind: 'terminal',
            terminalSessionName: input.transport.terminalSessionName,
            ...(input.transport.paneId ? { paneId: input.transport.paneId } : {})
        }
    };
    return {
        runnerId: input.runnerId,
        sessionId: input.sessionId,
        workingDirectory: input.workingDirectory,
        taskId: input.taskId,
        missionId: input.missionId,
        stageId: input.stageId,
        status: input.status,
        attention: input.status === 'running' ? 'autonomous' : 'none',
        progress: {
            state: input.progressState,
            updatedAt: timestamp
        },
        waitingForInput: false,
        acceptsPrompts: input.acceptsPrompts,
        acceptedCommands: [...input.acceptedCommands],
        interactionCapabilities: deriveAgentSessionInteractionCapabilities({
            status: input.status,
            transport: input.transport,
            acceptsPrompts: input.acceptsPrompts,
            acceptedCommands: input.acceptedCommands
        }),
        transport: input.transport,
        reference,
        startedAt: timestamp,
        updatedAt: timestamp,
        ...(input.failureMessage ? { failureMessage: input.failureMessage } : {}),
        ...(input.endedAt ? { endedAt: input.endedAt } : {})
    };
}

function createDetachedTerminalSnapshot(
    runnerId: string,
    reference: AgentSessionReference,
    reason: string
): AgentSessionSnapshot {
    const timestamp = new Date().toISOString();
    return {
        runnerId,
        sessionId: reference.sessionId,
        workingDirectory: 'unknown',
        taskId: 'unknown',
        missionId: 'unknown',
        stageId: 'unknown',
        status: 'terminated',
        attention: 'none',
        progress: {
            state: 'failed',
            detail: reason,
            updatedAt: timestamp
        },
        waitingForInput: false,
        acceptsPrompts: false,
        acceptedCommands: [],
        interactionCapabilities: deriveAgentSessionInteractionCapabilities({
            status: 'terminated',
            ...(reference.transport ? { transport: { ...reference.transport } } : {}),
            acceptsPrompts: false,
            acceptedCommands: []
        }),
        reference: {
            runnerId,
            sessionId: reference.sessionId,
            ...(reference.transport ? { transport: { ...reference.transport } } : {})
        },
        ...(reference.transport ? { transport: { ...reference.transport } } : {}),
        failureMessage: reason,
        startedAt: timestamp,
        updatedAt: timestamp,
        endedAt: timestamp
    };
}

function getRequestedTerminalSessionName(request: AgentLaunchConfig): string | undefined {
    const value = request.metadata?.['terminalSessionName'];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function buildCommandPrompt(command: Exclude<AgentCommand, { type: 'interrupt' }>): AgentPrompt {
    switch (command.type) {
        case 'resume':
            return { source: 'system', text: command.reason?.trim() || 'Resume execution.' };
        case 'checkpoint':
            return {
                source: 'system',
                text: command.reason?.trim() || 'Provide a concise checkpoint, then continue with the task.'
            };
        case 'nudge':
            return { source: 'system', text: command.reason?.trim() || 'Continue with the assigned task.' };
    }
}
