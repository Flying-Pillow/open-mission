import { describe, expect, it, vi } from 'vitest';
import { Agent } from './Agent.js';
import { AgentSchema } from './AgentSchema.js';
import { AgentRegistry } from './AgentRegistry.js';
import { AgentAdapter } from '../../daemon/runtime/agent/AgentAdapter.js';

describe('Agent', () => {
    it('projects an Agent as the canonical hydrated Entity schema', async () => {
        const adapter = new AgentAdapter({
            id: 'projection-agent',
            command: process.execPath,
            displayName: 'Projection Agent',
            createLaunchPlan: () => ({
                mode: 'print',
                command: process.execPath,
                args: ['-e', "console.log('ok')"]
            })
        });

        const data = (await Agent.fromAdapter(adapter)).toData();

        expect(data).not.toHaveProperty('optionCatalog');
        expect(AgentSchema.parse({
            ...data,
            commands: []
        })).toMatchObject({
            id: 'agent:projection-agent',
            agentId: 'projection-agent',
            displayName: 'Projection Agent',
            diagnostics: {
                command: process.execPath,
                supportsUsageParsing: false,
                supportedMessageCount: 0
            },
            commands: []
        });
    });

    it('tests an Agent connection through the class command seam', async () => {
        const adapter = new AgentAdapter({
            id: 'command-agent',
            command: process.execPath,
            displayName: 'Command Agent',
            createLaunchPlan: () => ({
                mode: 'print',
                command: process.execPath,
                args: ['-e', "console.log('ok')"]
            })
        });
        const agent = await Agent.fromAdapter(adapter);
        vi.spyOn(AgentRegistry, 'createConfigured').mockResolvedValue(new AgentRegistry({ agents: [agent] }));

        const result = await Agent.testConnection({
            agentId: 'command-agent',
            repositoryRootPath: process.cwd(),
            workingDirectory: process.cwd()
        }, {
            surfacePath: process.cwd()
        });

        expect(result).toMatchObject({
            ok: true,
            kind: 'success',
            agentId: 'command-agent',
            agentName: 'Command Agent'
        });
    });
});