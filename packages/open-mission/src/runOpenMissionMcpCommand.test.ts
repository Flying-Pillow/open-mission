import { describe, expect, it } from 'vitest';
import {
    createOpenMissionMcpBridgeDaemonToolInput,
    createOpenMissionMcpBridgeToolInputSchema,
    type OpenMissionMcpToolDescriptor
} from './runOpenMissionMcpCommand.js';

describe('open-mission mcp stdio bridge helpers', () => {
    it('passes semantic operation input directly without Agent signal wrapping', () => {
        const tool: OpenMissionMcpToolDescriptor = {
            name: 'read_artifact',
            title: 'Read Artifact',
            kind: 'semantic-operation'
        };
        const parsed = createOpenMissionMcpBridgeToolInputSchema(tool).parse({
            path: 'missions/1-initial-setup/BRIEF.md',
            eventId: 'event-1'
        });

        expect(createOpenMissionMcpBridgeDaemonToolInput({
            tool,
            parsed,
            agentExecutionId: 'agent-execution-1',
            token: 'token-1'
        })).toEqual({
            agentExecutionId: 'agent-execution-1',
            token: 'token-1',
            path: 'missions/1-initial-setup/BRIEF.md',
            eventId: 'event-1'
        });
    });

    it('wraps signal tools as Agent signal payloads', () => {
        const tool: OpenMissionMcpToolDescriptor = {
            name: 'progress',
            title: 'Progress',
            kind: 'signal'
        };
        const parsed = createOpenMissionMcpBridgeToolInputSchema(tool).parse({
            summary: 'Indexing current Code root.'
        });

        expect(createOpenMissionMcpBridgeDaemonToolInput({
            tool,
            parsed,
            agentExecutionId: 'agent-execution-1',
            token: 'token-1'
        })).toMatchObject({
            version: 1,
            agentExecutionId: 'agent-execution-1',
            token: 'token-1',
            signal: {
                type: 'progress',
                summary: 'Indexing current Code root.'
            }
        });
    });
});