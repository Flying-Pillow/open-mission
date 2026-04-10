import { randomUUID } from 'node:crypto';
import {
    CopilotClient,
    type CopilotSession as SdkCopilotSession,
    type MCPServerConfig,
    type PermissionRequestResult,
    type ResumeSessionConfig,
    type SessionConfig,
    type SessionEvent
} from '@github/copilot-sdk';
import type {
    AgentCommand,
    AgentRunnerCapabilities,
    AgentSessionEvent,
    AgentSessionReference,
    AgentSessionSnapshot,
    AgentSessionStartRequest,
    McpServerReference
} from '../runtime/AgentRuntimeTypes.js';
import type { AgentRunner } from '../runtime/AgentRunner.js';
import type { AgentSession } from '../runtime/AgentSession.js';
import { AgentSessionEventEmitter } from '../runtime/AgentSessionEventEmitter.js';
import { COPILOT_SDK_AGENT_RUNNER_ID } from '../lib/agentRuntimes.js';

export type CopilotSdkAgentRunnerOptions = {
    command?: string;
    additionalArgs?: string[];
    logLine?: (line: string) => void;
    env?: NodeJS.ProcessEnv;
    defaultModel?: string;
    skillDirectories?: string[];
};

type WorkflowSessionHandle = {
    snapshot: AgentSessionSnapshot;
    sdkSession?: SdkCopilotSession;
    pendingPrompt?: string;
    eventEmitter: AgentSessionEventEmitter<AgentSessionEvent>;
};

export class CopilotSdkAgentRunner implements AgentRunner {
    public readonly id = COPILOT_SDK_AGENT_RUNNER_ID;
    public readonly transportId = 'direct';
    public readonly displayName = 'Copilot SDK';
    public readonly capabilities: AgentRunnerCapabilities = {
        attachableSessions: true,
        promptSubmission: true,
        structuredCommands: true,
        interactiveInput: false,
        interruptible: true,
        telemetry: true,
        mcpClient: true
    };

    private readonly command: string | undefined;
    private readonly additionalArgs: string[];
    private readonly logLine: ((line: string) => void) | undefined;
    private readonly env: NodeJS.ProcessEnv | undefined;
    private readonly defaultModel: string | undefined;
    private readonly skillDirectories: string[];
    private clientPromise: Promise<CopilotClient> | undefined;
    private readonly sessions = new Map<string, WorkflowSessionHandle>();

    public constructor(options: CopilotSdkAgentRunnerOptions = {}) {
        this.command = options.command?.trim() || undefined;
        this.additionalArgs = options.additionalArgs ? [...options.additionalArgs] : [];
        this.logLine = options.logLine;
        this.env = options.env;
        this.defaultModel = options.defaultModel?.trim() || undefined;
        this.skillDirectories = (options.skillDirectories ?? [])
            .map((value) => value.trim())
            .filter(Boolean);
    }

    public async isAvailable(): Promise<{ available: boolean; detail?: string }> {
        try {
            const client = await this.getClient();
            const status = await client.getStatus();
            return {
                available: true,
                detail: `Copilot SDK connected to CLI protocol ${String(status.protocolVersion)}.`
            };
        } catch (error) {
            this.clientPromise = undefined;
            return {
                available: false,
                detail: error instanceof Error ? error.message : String(error)
            };
        }
    }

