import { describe, expect, it } from 'vitest';
import {
    AgentMessageSignalPayloadSchema,
    MAX_AGENT_EXECUTION_SIGNAL_ARTIFACT_REFERENCES
} from '../AgentExecutionSchema.js';

describe('AgentExecutionSchema', () => {
    it('accepts message signals with more than eight artifact references', () => {
        const artifacts = Array.from({ length: 12 }, (_, index) => ({
            path: `.mission/workflow/templates/file-${index + 1}.md`,
            activity: 'read' as const
        }));

        const result = AgentMessageSignalPayloadSchema.safeParse({
            type: 'message',
            channel: 'agent',
            text: 'Re-read workflow artifacts.',
            artifacts
        });

        expect(result.success).toBe(true);
        if (!result.success) {
            return;
        }

        expect(result.data.artifacts).toHaveLength(12);
        expect(MAX_AGENT_EXECUTION_SIGNAL_ARTIFACT_REFERENCES).toBeGreaterThanOrEqual(12);
    });
});