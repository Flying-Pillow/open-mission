import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from '../../../entities/Agent/Agent.js';
import { AgentAdapter } from './AgentAdapter.js';
import { AgentConnectionTester } from './AgentConnectionTester.js';

describe('AgentConnectionTester', () => {
    const temporaryDirectories = new Set<string>();

    afterEach(async () => {
        await Promise.all([...temporaryDirectories].map(async (directory) => {
            await fs.rm(directory, { recursive: true, force: true });
            temporaryDirectories.delete(directory);
        }));
    });

    it('runs the probe in the requested working directory and returns success', async () => {
        const workingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-agent-connection-working-'));
        temporaryDirectories.add(workingDirectory);
        const adapter = new AgentAdapter({
            id: 'probe-agent',
            command: process.execPath,
            displayName: 'Probe Agent',
            createLaunchPlan: () => ({
                mode: 'print',
                command: process.execPath,
                args: ['-e', "console.log(process.cwd())"]
            })
        });
        const agent = await Agent.fromAdapter(adapter);

        const result = await new AgentConnectionTester().test({
            agent,
            repositoryRootPath: workingDirectory,
            workingDirectory
        });

        expect(result).toMatchObject({
            ok: true,
            kind: 'success',
            agentId: 'probe-agent'
        });
        expect(result.sampleOutput).toContain(workingDirectory);
    });

    it('returns adapter-specific diagnostics for known auth failures', async () => {
        const workingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-agent-connection-auth-'));
        temporaryDirectories.add(workingDirectory);
        const adapter = new AgentAdapter({
            id: 'auth-agent',
            command: process.execPath,
            displayName: 'Auth Agent',
            createLaunchPlan: () => ({
                mode: 'print',
                command: process.execPath,
                args: ['-e', "console.error('login required'); process.exit(2)"]
            }),
            diagnoseConnectionFailure: ({ stderr }) => stderr.includes('login required')
                ? {
                    kind: 'auth-failed',
                    summary: 'Auth Agent is not authenticated.',
                    detail: 'Run the provider login flow and retry.',
                    diagnosticCode: 'auth-required'
                }
                : undefined
        });
        const agent = await Agent.fromAdapter(adapter);

        const result = await new AgentConnectionTester().test({
            agent,
            repositoryRootPath: workingDirectory,
            workingDirectory
        });

        expect(result).toMatchObject({
            ok: false,
            kind: 'auth-failed',
            diagnosticCode: 'auth-required'
        });
        expect(result.detail).toBe('Run the provider login flow and retry.');
    });

    it('classifies timeouts without creating a managed execution', async () => {
        const workingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-agent-connection-timeout-'));
        temporaryDirectories.add(workingDirectory);
        const adapter = new AgentAdapter({
            id: 'timeout-agent',
            command: process.execPath,
            displayName: 'Timeout Agent',
            createLaunchPlan: () => ({
                mode: 'print',
                command: process.execPath,
                args: ['-e', 'setTimeout(() => {}, 60_000)']
            })
        });
        const agent = await Agent.fromAdapter(adapter);

        const result = await new AgentConnectionTester().test({
            agent,
            repositoryRootPath: workingDirectory,
            workingDirectory,
            timeoutMs: 25
        });

        expect(result).toMatchObject({
            ok: false,
            kind: 'timeout',
            diagnosticCode: 'timeout'
        });
    });
});