    public async startSession(
        request: AgentSessionStartRequest
    ): Promise<AgentSession> {
        const availability = await this.isAvailable();
        if (!availability.available) {
            throw new Error(availability.detail ?? `${this.displayName} is unavailable.`);
        }

        const launchedAt = new Date().toISOString();
        const sessionId = `${this.id}-${randomUUID()}`;
        const snapshot: AgentSessionSnapshot = {
            runnerId: this.id,
            transportId: this.transportId,
            sessionId,
            taskId: request.taskId,
            missionId: request.missionId,
            phase: 'starting',
            updatedAt: launchedAt,
            workingDirectory: request.workingDirectory,
            acceptsPrompts: true,
            acceptedCommands: ['interrupt'],
            awaitingInput: false
        };

        const handle: WorkflowSessionHandle = {
            snapshot,
            pendingPrompt: renderStartPrompt({
                workingDirectory: request.workingDirectory,
                prompt: request.initialPrompt?.text ?? '',
                ...(request.initialPrompt?.title ? { title: request.initialPrompt.title } : {}),
                operatorIntent: 'Execute the assigned Mission task and stop when complete.'
            }),
            eventEmitter: new AgentSessionEventEmitter<AgentSessionEvent>()
        };
        this.sessions.set(sessionId, handle);

        try {
            const client = await this.getClient();
            const sdkSession = await client.createSession(this.buildSessionConfig(request, sessionId));
            handle.sdkSession = sdkSession;
            await sdkSession.rpc.mode.set({ mode: 'autopilot' });
            this.updateSnapshot(sessionId, {
                phase: 'running'
            });
            if (handle.pendingPrompt?.trim()) {
                await sdkSession.send({
                    prompt: handle.pendingPrompt,
                    mode: 'immediate'
                });
            }
            return this.createAgentSession(sessionId);
        } catch (error) {
            this.markFailed(sessionId, error instanceof Error ? error.message : String(error));
            throw error instanceof Error ? error : new Error(String(error));
        }
    }

    public async listSessions(): Promise<AgentSessionSnapshot[]> {
        return [...this.sessions.values()].map((handle) => cloneAgentSessionSnapshot(handle.snapshot));
    }

    public async attachSession(reference: AgentSessionReference): Promise<AgentSession> {
        const existing = this.sessions.get(reference.sessionId);
        if (existing) {
            return this.createAgentSession(reference.sessionId);
        }

        const availability = await this.isAvailable();
        if (!availability.available) {
            throw new Error(availability.detail ?? `${this.displayName} is unavailable.`);
        }


        try {
            const client = await this.getClient();
            const resumeConfig: ResumeSessionConfig = {
                onPermissionRequest: async () => this.rejectInteractiveOperation(reference.sessionId),
                onUserInputRequest: async () => {
                    throw new Error(
                        `Agent session '${reference.sessionId}' requested operator input, which is unsupported in autonomous runner mode.`
                    );
                },
                onEvent: (event) => {
                    this.handleSdkEvent(reference.sessionId, event);
                }
            };
            const sdkSession = await client.resumeSession(reference.sessionId, resumeConfig);
            const snapshot: AgentSessionSnapshot = {
                runnerId: this.id,
                transportId: this.transportId,
                sessionId: reference.sessionId,
                taskId: 'unknown',
                missionId: 'unknown',
                phase: 'running',
                updatedAt: new Date().toISOString(),
                acceptsPrompts: true,
                acceptedCommands: ['interrupt'],
                awaitingInput: false
            };
            this.sessions.set(reference.sessionId, {
                snapshot,
                sdkSession,
                eventEmitter: new AgentSessionEventEmitter<AgentSessionEvent>()
            });

            return this.createAgentSession(reference.sessionId);
        } catch {
            return this.createTerminatedAttachedSession(reference);
        }
    }

    private createTerminatedAttachedSession(reference: AgentSessionReference): AgentSession {
        const snapshot: AgentSessionSnapshot = {
            runnerId: this.id,
            transportId: this.transportId,
            sessionId: reference.sessionId,
            taskId: 'unknown',
            missionId: 'unknown',
            phase: 'terminated',
            updatedAt: new Date().toISOString(),
            acceptsPrompts: false,
            acceptedCommands: [],
            awaitingInput: false,
            failureMessage: 'Session no longer exists in provider runtime.'
        };
        const eventEmitter = new AgentSessionEventEmitter<AgentSessionEvent>();
        this.sessions.set(reference.sessionId, {
            snapshot,
            eventEmitter
        });
        return {
            runnerId: this.id,
            transportId: this.transportId,
            sessionId: reference.sessionId,
            getSnapshot: () => cloneAgentSessionSnapshot(snapshot),
            onDidEvent: (listener) => {
                const subscription = eventEmitter.event(listener);
                queueMicrotask(() => {
                    listener({
                        type: 'session.terminated',
                        reason: 'Session no longer exists in provider runtime.',
                        snapshot: cloneAgentSessionSnapshot(snapshot)
                    });
                });
                return subscription;
            },
            submitPrompt: async () => cloneAgentSessionSnapshot(snapshot),
            submitCommand: async () => cloneAgentSessionSnapshot(snapshot),
            cancel: async () => cloneAgentSessionSnapshot(snapshot),
            terminate: async () => cloneAgentSessionSnapshot(snapshot),
            dispose: () => {
                eventEmitter.dispose();
            }
        };
    }

