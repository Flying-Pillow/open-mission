import { describe, expect, it } from 'vitest';
import {
    createMissionMcpBridgeDaemonToolInput,
    createMissionMcpBridgeToolInputSchema,
    type MissionMcpToolDescriptor
} from './runMissionMcpCommand.js';

describe('mission mcp stdio bridge helpers', () => {
    it('passes semantic operation input directly without Agent signal wrapping', () => {
        const tool: MissionMcpToolDescriptor = {
            name: 'read_artifact',
            title: 'Read Artifact',
            kind: 'semantic-operation'
        };
        const parsed = createMissionMcpBridgeToolInputSchema(tool).parse({
            path: 'missions/1-initial-setup/BRIEF.md',
            eventId: 'event-1'
        });

        expect(createMissionMcpBridgeDaemonToolInput({
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
        const tool: MissionMcpToolDescriptor = {
            name: 'progress',
            title: 'Progress',
            kind: 'signal'
        };
        const parsed = createMissionMcpBridgeToolInputSchema(tool).parse({
            summary: 'Indexing current Code root.'
        });

        expect(createMissionMcpBridgeDaemonToolInput({
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