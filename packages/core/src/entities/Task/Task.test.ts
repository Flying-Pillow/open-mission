import { describe, expect, it } from 'vitest';
import { Task } from './Task.js';
import { TaskReworkCommandInputSchema, TaskStartCommandOptionsSchema } from './TaskSchema.js';
import type { MissionTaskState } from '../../types.js';

const taskState: MissionTaskState = {
    taskId: 'implementation/01',
    stage: 'implementation',
    sequence: 1,
    subject: 'Implement task',
    instruction: 'Ship it.',
    body: 'Ship it.',
    dependsOn: [],
    waitingOn: [],
    status: 'ready',
    agent: 'copilot-cli',
    retries: 0,
    fileName: '01.md',
    filePath: '/mission/.mission/tasks/01.md',
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
            agentRunner: 'copilot-cli'
        });
    });

    it('uses strict schemas for command inputs', () => {
        expect(TaskStartCommandOptionsSchema.parse({ terminalSessionName: 'terminal-1' })).toEqual({
            terminalSessionName: 'terminal-1'
        });
        expect(() => TaskStartCommandOptionsSchema.parse({ terminalSessionName: 'terminal-1', extra: true })).toThrow();
        expect(TaskReworkCommandInputSchema.parse('Needs another pass.')).toBe('Needs another pass.');
        expect(() => TaskReworkCommandInputSchema.parse('')).toThrow();
    });
});
