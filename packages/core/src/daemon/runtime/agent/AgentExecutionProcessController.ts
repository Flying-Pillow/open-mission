import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { AgentExecution } from '../../../entities/AgentExecution/AgentExecution.js';
import type {
    AgentCommand,
    AgentExecutionType,
    AgentPrompt,
    AgentTaskContext
} from '../../../entities/AgentExecution/protocol/AgentExecutionProtocolTypes.js';
import {
    deriveAgentExecutionInteractionCapabilities,
    getAgentExecutionScopeMissionId,
    getAgentExecutionScopeStageId,
    getAgentExecutionScopeTaskId
} from '../../../entities/AgentExecution/protocol/AgentExecutionProtocolTypes.js';
import type { AgentExecutionRuntimeController, AgentExecutionTerminalStartOptions } from './AgentExecutionRuntimeController.js';
import { createAgentExecutionLiveOptions } from './AgentExecutionRuntimeController.js';

export class AgentExecutionProcessController implements AgentExecutionRuntimeController {
    public readonly execution: AgentExecution;
    private child: ChildProcessWithoutNullStreams | undefined;
    private readonly lineBuffers: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
    private disposed = false;

    private constructor(input: {
        execution: AgentExecution;
        command: string;
        args?: string[];
        workingDirectory: string;
        env?: NodeJS.ProcessEnv;
        stdin?: string;
    }) {
        this.execution = input.execution;
        queueMicrotask(() => this.startProcess(input));
    }

    public static start(options: AgentExecutionTerminalStartOptions): AgentExecutionProcessController {
        const agentId = options.agentId.trim();
        const displayName = options.displayName.trim();
        const agentExecutionId = options.launch.agentExecutionId?.trim() || AgentExecution.createFreshExecutionId(options.config, agentId);
        const execution = AgentExecution.createLive(createProcessRunningSnapshot({
            agentId,
            agentExecutionId,
            scope: options.config.scope,
            workingDirectory: options.config.workingDirectory,
            ...(options.config.task ? { task: options.config.task } : {})
        }), {
            adapterLabel: displayName,
            ...createAgentExecutionLiveOptions(options.launch)
        });
        return new AgentExecutionProcessController({
            execution,
            command: options.launch.command,
            args: options.launch.args ?? [],
            workingDirectory: options.config.workingDirectory,
            ...(options.launch.env ? { env: options.launch.env } : {}),
            ...(options.launch.stdin ?? options.config.initialPrompt?.text
                ? { stdin: options.launch.stdin ?? options.config.initialPrompt?.text ?? '' }
                : {})
        });
    }

    public submitPrompt(_prompt: AgentPrompt): Promise<AgentExecutionType> {
        throw new Error(`AgentExecution '${this.execution.agentExecutionId}' is running in direct stdout mode and does not accept follow-up prompts.`);
    }

    public submitCommand(command: AgentCommand): Promise<AgentExecutionType> {
        if (command.type === 'interrupt') {
            return this.cancel(command.reason);
        }
        throw new Error(`AgentExecution '${this.execution.agentExecutionId}' is running in direct stdout mode and only supports interruption.`);
    }

    public complete(): Promise<AgentExecutionType> {
        return this.execution.complete();
    }

    public async cancel(reason?: string): Promise<AgentExecutionType> {
        this.disposed = true;
        this.child?.kill('SIGINT');
        return this.execution.cancelRuntime(reason);
    }

    public async terminate(reason?: string): Promise<AgentExecutionType> {
        this.disposed = true;
        this.child?.kill('SIGTERM');
        return this.execution.terminateRuntime(reason);
    }

    public dispose(): void {
        this.disposed = true;
    }

    private startProcess(input: {
        command: string;
        args?: string[];
        workingDirectory: string;
        env?: NodeJS.ProcessEnv;
        stdin?: string;
    }): void {
        if (this.disposed) {
            return;
        }
        const child = spawn(input.command, input.args ?? [], {
            cwd: input.workingDirectory,
            env: input.env,
            stdio: 'pipe'
        });
        this.child = child;
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string | Buffer) => this.consumeChunk('stdout', chunk));
        child.stderr.on('data', (chunk: string | Buffer) => this.consumeChunk('stderr', chunk));
        child.once('error', (error) => {
            void this.execution.terminateRuntime(error.message);
        });
        child.once('close', (code) => {
            this.flushBufferedLines();
            if (this.disposed) {
                return;
            }
            if (code === 0) {
                void this.execution.complete();
                return;
            }
            void this.execution.terminateRuntime(`Process exited with status ${String(code ?? 'unknown')}.`);
        });
        if (input.stdin !== undefined) {
            child.stdin.write(input.stdin);
        }
        child.stdin.end();
    }

    private consumeChunk(channel: 'stdout' | 'stderr', chunk: string | Buffer): void {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const segments = `${this.lineBuffers[channel]}${text}`.split(/\r?\n/u);
        this.lineBuffers[channel] = segments.pop() ?? '';
        for (const segment of segments) {
            this.emitOutputLine(channel, segment);
        }
    }

    private flushBufferedLines(): void {
        for (const channel of ['stdout', 'stderr'] as const) {
            const line = this.lineBuffers[channel];
            if (line) {
                this.emitOutputLine(channel, line);
            }
            this.lineBuffers[channel] = '';
        }
    }

    private emitOutputLine(channel: 'stdout' | 'stderr', line: string): void {
        if (!line) {
            return;
        }
        this.execution.emitEvent({
            type: 'execution.message',
            channel,
            text: line,
            execution: this.execution.getExecution()
        });
    }
}

function createProcessRunningSnapshot(input: {
    agentId: string;
    agentExecutionId: string;
    scope: AgentExecutionType['scope'];
    workingDirectory: string;
    task?: AgentTaskContext;
}): AgentExecutionType {
    const timestamp = new Date().toISOString();
    const missionId = getAgentExecutionScopeMissionId(input.scope);
    const taskId = getAgentExecutionScopeTaskId(input.scope) ?? input.task?.taskId;
    const stageId = getAgentExecutionScopeStageId(input.scope) ?? input.task?.stageId;
    return {
        agentId: input.agentId,
        agentExecutionId: input.agentExecutionId,
        scope: input.scope,
        workingDirectory: input.workingDirectory,
        ...(taskId ? { taskId } : {}),
        ...(missionId ? { missionId } : {}),
        ...(stageId ? { stageId } : {}),
        status: 'running',
        attention: 'autonomous',
        progress: {
            state: 'working',
            updatedAt: timestamp
        },
        waitingForInput: false,
        acceptsPrompts: false,
        acceptedCommands: ['interrupt'],
        interactionPosture: 'structured-headless',
        interactionCapabilities: deriveAgentExecutionInteractionCapabilities({
            status: 'running',
            acceptsPrompts: false,
            acceptedCommands: ['interrupt']
        }),
        reference: {
            agentId: input.agentId,
            agentExecutionId: input.agentExecutionId
        },
        startedAt: timestamp,
        updatedAt: timestamp
    };
}