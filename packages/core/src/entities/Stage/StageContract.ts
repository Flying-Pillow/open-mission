import type { EntityContractType } from '../Entity/EntitySchema.js';
import { StageEntity } from './Stage.js';
import {
    missionStageEntityName,
    stageIdentityPayloadSchema,
    stageExecuteCommandPayloadSchema,
    missionStageSnapshotSchema,
    stageCommandAcknowledgementSchema
} from './StageSchema.js';

export const stageEntityContract: EntityContractType = {
    entity: missionStageEntityName,
    entityClass: StageEntity,
    methods: {
        read: {
            kind: 'query',
            payload: stageIdentityPayloadSchema,
            result: missionStageSnapshotSchema,
            execution: 'class'
        },
        executeCommand: {
            kind: 'mutation',
            payload: stageExecuteCommandPayloadSchema,
            result: stageCommandAcknowledgementSchema,
            execution: 'class'
        }
    }
};
