import { spawn } from 'node:child_process';
import type { Agent } from '../../../entities/Agent/Agent.js';
import type {
    AgentConnectionDiagnostic,
    AgentLaunchConfig,
    AgentMetadata
} from '../../../entities/AgentExecution/protocol/AgentExecutionProtocolTypes.js';

const DEFAULT_PROMPT = 'Reply with only: ok';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_CAPTURED_OUTPUT_LENGTH = 4_000;

export type AgentConnectionTestInput = {
    agent: Agent;
    repositoryRootPath: string;
    workingDirectory: string;
    model?: string;
    reasoningEffort?: string;
    launchMode?: 'interactive' | 'print';
    initialPrompt?: string;
    timeoutMs?: number;
};

export class AgentConnectionTester {
    public async test(input: AgentConnectionTestInput): Promise<{
        ok: boolean;
        kind: AgentConnectionDiagnostic['kind'];
        agentId: string;
        agentName: string;
        summary: string;
        detail?: string;
        sampleOutput?: string;
        diagnosticCode?: string;
        metadata?: AgentMetadata;
    }> {
        const adapter = input.agent.requireAdapter();
        const availability = await adapter.isAvailable();
        if (!availability.available) {
            return {
                ok: false,
                kind: 'spawn-failed',
                agentId: input.agent.agentId,
                agentName: input.agent.displayName,
                summary: `${input.agent.displayName} is unavailable.`,
                ...(availability.reason ? { detail: availability.reason } : {}),
                diagnosticCode: 'adapter-unavailable'
            };
        }

        try {
            const config = this.createLaunchConfig(input);
            const prepared = await adapter.prepareLaunchConfig(config);
            try {
                const plan = adapter.createLaunchPlan(prepared.config);
                return await this.runPlan(input, adapter, plan);
            } finally {
                await prepared.cleanup?.().catch(() => undefined);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const kind: AgentConnectionDiagnostic['kind'] = /model/i.test(message) ? 'invalid-model' : /log(?:ged)? in|auth/i.test(message) ? 'auth-failed' : 'spawn-failed';
            return {
                ok: false,
                kind,
                agentId: input.agent.agentId,
                agentName: input.agent.displayName,
                summary: `${input.agent.displayName} connection test failed before launch.`,
                detail: message,
                diagnosticCode: kind === 'auth-failed' ? 'preflight-auth-failed' : kind === 'invalid-model' ? 'preflight-invalid-model' : 'preflight-launch-failed'
            };
        }
    }

    private createLaunchConfig(input: AgentConnectionTestInput): AgentLaunchConfig {
        return {
            scope: {
                kind: 'repository',
                repositoryRootPath: input.repositoryRootPath
            },
            workingDirectory: input.workingDirectory,
            resume: { mode: 'new' },
            initialPrompt: {
                source: 'system',
                text: input.initialPrompt?.trim() || DEFAULT_PROMPT
            },
            metadata: {
                model: input.model ?? '',
                ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
                ...(input.launchMode ? { launchMode: input.launchMode } : { launchMode: 'print' })
            }
        };
    }

    private async runPlan(
        input: AgentConnectionTestInput,
        adapter: ReturnType<Agent['requireAdapter']>,
        plan: { command: string; args: string[]; env?: NodeJS.ProcessEnv }
    ) {
        const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const child = spawn(plan.command, plan.args, {
            cwd: input.workingDirectory,
            env: plan.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false
        });

        let stdout = '';
        let stderr = '';
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
            stdout = appendBounded(stdout, chunk);
        });
        child.stderr?.on('data', (chunk: string) => {
            stderr = appendBounded(stderr, chunk);
        });

        const outcome = await new Promise<
            | { type: 'exit'; code: number | null; signal: NodeJS.Signals | null }
            | { type: 'error'; error: Error }
            | { type: 'timeout' }
        >((resolve) => {
            const timeout = setTimeout(() => {
                child.kill('SIGTERM');
                resolve({ type: 'timeout' });
            }, timeoutMs);
            child.once('error', (error) => {
                clearTimeout(timeout);
                resolve({ type: 'error', error });
            });
            child.once('close', (code, signal) => {
                clearTimeout(timeout);
                resolve({ type: 'exit', code, signal });
            });
        });

