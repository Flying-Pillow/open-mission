import { describe, expect, it } from 'vitest';
import { Task } from './Task.js';
import { buildTaskLaunchPrompt } from './taskLaunchPrompt.js';
import { TaskReworkCommandInputSchema, TaskStartCommandOptionsSchema } from './TaskSchema.js';
import type { TaskDossierRecordType } from './TaskSchema.js';

const taskState: TaskDossierRecordType = {
    taskId: 'implementation/01',
    stage: 'implementation',
    sequence: 1,
    subject: 'Implement task',
    instruction: 'Ship it.',
    body: 'Ship it.',
    dependsOn: [],
    context: [
        { name: 'Spec', path: '02-spec/SPEC.md', selectionPosition: 1 },
        { name: 'Brief', path: 'BRIEF.md', selectionPosition: 0 }
    ],
    waitingOn: [],
    status: 'ready',
    agent: 'copilot-cli',
    retries: 0,
    fileName: '01.md',
    filePath: '/mission/.open-mission/tasks/01.md',
    relativePath: 'implementation/tasks/01.md'
};

describe('Task', () => {
    it('owns Task entity id construction', () => {
        expect(Task.createEntityId('mission-1', 'implementation/01')).toBe('task:mission-1/implementation/01');
    });

    it('materializes Task data from Mission task state', () => {
        expect(Task.toDataFromState(taskState, 'mission-1')).toMatchObject({
            id: 'task:mission-1/implementation/01',
            taskId: 'implementation/01',
            stageId: 'implementation',
            title: 'Implement task',
            lifecycle: 'ready',
            context: [
                { name: 'Spec', path: '02-spec/SPEC.md', selectionPosition: 1 },
                { name: 'Brief', path: 'BRIEF.md', selectionPosition: 0 }
            ],
            agentAdapter: 'copilot-cli'
        });
    });

    it('adds selected context artifacts to the launch prompt in selection order', () => {
        expect(buildTaskLaunchPrompt(taskState, '/mission')).toContain([
            'Context artifacts:',
            '- Brief: @BRIEF.md',
            '- Spec: @02-spec/SPEC.md'
        ].join('\n'));
    });

    it('uses strict schemas for command inputs', () => {
        expect(TaskStartCommandOptionsSchema.parse({ terminalName: 'terminal-1' })).toEqual({
            terminalName: 'terminal-1'
        });
        expect(() => TaskStartCommandOptionsSchema.parse({ terminalName: 'terminal-1', extra: true })).toThrow();
        expect(TaskReworkCommandInputSchema.parse('Needs another pass.')).toBe('Needs another pass.');
        expect(() => TaskReworkCommandInputSchema.parse('')).toThrow();
    });
});
