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
import {
    TerminalAgentTransport,
    type TerminalAgentTransportOptions
} from './TerminalAgentTransport.js';

export type AgentRunnerDefinition = {
    id: AgentRunnerId;
    displayName: string;
};

export type AgentRunnerSessionController = {
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
    killSession(handle: AgentRunnerTerminalSessionHandle): Promise<void>;
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
    executor?: TerminalAgentTransportOptions['executor'];
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
};

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
            ...(options.executor ? { executor: options.executor } : {}),
            ...(options.logLine ? { logLine: options.logLine } : {})
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
                ...(request.sharedSessionName ? { sharedSessionName: request.sharedSessionName } : {})
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

    protected async startTerminalCommandSession(config: AgentLaunchConfig): Promise<AgentSession> {
        const runtime = this.requireTerminalRuntime();
        const requestedSharedSessionName = getRequestedTerminalSessionName(config);
        const transportHandle = await runtime.openSession({
            workingDirectory: config.workingDirectory,
            command: runtime.command,
            args: runtime.args,
            ...(runtime.env ? { env: runtime.env } : {}),
            sessionPrefix: runtime.sessionPrefix,
            sessionName: buildTaskSessionName(config.task.taskId, this.id),
            ...(requestedSharedSessionName ? { sharedSessionName: requestedSharedSessionName } : {})
        });

        const snapshot = createRunningSnapshot({
            runnerId: this.id,
            sessionId: transportHandle.sessionName,
            workingDirectory: config.workingDirectory,
            taskId: config.task.taskId,
            missionId: config.missionId,
            stageId: config.task.stageId,
            transport: toSnapshotTransport(transportHandle)
        });
        this.registerTerminalHandle(transportHandle.sessionName, transportHandle, snapshot);
        const session = this.createManagedSession({
            snapshot,
            controller: this.createTerminalSessionController(transportHandle.sessionName)
        });

        if (config.initialPrompt?.text) {
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
            ? await runtime.attachSession(reference.sessionId, {
                sharedSessionName: reference.transport.terminalSessionName,
                paneId: reference.transport.paneId
            })
            : await runtime.attachSession(reference.sessionId, {
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
            submitPrompt: (prompt) => this.invokeManagedSubmitPrompt(sessionId, prompt),
            submitCommand: (command) => this.invokeManagedSubmitCommand(sessionId, command),
            cancel: (reason) => this.invokeManagedCancel(sessionId, reason),
            terminate: (reason) => this.invokeManagedTerminate(sessionId, reason)
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
            polling: false
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
        await this.prepareTerminalPaneForPrompt(sessionId, handle, runtime);
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
        await runtime.killSession(handle.transportHandle);
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

    private async pollTerminalSession(sessionId: string, runtime: ConfiguredTerminalRuntime): Promise<void> {
        const handle = this.terminalSessions.get(sessionId);
        if (!handle || handle.polling) {
            return;
        }
        handle.polling = true;

        try {
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

            const paneState = await runtime.readPaneState(handle.transportHandle);
            if (paneState.dead) {
                this.stopTerminalPolling(sessionId);
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
            }
        } catch (error) {
            runtime.logLine?.(
                `${this.displayName} poll failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
            );
        } finally {
            handle.polling = false;
        }
    }

    private async prepareTerminalPaneForPrompt(
        sessionId: string,
        handle: ManagedTerminalSessionRecord,
        runtime: ConfiguredTerminalRuntime
    ): Promise<void> {
        const paneState = await runtime.readPaneState(handle.transportHandle);
        if (paneState.dead) {
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
            throw new Error(
                snapshot.status === 'completed'
                    ? `Cannot submit a prompt for session '${handle.transportHandle.sessionName}' because the terminal pane has exited.`
                    : snapshot.failureMessage ?? `Cannot submit a prompt for session '${handle.transportHandle.sessionName}'.`
            );
        }

        for (let attempt = 0; attempt < 3; attempt += 1) {
            const capture = await runtime.capturePane(handle.transportHandle);
            if (!isFolderTrustPrompt(capture)) {
                return;
            }
            await runtime.sendKeys(handle.transportHandle, 'Enter');
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
    submitPrompt(prompt: AgentPrompt): Promise<AgentSessionSnapshot>;
    submitCommand(command: AgentCommand): Promise<AgentSessionSnapshot>;
    cancel(reason?: string): Promise<AgentSessionSnapshot>;
    terminate(reason?: string): Promise<AgentSessionSnapshot>;
};

class ManagedAgentSession implements AgentSession {
    public constructor(private readonly options: ManagedAgentSessionOptions) {}

    public get reference(): AgentSessionReference {
        return this.options.getSnapshot().reference;
    }

    public getSnapshot(): AgentSessionSnapshot {
        return this.options.getSnapshot();
    }

    public onDidEvent(listener: (event: AgentSessionEvent) => void): { dispose(): void } {
        return this.options.observe(listener);
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
}

class DetachedAgentSession implements AgentSession {
    public constructor(private readonly snapshot: AgentSessionSnapshot) {}

    public get reference(): AgentSessionReference {
        return this.snapshot.reference;
    }

    public getSnapshot(): AgentSessionSnapshot {
        return cloneSnapshot(this.snapshot);
    }

    public onDidEvent(): { dispose(): void } {
        return { dispose() {} };
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

function toSnapshotTransport(
    handle: AgentRunnerTerminalSessionHandle
): NonNullable<AgentSessionSnapshot['transport']> {
    return {
        kind: 'terminal',
        terminalSessionName: handle.sharedSessionName ?? handle.sessionName,
        ...(handle.paneId !== handle.sessionName ? { paneId: handle.paneId } : {})
    };
}

function buildTaskSessionName(taskId: string, runnerId: string): string {
    const taskSegment = taskId.split('/').at(-1)?.trim() || taskId.trim();
    const normalizedTaskSegment = slugSessionSegment(taskSegment);
    const normalizedRunnerId = slugSessionSegment(runnerId);
    if (!normalizedTaskSegment) {
        return normalizedRunnerId || 'mission-agent';
    }
    return normalizedRunnerId ? `${normalizedTaskSegment}-${normalizedRunnerId}` : normalizedTaskSegment;
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

function isFolderTrustPrompt(capture: string): boolean {
    return capture.includes('Confirm folder trust')
        && capture.includes('Do you trust the files in this folder?');
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