    private async cancelSession(
        sessionId: string,
        reason = 'cancelled by Mission orchestrator'
    ): Promise<AgentSessionSnapshot> {
        const handle = this.requireSessionHandle(sessionId);
        if (handle.sdkSession) {
            try {
                await handle.sdkSession.abort();
            } catch {
                // Best-effort cancellation; normalize the local snapshot regardless.
            }
            await this.disconnectSession(handle);
        }
        this.updateSnapshot(sessionId, {
            phase: 'cancelled',
            acceptsPrompts: false,
            awaitingInput: false,
            reason
        });
        return this.requireSessionSnapshot(sessionId);
    }

    private async terminateSession(
        sessionId: string,
        reason = 'terminated by Mission orchestrator'
    ): Promise<AgentSessionSnapshot> {
        const handle = this.requireSessionHandle(sessionId);
        if (handle.sdkSession) {
            try {
                await handle.sdkSession.abort();
            } catch {
                // Best-effort termination; normalize the local snapshot regardless.
            }
            await this.disconnectSession(handle);
        }
        this.updateSnapshot(sessionId, {
            phase: 'terminated',
            acceptsPrompts: false,
            awaitingInput: false,
            reason
        });
        return this.requireSessionSnapshot(sessionId);
    }

    private buildSessionConfig(
        request: AgentSessionStartRequest,
        sessionId: string
    ): SessionConfig {
        const mcpServers = request.mcpServers ? this.mapMcpServers(request.mcpServers) : undefined;

        return {
            sessionId,
            clientName: 'mission',
            ...(this.defaultModel
                ? { model: this.defaultModel }
                : {}),
            workingDirectory: request.workingDirectory,
            streaming: true,
            infiniteSessions: { enabled: true },
            onPermissionRequest: async () => this.rejectInteractiveOperation(sessionId),
            onUserInputRequest: async () => {
                throw new Error(
                    `Agent session '${sessionId}' requested operator input, which is unsupported in autonomous runner mode.`
                );
            },
            onEvent: (event) => {
                this.handleSdkEvent(sessionId, event);
            },
            ...(this.skillDirectories.length > 0 ? { skillDirectories: [...this.skillDirectories] } : {}),
            ...(mcpServers ? { mcpServers } : {})
        };
    }

    private mapMcpServers(servers: McpServerReference[]): Record<string, MCPServerConfig> {
        return Object.fromEntries(servers.map((server) => {
            if (server.transport === 'stdio') {
                if (!server.command) {
                    throw new Error(`MCP stdio server '${server.name}' is missing command.`);
                }
                return [server.name, {
                    type: 'local',
                    command: server.command,
                    args: server.args ? [...server.args] : [],
                    ...(server.env ? { env: { ...server.env } } : {}),
                    tools: ['*']
                }];
            }

            if (!server.url) {
                throw new Error(`MCP sse server '${server.name}' is missing url.`);
            }

            return [server.name, {
                type: 'http',
                url: server.url,
                tools: ['*']
            }];
        }));
    }

    private handleSdkEvent(sessionId: string, event: SessionEvent): void {
        switch (event.type) {
            case 'session.start':
            case 'session.resume':
            case 'session.context_changed':
                this.updateSnapshot(sessionId, { phase: 'running' });
                return;
            case 'session.idle':
                if (event.data.aborted === true) {
                    this.updateSnapshot(sessionId, {
                        phase: 'awaiting-input',
                        acceptsPrompts: true,
                        awaitingInput: true,
                        clearFailureMessage: true
                    });
                } else {
                    this.updateSnapshot(sessionId, {
                        phase: 'completed',
                        acceptsPrompts: false,
                        awaitingInput: false
                    });
                }
                void this.disconnectSession(this.requireSessionHandle(sessionId));
                return;
            case 'session.error':
                this.markFailed(sessionId, event.data.message);
                return;
            case 'session.shutdown':
                if (event.data.shutdownType === 'routine') {
                    if (!isTerminalPhase(this.requireSessionHandle(sessionId).snapshot.phase)) {
                        this.updateSnapshot(sessionId, {
                            phase: 'completed',
                            acceptsPrompts: false,
                            awaitingInput: false
                        });
                    }
                } else {
                    this.markFailed(
                        sessionId,
                        event.data.errorReason ?? 'Copilot SDK session shut down unexpectedly.'
                    );
                }
                void this.disconnectSession(this.requireSessionHandle(sessionId));
                return;
            default:
                return;
        }
    }

