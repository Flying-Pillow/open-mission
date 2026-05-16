import type { EntityContractType } from '../Entity/EntitySchema.js';
import { Task } from './Task.js';
import {
    taskEntityName,
    TaskLocatorSchema,
    TaskInstanceInputSchema,
    TaskConfigureInputSchema,
    TaskStartInputSchema,
    TaskCancelInputSchema,
    TaskReworkInputSchema,
    TaskStorageSchema,
    TaskDataSchema,
    TaskCommandAcknowledgementSchema,
    TaskDataChangedSchema
} from './TaskSchema.js';

export const TaskContract: EntityContractType = {
    entity: taskEntityName,
    entityClass: Task,
    inputSchema: TaskLocatorSchema,
    storageSchema: TaskStorageSchema,
    dataSchema: TaskDataSchema,
    methods: {
        read: {
            kind: 'query',
            payload: TaskLocatorSchema,
            result: TaskDataSchema,
            execution: 'class'
        },
        configure: {
            kind: 'mutation',
            payload: TaskConfigureInputSchema,
            result: TaskCommandAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Configure',
                icon: 'settings',
                presentationOrder: 10
            }
        },
        start: {
            kind: 'mutation',
            payload: TaskStartInputSchema,
            result: TaskCommandAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Start task',
                icon: 'play',
                presentationOrder: 20
            }
        },
        cancel: {
            kind: 'mutation',
            payload: TaskCancelInputSchema,
            result: TaskCommandAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Stop task',
                icon: 'hand',
                confirmation: {
                    required: true,
                    prompt: 'Stop this task and release its running agent resources?'
                },
                presentationOrder: 30
            }
        },
        complete: {
            kind: 'mutation',
            payload: TaskInstanceInputSchema,
            result: TaskCommandAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Mark task done',
                icon: 'circle-check',
                confirmation: {
                    required: true,
                    prompt: 'Mark this task done?'
                },
                presentationOrder: 40
            }
        },
        reopen: {
            kind: 'mutation',
            payload: TaskInstanceInputSchema,
            result: TaskCommandAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Reopen task',
                icon: 'refresh-cw',
                confirmation: {
                    required: true,
                    prompt: 'Reopen this task and invalidate downstream stage progress?'
                },
                presentationOrder: 50
            }
        },
        rework: {
            kind: 'mutation',
            payload: TaskReworkInputSchema,
            result: TaskCommandAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Instruct',
                icon: 'message-square-plus',
                confirmation: {
                    required: true,
                    prompt: 'Restart this task with corrective guidance?'
                },
                input: {
                    kind: 'text',
                    label: 'Instruction',
                    placeholder: 'Explain what was wrong and how the next attempt should correct it.',
                    required: true,
                    multiline: true
                },
                presentationOrder: 60
            }
        },
        reworkFromVerification: {
            kind: 'mutation',
            payload: TaskInstanceInputSchema,
            result: TaskCommandAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Send Back',
                icon: 'undo-2',
                confirmation: {
                    required: true,
                    prompt: 'Send this task back for corrective rework?'
                },
                presentationOrder: 70
            }
        },
        enableAutostart: {
            kind: 'mutation',
            payload: TaskInstanceInputSchema,
            result: TaskCommandAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Enable Autostart',
                icon: 'timer',
                presentationOrder: 80
            }
        },
        disableAutostart: {
            kind: 'mutation',
            payload: TaskInstanceInputSchema,
            result: TaskCommandAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Disable Autostart',
                icon: 'timer-off',
                presentationOrder: 90
            }
        }
    },
    events: {
        'data.changed': {
            payload: TaskDataChangedSchema
        }
    }
};
