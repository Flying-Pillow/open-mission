import type { EntityContractType } from '../Entity/EntitySchema.js';
import { Mission } from './Mission.js';
import {
    missionEntityName,
    missionDataSchema,
    missionActionListSnapshotSchema,
    missionDocumentSnapshotSchema,
    missionWorktreeSnapshotSchema,
    missionSnapshotSchema,
    missionProjectionSnapshotSchema,
    missionReadPayloadSchema,
    missionReadProjectionPayloadSchema,
    missionListActionsPayloadSchema,
    missionReadDocumentPayloadSchema,
    missionReadWorktreePayloadSchema,
    missionReadTerminalPayloadSchema,
    missionEnsureTerminalPayloadSchema,
    missionSendTerminalInputPayloadSchema,
    missionCommandPayloadSchema,
    missionTaskCommandPayloadSchema,
    agentSessionCommandPayloadSchema,
    missionExecuteActionPayloadSchema,
    missionWriteDocumentPayloadSchema,
    missionTerminalSnapshotSchema,
    missionCommandAcknowledgementSchema
} from './MissionSchema.js';
export const missionEntityContract: EntityContractType = {
    entity: missionEntityName,
    entityClass: Mission,
    properties: Object.fromEntries(
        Object.entries(missionDataSchema.shape).map(([name, schema]) => [
            name,
            {
                schema,
                readonly: true
            }
        ])
    ),
    methods: {
        read: {
            kind: 'query',
            payload: missionReadPayloadSchema,
            result: missionSnapshotSchema,
            execution: 'entity'
        },
        readProjection: {
            kind: 'query',
            payload: missionReadProjectionPayloadSchema,
            result: missionProjectionSnapshotSchema,
            execution: 'entity'
        },
        listActions: {
            kind: 'query',
            payload: missionListActionsPayloadSchema,
            result: missionActionListSnapshotSchema,
            execution: 'entity'
        },
        readDocument: {
            kind: 'query',
            payload: missionReadDocumentPayloadSchema,
            result: missionDocumentSnapshotSchema,
            execution: 'entity'
        },
        readWorktree: {
            kind: 'query',
            payload: missionReadWorktreePayloadSchema,
            result: missionWorktreeSnapshotSchema,
            execution: 'entity'
        },
        readTerminal: {
            kind: 'query',
            payload: missionReadTerminalPayloadSchema,
            result: missionTerminalSnapshotSchema,
            execution: 'entity'
        },
        command: {
            kind: 'mutation',
            payload: missionCommandPayloadSchema,
            result: missionCommandAcknowledgementSchema,
            execution: 'entity'
        },
        taskCommand: {
            kind: 'mutation',
            payload: missionTaskCommandPayloadSchema,
            result: missionCommandAcknowledgementSchema,
            execution: 'entity'
        },
        sessionCommand: {
            kind: 'mutation',
            payload: agentSessionCommandPayloadSchema,
            result: missionCommandAcknowledgementSchema,
            execution: 'entity'
        },
        executeAction: {
            kind: 'mutation',
            payload: missionExecuteActionPayloadSchema,
            result: missionCommandAcknowledgementSchema,
            execution: 'entity'
        },
        writeDocument: {
            kind: 'mutation',
            payload: missionWriteDocumentPayloadSchema,
            result: missionDocumentSnapshotSchema,
            execution: 'entity'
        },
        ensureTerminal: {
            kind: 'mutation',
            payload: missionEnsureTerminalPayloadSchema,
            result: missionTerminalSnapshotSchema,
            execution: 'entity'
        },
        sendTerminalInput: {
            kind: 'mutation',
            payload: missionSendTerminalInputPayloadSchema,
            result: missionTerminalSnapshotSchema,
            execution: 'entity'
        }
    }
};
