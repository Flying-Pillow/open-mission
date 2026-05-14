import { describe, expect, it } from 'vitest';
import { projectAgentExecutionObservationSignalToTimelineItem } from './AgentExecutionObservationSignalRegistry.js';

describe('AgentExecutionSignalRegistry', () => {
    it('derives read-focused progress titles from artifact activity', () => {
        const item = projectAgentExecutionObservationSignalToTimelineItem({
            itemId: 'timeline-item-1',
            occurredAt: '2026-05-09T12:00:00.000Z',
            signal: {
                type: 'progress',
                summary: 'Inspecting ArtifactViewer.svelte',
                artifacts: [
                    {
                        path: 'apps/web/src/lib/components/entities/Artifact/ArtifactViewer.svelte',
                        activity: 'read'
                    }
                ],
                source: 'agent-signal',
                confidence: 'medium'
            },
            provenance: {
                durable: true,
                sourceRecordIds: ['record-1'],
                confidence: 'medium'
            }
        });

        expect(item?.primitive).toBe('activity.progress');
        expect(item?.behavior.class).toBe('live-activity');
        expect(item?.payload.title).toBe('Reading artifact');
        expect(item?.payload.path).toBe('apps/web/src/lib/components/entities/Artifact/ArtifactViewer.svelte');
    });

    it('projects write-focused messages as artifact timeline items', () => {
        const item = projectAgentExecutionObservationSignalToTimelineItem({
            itemId: 'timeline-item-2',
            occurredAt: '2026-05-09T12:01:00.000Z',
            signal: {
                type: 'message',
                channel: 'agent',
                text: 'Applied the close button change.',
                artifacts: [
                    {
                        path: 'apps/web/src/lib/components/entities/Artifact/ArtifactViewer.svelte',
                        activity: 'write'
                    }
                ],
                source: 'agent-signal',
                confidence: 'medium'
            },
            provenance: {
                durable: true,
                sourceRecordIds: ['record-2'],
                confidence: 'medium'
            }
        });

        expect(item?.primitive).toBe('artifact.updated');
        expect(item?.behavior.class).toBe('artifact');
        expect(item?.payload.title).toBe('Updated artifact');
        expect(item?.payload.text).toBe('Applied the close button change.');
    });

    it('projects provider tool-call diagnostics into artifact-aware activity items', () => {
        const item = projectAgentExecutionObservationSignalToTimelineItem({
            itemId: 'timeline-item-3',
            occurredAt: '2026-05-09T12:02:00.000Z',
            signal: {
                type: 'diagnostic',
                code: 'tool-call',
                summary: "Provider invoked tool 'read_file'.",
                payload: {
                    toolName: 'read_file',
                    args: '.mission/workflow/workflow.json'
                },
                source: 'provider-structured',
                confidence: 'medium'
            },
            provenance: {
                durable: true,
                sourceRecordIds: ['record-3'],
                confidence: 'medium'
            }
        });

        expect(item?.primitive).toBe('activity.tool');
        expect(item?.payload.title).toBe('Reading artifact');
        expect(item?.payload.path).toBe('.mission/workflow/workflow.json');
        expect(item?.payload.artifacts).toEqual([
            expect.objectContaining({
                path: '.mission/workflow/workflow.json',
                activity: 'read'
            })
        ]);
        expect(item?.payload.activeToolName).toBe('read file');
    });
});