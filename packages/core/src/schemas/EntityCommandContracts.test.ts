import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod/v4';
import {
    agentSessionCommandListSnapshotSchema,
    agentSessionEntityReferenceSchema,
    agentSessionExecuteCommandPayloadSchema,
    agentSessionRemoteCommandPayloadSchemas,
    agentSessionRemoteQueryPayloadSchemas,
    missionAgentPromptSchema,
    missionAgentSessionSnapshotSchema
} from './AgentSession.js';
import {
    artifactEntityReferenceSchema,
    artifactExecuteCommandPayloadSchema,
    artifactIdentityPayloadSchema,
    artifactRemoteCommandPayloadSchemas,
    artifactRemoteQueryPayloadSchemas,
    missionArtifactSnapshotSchema
} from './Artifact.js';
import {
    stageCommandListSnapshotSchema,
    stageEntityReferenceSchema,
    stageExecuteCommandPayloadSchema,
    stageRemoteCommandPayloadSchemas,
    stageRemoteQueryPayloadSchemas,
    missionStageSnapshotSchema
} from './Stage.js';
import {
    taskCommandAcknowledgementSchema,
    taskCommandListSnapshotSchema,
    taskEntityReferenceSchema,
    taskExecuteCommandPayloadSchema,
    taskIdentityPayloadSchema,
    taskRemoteCommandPayloadSchemas,
    taskRemoteQueryPayloadSchemas,
    missionTaskSnapshotSchema
} from './Task.js';
import { missionChildEntityReferenceSchema } from './Mission.js';
import {
    entityCommandDescriptorSchema,
    entityCommandListSnapshotSchema
} from './EntityRemote.js';

