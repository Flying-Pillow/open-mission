import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { System } from './System.js';

describe('System', () => {
    beforeEach(() => {
        delete process.env['MISSION_CONFIG_PATH'];
        delete process.env['MISSIONS_PATH'];
        delete process.env['REPOSITORIES_PATH'];
    });

    afterEach(async () => {
        const configHome = process.env['XDG_CONFIG_HOME'];
        if (configHome) {
            await fs.rm(configHome, { recursive: true, force: true });
            delete process.env['XDG_CONFIG_HOME'];
        }
        delete process.env['MISSION_CONFIG_PATH'];
        delete process.env['MISSIONS_PATH'];
        delete process.env['REPOSITORIES_PATH'];
    });

    it('reads the default persisted system config shape', async () => {
        process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-system-entity-'));

        await expect(System.read({})).resolves.toMatchObject({
            repositoriesRoot: path.join(os.homedir(), 'repositories'),
            defaultAgentAdapter: 'codex',
            enabledAgentAdapters: []
        });
    });

    it('persists configured system settings', async () => {
        process.env['XDG_CONFIG_HOME'] = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-system-entity-'));

        const result = await System.configure({
            repositoriesRoot: '/tmp/repositories',
            defaultAgentAdapter: 'copilot',
            enabledAgentAdapters: ['copilot', 'codex']
        });

        expect(result).toEqual({
            repositoriesRoot: '/tmp/repositories',
            defaultAgentAdapter: 'copilot',
            enabledAgentAdapters: ['copilot', 'codex']
        });
        await expect(System.read({})).resolves.toEqual(result);
    });
});