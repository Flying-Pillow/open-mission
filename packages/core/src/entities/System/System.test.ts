import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { System } from './System.js';
import { systemSingletonId } from './SystemSchema.js';

describe('System', () => {
    beforeEach(() => {
        delete process.env['OPEN_MISSION_CONFIG_PATH'];
        delete process.env['MISSIONS_PATH'];
        delete process.env['REPOSITORIES_PATH'];
    });

    afterEach(async () => {
        const configHome = process.env['XDG_CONFIG_HOME'];
        if (configHome) {
            await fs.rm(configHome, { recursive: true, force: true });
            delete process.env['XDG_CONFIG_HOME'];
        }
        delete process.env['OPEN_MISSION_CONFIG_PATH'];
        delete process.env['MISSIONS_PATH'];
        delete process.env['REPOSITORIES_PATH'];
    });

    it('reads the default persisted system config shape', async () => {
        process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-system-entity-'));

        await expect(System.read({})).resolves.toMatchObject({
            id: systemSingletonId,
            repositoriesRoot: path.join(os.homedir(), 'repositories'),
            missionsRoot: path.join(os.homedir(), 'missions'),
            defaultAgentAdapter: 'codex',
            enabledAgentAdapters: [],
            packageVersion: expect.any(String)
        });
    });

    it('persists configured repositories root without changing Agent settings', async () => {
        process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-system-entity-'));

        const result = await System.configure({
            repositoriesRoot: '/tmp/repositories',
            missionsRoot: '/tmp/missions'
        });

        expect(result).toMatchObject({
            id: systemSingletonId,
            repositoriesRoot: '/tmp/repositories',
            missionsRoot: '/tmp/missions',
            defaultAgentAdapter: 'codex',
            enabledAgentAdapters: [],
            packageVersion: expect.any(String)
        });
        await expect(System.read({})).resolves.toEqual(result);
    });

    it('persists shared system agent defaults independently from the repositories root', async () => {
        process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-system-entity-'));

        await System.configure({
            repositoriesRoot: '/tmp/repositories'
        });

        const result = await System.configureAgent({
            defaultAgentAdapter: 'codex',
            enabledAgentAdapters: ['codex', 'claude-code'],
            defaultAgentMode: 'print',
            defaultModel: 'gpt-5.3-codex',
            defaultReasoningEffort: 'high'
        });

        expect(result).toMatchObject({
            id: systemSingletonId,
            repositoriesRoot: '/tmp/repositories',
            missionsRoot: '/tmp/missions',
            defaultAgentAdapter: 'codex',
            enabledAgentAdapters: ['codex', 'claude-code'],
            defaultAgentMode: 'print',
            defaultModel: 'gpt-5.3-codex',
            defaultReasoningEffort: 'high',
            packageVersion: expect.any(String)
        });
        await expect(System.read({})).resolves.toEqual(result);
    });
});