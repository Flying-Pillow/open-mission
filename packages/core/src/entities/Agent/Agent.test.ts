import { describe, expect, it, vi } from 'vitest';
import { Agent } from './Agent.js';
import { AgentSchema } from './AgentSchema.js';
import { AgentRegistry } from './AgentRegistry.js';
import { AgentAdapter } from '../../daemon/runtime/agent-execution/adapter/AgentAdapter.js';
import { Repository } from '../Repository/Repository.js';

describe('Agent', () => {
    it('hydrates an Agent as the canonical Entity schema', async () => {
        const adapter = new AgentAdapter({
            id: 'catalog-agent',
            command: process.execPath,
            displayName: 'Timeline Agent',
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
            id: 'agent:catalog-agent',
            agentId: 'catalog-agent',
            displayName: 'Timeline Agent',
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
        vi.spyOn(Repository, 'resolve').mockResolvedValue({
            repositoryRootPath: process.cwd()
        } as Repository);
        const agentConnectionTester = {
            test: vi.fn(async ({ agent: testedAgent }: { agent: Agent }) => ({
                ok: true,
                kind: 'success',
                agentId: testedAgent.agentId,
                agentName: testedAgent.displayName,
                summary: `${testedAgent.displayName} is available.`
            }))
        };

        const result = await Agent.testConnection({
            agentId: 'command-agent',
            repositoryId: 'repository:local/test',
            workingDirectory: process.cwd()
        }, {
            surfacePath: process.cwd(),
            agentConnectionTester
        });

        expect(agentConnectionTester.test).toHaveBeenCalledOnce();
        expect(result).toMatchObject({
            ok: true,
            kind: 'success',
            agentId: 'command-agent',
            agentName: 'Command Agent'
        });
    });
});