    private async rejectInteractiveOperation(sessionId: string): Promise<PermissionRequestResult> {
        this.markFailed(
            sessionId,
            'Workflow runner denied an interactive permission request from the Copilot session.'
        );
        return {
            kind: 'denied-interactively-by-user',
            feedback: 'Workflow runner mode does not support interactive permission approval.'
        };
    }

    private markFailed(sessionId: string, reason: string): void {
        this.updateSnapshot(sessionId, {
            phase: 'failed',
            acceptsPrompts: false,
            awaitingInput: false,
            failureMessage: reason
        });
    }

    private updateSnapshot(
        sessionId: string,
        patch: Partial<AgentSessionSnapshot> & { reason?: string; clearFailureMessage?: boolean }
    ): void {
        const handle = this.requireSessionHandle(sessionId);
        const {
            reason,
            clearFailureMessage,
            ...snapshotPatch
        } = patch;
        const merged: AgentSessionSnapshot = {
            ...handle.snapshot,
            ...snapshotPatch,
            updatedAt: snapshotPatch.updatedAt ?? new Date().toISOString()
        };
        if (reason) {
            merged.failureMessage = reason;
        }
        if (clearFailureMessage) {
            delete merged.failureMessage;
        }
        const next: AgentSessionSnapshot = cloneAgentSessionSnapshot({
            ...merged
        });
        handle.snapshot = next;
        handle.eventEmitter.fire({
            type: 'session.state-changed',
            snapshot: cloneAgentSessionSnapshot(next)
        });
    }

    private requireSessionHandle(sessionId: string): WorkflowSessionHandle {
        const handle = this.sessions.get(sessionId);
        if (!handle) {
            throw new Error(`Agent session '${sessionId}' does not exist.`);
        }
        return handle;
    }

    private requireSessionSnapshot(sessionId: string): AgentSessionSnapshot {
        return cloneAgentSessionSnapshot(this.requireSessionHandle(sessionId).snapshot);
    }

    private async disconnectSession(handle: WorkflowSessionHandle): Promise<void> {
        const sdkSession = handle.sdkSession;
        delete handle.sdkSession;
        if (!sdkSession) {
            return;
        }
        try {
            await sdkSession.disconnect();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logLine?.(`Copilot workflow runner disconnect warning: ${message}`);
        }
    }

    private getClient(): Promise<CopilotClient> {
        if (this.clientPromise) {
            return this.clientPromise;
        }

        this.clientPromise = (async () => {
            const client = new CopilotClient({
                autoStart: false,
                useStdio: true,
                ...(this.command ? { cliPath: this.command } : {}),
                ...(this.additionalArgs.length > 0 ? { cliArgs: [...this.additionalArgs] } : {}),
                ...(this.env ? { env: { ...process.env, ...this.env } } : {})
            });
            try {
                await client.start();
                const status = await client.getStatus();
                this.logLine?.(
                    `Copilot workflow runner ready (CLI ${status.version}, protocol ${String(status.protocolVersion)}).`
                );
                return client;
            } catch (error) {
                this.clientPromise = undefined;
                void client.forceStop().catch(() => undefined);
                throw error;
            }
        })();

        return this.clientPromise;
    }