        if (outcome.type === 'timeout') {
            const diagnostic = adapter.diagnoseConnectionFailure({ stdout, stderr, error: new Error('timeout') })
                ?? {
                kind: 'timeout' as const,
                summary: `${input.agent.displayName} connection test timed out.`,
                detail: coalesceOutput(stdout, stderr) || `The adapter did not finish within ${timeoutMs}ms.`,
                diagnosticCode: 'timeout'
            };
            return toResult(input.agent, false, diagnostic);
        }

        if (outcome.type === 'error') {
            const diagnostic = adapter.diagnoseConnectionFailure({ stdout, stderr, error: outcome.error })
                ?? {
                kind: 'spawn-failed' as const,
                summary: `${input.agent.displayName} failed to start.`,
                detail: outcome.error.message,
                diagnosticCode: 'spawn-error'
            };
            return toResult(input.agent, false, diagnostic);
        }

        const sampleOutput = coalesceOutput(stdout, stderr);
        if (outcome.code === 0) {
            return {
                ok: true,
                kind: 'success',
                agentId: input.agent.agentId,
                agentName: input.agent.displayName,
                summary: `${input.agent.displayName} connection test succeeded.`,
                ...(sampleOutput ? { sampleOutput } : {}),
                diagnosticCode: 'success'
            };
        }

        const diagnostic = adapter.diagnoseConnectionFailure({
            exitCode: outcome.code,
            signal: outcome.signal,
            stdout,
            stderr
        }) ?? inferGenericFailure(input.agent.displayName, outcome.code, outcome.signal, stdout, stderr);
        return toResult(input.agent, false, diagnostic);
    }
}

function inferGenericFailure(
    agentName: string,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    stdout: string,
    stderr: string
): AgentConnectionDiagnostic {
    const sampleOutput = coalesceOutput(stdout, stderr);
    const text = `${stdout}\n${stderr}`.toLowerCase();
    if (/not logged in|login required|authenticate|authentication failed|unauthorized/.test(text)) {
        return {
            kind: 'auth-failed',
            summary: `${agentName} is not authenticated.`,
            ...(sampleOutput ? { detail: sampleOutput } : {}),
            diagnosticCode: 'auth-failed'
        };
    }
    if (/invalid model|model not found|unsupported model/.test(text)) {
        return {
            kind: 'invalid-model',
            summary: `${agentName} rejected the selected model.`,
            ...(sampleOutput ? { detail: sampleOutput } : {}),
            diagnosticCode: 'invalid-model'
        };
    }
    return {
        kind: 'unknown',
        summary: `${agentName} connection test failed.`,
        detail: sampleOutput || [
            exitCode != null ? `exit ${String(exitCode)}` : null,
            signal ? `signal ${signal}` : null
        ].filter(Boolean).join(' · ') || 'No diagnostic output was captured.',
        diagnosticCode: 'unknown'
    };
}

function toResult(
    agent: Agent,
    ok: boolean,
    diagnostic: AgentConnectionDiagnostic
) {
    return {
        ok,
        kind: diagnostic.kind,
        agentId: agent.agentId,
        agentName: agent.displayName,
        summary: diagnostic.summary,
        ...(diagnostic.detail ? { detail: diagnostic.detail } : {}),
        ...(diagnostic.sampleOutput ? { sampleOutput: diagnostic.sampleOutput } : {}),
        ...(diagnostic.diagnosticCode ? { diagnosticCode: diagnostic.diagnosticCode } : {}),
        ...(diagnostic.metadata ? { metadata: diagnostic.metadata } : {})
    };
}

function appendBounded(current: string, chunk: string): string {
    const next = `${current}${chunk}`;
    return next.length <= MAX_CAPTURED_OUTPUT_LENGTH
        ? next
        : next.slice(-MAX_CAPTURED_OUTPUT_LENGTH);
}

function coalesceOutput(stdout: string, stderr: string): string | undefined {
    const value = `${stdout}\n${stderr}`.trim();
    return value ? value : undefined;
}