describe('child entity command contract schemas', () => {
    it('validates strict command descriptors with input and confirmation metadata', () => {
        const descriptor = entityCommandDescriptorSchema.parse({
            commandId: 'task.rework',
            label: 'Send Back',
            description: 'Return this task for corrective work.',
            disabled: false,
            variant: 'destructive',
            iconHint: 'undo-2',
            confirmation: {
                required: true,
                prompt: 'Send this task back?'
            },
            input: {
                kind: 'text',
                label: 'Reason',
                required: true,
                multiline: true
            },
            presentationOrder: 30
        });

        expect(descriptor.commandId).toBe('task.rework');
        expect(descriptor.confirmation?.required).toBe(true);

        expect(() => entityCommandDescriptorSchema.parse({
            commandId: 'task.rework',
            label: 'Send Back',
            scope: 'task'
        })).toThrow(ZodError);
    });

    it('validates generic command list snapshots without target-filter context', () => {
        const snapshot = entityCommandListSnapshotSchema.parse({
            entity: 'Task',
            entityId: 'implementation/13-create-child-entity-command-contracts',
            commands: [
                {
                    commandId: 'task.start',
                    label: 'Start Ready Task',
                    disabled: false
                }
            ]
        });

        expect(snapshot.commands).toHaveLength(1);
        expect(() => entityCommandListSnapshotSchema.parse({
            ...snapshot,
            context: { taskId: snapshot.entityId }
        })).toThrow(ZodError);
    });

    it('validates child entity references as typed references', () => {
        expect(stageEntityReferenceSchema.parse({
            entity: 'Stage',
            missionId: 'mission-29',
            stageId: 'implementation'
        })).toMatchObject({ entity: 'Stage' });

        expect(taskEntityReferenceSchema.parse({
            entity: 'Task',
            missionId: 'mission-29',
            taskId: 'implementation/13-create-child-entity-command-contracts'
        })).toMatchObject({ entity: 'Task' });

        expect(artifactEntityReferenceSchema.parse({
            entity: 'Artifact',
            missionId: 'mission-29',
            artifactId: '03-IMPLEMENTATION/VERIFY.md'
        })).toMatchObject({ entity: 'Artifact' });

        expect(agentSessionEntityReferenceSchema.parse({
            entity: 'AgentSession',
            missionId: 'mission-29',
            sessionId: 'session-1'
        })).toMatchObject({ entity: 'AgentSession' });

        expect(missionChildEntityReferenceSchema.parse({
            entity: 'Task',
            missionId: 'mission-29',
            taskId: 'implementation/13-create-child-entity-command-contracts'
        })).toMatchObject({ entity: 'Task' });
    });

    it('validates child snapshots from first-class child schema modules', () => {
        const task = missionTaskSnapshotSchema.parse({
            taskId: 'implementation/13-create-child-entity-command-contracts',
            stageId: 'implementation',
            sequence: 13,
            title: 'Create Child Entity Command Contracts',
            instruction: 'Split child schemas.',
            lifecycle: 'running',
            dependsOn: [],
            waitingOnTaskIds: [],
            agentRunner: 'copilot-cli',
            retries: 0
        });

        const artifact = missionArtifactSnapshotSchema.parse({
            artifactId: '03-IMPLEMENTATION/VERIFY.md',
            kind: 'mission',
            label: 'Verify',
            fileName: 'VERIFY.md'
        });

        expect(missionStageSnapshotSchema.parse({
            stageId: 'implementation',
            lifecycle: 'running',
            isCurrentStage: true,
            artifacts: [artifact],
            tasks: [task]
        })).toMatchObject({ stageId: 'implementation' });

        expect(missionAgentSessionSnapshotSchema.parse({
            sessionId: 'session-1',
            runnerId: 'copilot-cli',
            runnerLabel: 'Copilot CLI',
            lifecycleState: 'running'
        })).toMatchObject({ sessionId: 'session-1' });
    });

    it('keeps Task command payloads strict and free of actionbar filtering context', () => {
        const identity = taskIdentityPayloadSchema.parse({
            missionId: 'mission-29',
            taskId: 'implementation/13-create-child-entity-command-contracts'
        });

        expect(identity.taskId).toBe('implementation/13-create-child-entity-command-contracts');
        expect(taskExecuteCommandPayloadSchema.parse({
            ...identity,
            commandId: 'task.start',
            input: { terminalSessionName: 'task-13' }
        })).toMatchObject({ commandId: 'task.start' });

        expect(() => taskIdentityPayloadSchema.parse({
            ...identity,
            stageId: 'implementation'
        })).toThrow(ZodError);

        expect(() => taskExecuteCommandPayloadSchema.parse({
            ...identity,
            commandId: 'task.start',
            context: { scope: 'task', taskId: identity.taskId }
        })).toThrow(ZodError);
    });

    it('uses stable artifact identity instead of untyped artifact paths', () => {
        expect(artifactIdentityPayloadSchema.parse({
            missionId: 'mission-29',
            artifactId: '03-IMPLEMENTATION/VERIFY.md'
        })).toMatchObject({ artifactId: '03-IMPLEMENTATION/VERIFY.md' });

        expect(artifactExecuteCommandPayloadSchema.parse({
            missionId: 'mission-29',
            artifactId: '03-IMPLEMENTATION/VERIFY.md',
            commandId: 'artifact.review'
        })).toMatchObject({ commandId: 'artifact.review' });

        expect(() => artifactIdentityPayloadSchema.parse({
            missionId: 'mission-29',
            artifactPath: '03-IMPLEMENTATION/VERIFY.md'
        })).toThrow(ZodError);
    });

    it('validates child-specific command list and acknowledgement result schemas', () => {
        expect(stageCommandListSnapshotSchema.parse({
            entity: 'Stage',
            entityId: 'implementation',
            missionId: 'mission-29',
            stageId: 'implementation',
            commands: []
        })).toMatchObject({ entity: 'Stage' });

        expect(taskCommandListSnapshotSchema.parse({
            entity: 'Task',
            entityId: 'implementation/13-create-child-entity-command-contracts',
            missionId: 'mission-29',
            taskId: 'implementation/13-create-child-entity-command-contracts',
            commands: [{ commandId: 'task.start', label: 'Start Ready Task', disabled: false }]
        })).toMatchObject({ entity: 'Task' });

        expect(agentSessionCommandListSnapshotSchema.parse({
            entity: 'AgentSession',
            entityId: 'session-1',
            missionId: 'mission-29',
            sessionId: 'session-1',
            commands: [{ commandId: 'session.cancel', label: 'Cancel', disabled: false }]
        })).toMatchObject({ entity: 'AgentSession' });

        expect(taskCommandAcknowledgementSchema.parse({
            ok: true,
            entity: 'Task',
            method: 'executeCommand',
            id: 'implementation/13-create-child-entity-command-contracts',
            missionId: 'mission-29',
            taskId: 'implementation/13-create-child-entity-command-contracts',
            commandId: 'task.start'
        })).toMatchObject({ entity: 'Task', commandId: 'task.start' });
    });

    it('publishes child entity remote payload maps from the canonical schema surface', () => {
        expect(stageRemoteQueryPayloadSchemas).toHaveProperty('listCommands');
        expect(stageRemoteCommandPayloadSchemas).toHaveProperty('executeCommand');
        expect(taskRemoteQueryPayloadSchemas).toHaveProperty('listCommands');
        expect(taskRemoteCommandPayloadSchemas).toHaveProperty('executeCommand');
        expect(artifactRemoteQueryPayloadSchemas).toHaveProperty('readDocument');
        expect(artifactRemoteCommandPayloadSchemas).toHaveProperty('writeDocument');
        expect(agentSessionRemoteQueryPayloadSchemas).toHaveProperty('listCommands');
        expect(agentSessionRemoteCommandPayloadSchemas).toHaveProperty('sendPrompt');

        expect(stageExecuteCommandPayloadSchema.parse({
            missionId: 'mission-29',
            stageId: 'implementation',
            commandId: 'stage.generateTasks'
        })).toMatchObject({ commandId: 'stage.generateTasks' });

        expect(agentSessionExecuteCommandPayloadSchema.parse({
            missionId: 'mission-29',
            sessionId: 'session-1',
            commandId: 'session.cancel'
        })).toMatchObject({ commandId: 'session.cancel' });

        expect(missionAgentPromptSchema.parse({
            source: 'operator',
            text: 'Please continue.'
        })).toMatchObject({ source: 'operator' });
    });
});