    private createAgentSession(sessionId: string): AgentSession {
        const handle = this.requireSessionHandle(sessionId);
        return {
            runnerId: this.id,
            transportId: this.transportId,
            sessionId,
            getSnapshot: () => cloneAgentSessionSnapshot(handle.snapshot),
            onDidEvent: (listener) => handle.eventEmitter.event(listener),
            submitPrompt: async (prompt) => {
                this.assertSessionOpen(handle.snapshot, 'submit a prompt to');
                if (!handle.sdkSession) {
                    throw new Error(`Agent session '${sessionId}' is not active.`);
                }
                await handle.sdkSession.send({
                    prompt: prompt.text,
                    mode: 'immediate'
                });
                const snapshot = this.requireSessionSnapshot(sessionId);
                handle.eventEmitter.fire({
                    type: 'prompt.accepted',
                    prompt,
                    snapshot: cloneAgentSessionSnapshot(snapshot)
                });
                return snapshot;
            },
            submitCommand: async (command) => {
                this.assertSessionOpen(handle.snapshot, 'submit a command to');
                return this.submitCommand(sessionId, command);
            },
            cancel: async (reason) => {
                return this.cancelSession(sessionId, reason);
            },
            terminate: async (reason) => {
                return this.terminateSession(sessionId, reason);
            },
            dispose: () => {
                void this.disconnectSession(handle);
                handle.eventEmitter.dispose();
            }
        };
    }

    private async submitCommand(sessionId: string, command: AgentCommand): Promise<AgentSessionSnapshot> {
        const handle = this.requireSessionHandle(sessionId);
        this.assertSessionOpen(handle.snapshot, 'submit a command to');

        if (!handle.snapshot.acceptedCommands.includes(command.kind)) {
            const snapshot = this.requireSessionSnapshot(sessionId);
            const reason = `Command '${command.kind}' is unsupported by this runner.`;
            handle.eventEmitter.fire({
                type: 'command.rejected',
                command,
                reason,
                snapshot: cloneAgentSessionSnapshot(snapshot)
            });
            throw new Error(reason);
        }

        if (!handle.sdkSession) {
            throw new Error(`Agent session '${sessionId}' is not active.`);
        }

        await handle.sdkSession.abort();
        this.updateSnapshot(sessionId, {
            phase: 'awaiting-input',
            acceptsPrompts: true,
            awaitingInput: true,
            clearFailureMessage: true
        });
        const snapshot = this.requireSessionSnapshot(sessionId);
        handle.eventEmitter.fire({
            type: 'command.accepted',
            command,
            snapshot: cloneAgentSessionSnapshot(snapshot)
        });
        return snapshot;
    }

    private assertSessionOpen(snapshot: AgentSessionSnapshot, action: string): void {
        if (isTerminalPhase(snapshot.phase)) {
            throw new Error(`Cannot ${action} session '${snapshot.sessionId}' because it is ${snapshot.phase}.`);
        }
    }
}

function cloneAgentSessionSnapshot(
    snapshot: AgentSessionSnapshot
): AgentSessionSnapshot {
    return {
        runnerId: snapshot.runnerId,
        ...(snapshot.transportId ? { transportId: snapshot.transportId } : {}),
        sessionId: snapshot.sessionId,
        missionId: snapshot.missionId,
        taskId: snapshot.taskId,
        phase: snapshot.phase,
        updatedAt: snapshot.updatedAt,
        acceptsPrompts: snapshot.acceptsPrompts,
        acceptedCommands: [...snapshot.acceptedCommands],
        awaitingInput: snapshot.awaitingInput,
        ...(snapshot.workingDirectory ? { workingDirectory: snapshot.workingDirectory } : {}),
        ...(snapshot.failureMessage ? { failureMessage: snapshot.failureMessage } : {})
    };
}

function isTerminalPhase(
    phase: AgentSessionSnapshot['phase']
): boolean {
    return (
        phase === 'completed' ||
        phase === 'failed' ||
        phase === 'cancelled' ||
        phase === 'terminated'
    );
}

function renderStartPrompt(input: {
    workingDirectory: string;
    prompt: string;
    title?: string;
    operatorIntent?: string;
}): string {
    const lines = [
        `Working directory: ${input.workingDirectory}`,
        input.title ? `Task: ${input.title}` : undefined,
        input.operatorIntent ? `Operator intent: ${input.operatorIntent}` : undefined,
        '',
        input.prompt
    ].filter((line): line is string => Boolean(line));
    return lines.join('\n');
}