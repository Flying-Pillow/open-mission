import type { EntityContractType } from '../Entity/EntitySchema.js';
import { Mission } from './Mission.js';
import { AgentSessionContract } from '../AgentSession/AgentSessionContract.js';
import { ArtifactContract } from '../Artifact/ArtifactContract.js';
import { createEntityChannel, createEntityId } from '../Entity/Entity.js';
import { StageContract } from '../Stage/StageContract.js';
import { TaskContract } from '../Task/TaskContract.js';
import {
    missionEntityName,
    MissionDataSchema,
    MissionFindSchema,
    MissionCatalogEntrySchema,
    MissionDocumentSnapshotSchema,
    MissionWorktreeSnapshotSchema,
    MissionSnapshotSchema,
    MissionControlViewSnapshotSchema,
    MissionReadDocumentInputSchema,
    MissionLocatorSchema,
    MissionSendTerminalInputSchema,
    MissionCommandInputSchema,
    MissionWriteDocumentInputSchema,
    MissionTerminalSnapshotSchema,
    MissionCommandAcknowledgementSchema,
    MissionStatusSnapshotSchema,
    MissionSnapshotChangedEventSchema
} from './MissionSchema.js';

export const MissionContract: EntityContractType = {
    entity: missionEntityName,
    entityClass: Mission,
    properties: Object.fromEntries(
        Object.entries(MissionDataSchema.shape).map(([name, schema]) => [
            name,
            {
                schema,
                readonly: true
            }
        ])
    ),
    methods: {
        find: {
            kind: 'query',
            payload: MissionFindSchema,
            result: MissionCatalogEntrySchema.array(),
            execution: 'class'
        },
        read: {
            kind: 'query',
            payload: MissionLocatorSchema,
            result: MissionSnapshotSchema,
            execution: 'entity'
        },
        readControlView: {
            kind: 'query',
            payload: MissionLocatorSchema,
            result: MissionControlViewSnapshotSchema,
            execution: 'entity'
        },
        readDocument: {
            kind: 'query',
            payload: MissionReadDocumentInputSchema,
            result: MissionDocumentSnapshotSchema,
            execution: 'entity'
        },
        readWorktree: {
            kind: 'query',
            payload: MissionLocatorSchema,
            result: MissionWorktreeSnapshotSchema,
            execution: 'entity'
        },
        readTerminal: {
            kind: 'query',
            payload: MissionLocatorSchema,
            result: MissionTerminalSnapshotSchema,
            execution: 'entity'
        },
        command: {
            kind: 'mutation',
            payload: MissionCommandInputSchema,
            result: MissionCommandAcknowledgementSchema,
            execution: 'entity'
        },
        writeDocument: {
            kind: 'mutation',
            payload: MissionWriteDocumentInputSchema,
            result: MissionDocumentSnapshotSchema,
            execution: 'entity'
        },
        ensureTerminal: {
            kind: 'mutation',
            payload: MissionLocatorSchema,
            result: MissionTerminalSnapshotSchema,
            execution: 'entity'
        },
        sendTerminalInput: {
            kind: 'mutation',
            payload: MissionSendTerminalInputSchema,
            result: MissionTerminalSnapshotSchema,
            execution: 'entity'
        }
    },
    events: {
        'snapshot.changed': {
            payload: MissionSnapshotChangedEventSchema
        },
        status: {
            payload: MissionStatusSnapshotSchema
        }
    }
};

export function createMissionRuntimeEventSubscriptionChannels(missionId: string): string[] {
    const normalizedMissionId = missionId.trim();
    if (!normalizedMissionId) {
        throw new Error('Mission runtime event subscriptions require a missionId.');
    }

    return [
        ...Object.keys(MissionContract.events ?? {}).map((eventName) =>
            createEntityChannel(createEntityId('mission', normalizedMissionId), eventName)
        ),
        ...createEntityContractChannelPatterns('stage', `${normalizedMissionId}/*`, StageContract),
        ...createEntityContractChannelPatterns('task', `${normalizedMissionId}/*`, TaskContract),
        ...createEntityContractChannelPatterns('artifact', `${normalizedMissionId}/*`, ArtifactContract),
        ...createEntityContractChannelPatterns('agent_session', `${normalizedMissionId}/*`, AgentSessionContract)
    ];
}

export function createAllRuntimeEventSubscriptionChannels(): string[] {
    return [
        ...createEntityContractChannelPatterns('mission', '*', MissionContract),
        ...createEntityContractChannelPatterns('stage', '*', StageContract),
        ...createEntityContractChannelPatterns('task', '*', TaskContract),
        ...createEntityContractChannelPatterns('artifact', '*', ArtifactContract),
        ...createEntityContractChannelPatterns('agent_session', '*', AgentSessionContract)
    ];
}

function createEntityContractChannelPatterns(table: string, uniqueId: string, contract: EntityContractType): string[] {
    return Object.keys(contract.events ?? {}).map((eventName) =>
        createEntityChannel(createEntityId(table, uniqueId), eventName)
    );
}
