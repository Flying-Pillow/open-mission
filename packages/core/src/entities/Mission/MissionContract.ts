import type { EntityContractType } from '../Entity/EntitySchema.js';
import { Mission } from './Mission.js';
import { AgentExecutionContract } from '../AgentExecution/AgentExecutionContract.js';
import { ArtifactContract } from '../Artifact/ArtifactContract.js';
import { createEntityChannel, createEntityId } from '../Entity/Entity.js';
import { createEntityEventEnvelope } from '../Entity/Entity.js';
import type { EntityEventEnvelopeType } from '../Entity/EntitySchema.js';
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
        },
        terminal: {
            payload: MissionTerminalSnapshotSchema
        }
    }
};

export function createMissionTerminalEvent(input: {
    workspaceRoot: string;
    missionId: string;
    state: unknown;
}): EntityEventEnvelopeType {
    const missionId = input.missionId.trim();
    const payload = MissionTerminalSnapshotSchema.parse({
        missionId,
        ...(typeof input.state === 'object' && input.state !== null ? input.state : {})
    });
    return createEntityEventEnvelope({
        entityId: createEntityId('mission', missionId),
        eventName: 'terminal',
        type: 'mission.terminal',
        missionId,
        payload
    });
}

export function createMissionRuntimeEventSubscriptionChannels(missionId: string): string[] {
    const normalizedMissionId = missionId.trim();
    if (!normalizedMissionId) {
        throw new Error('Mission runtime event subscriptions require a missionId.');
    }

    return [
        ...createEntityContractChannelPatterns('mission', normalizedMissionId, MissionContract),
        ...createEntityContractChannelPatterns('stage', `${normalizedMissionId}/*`, StageContract),
        ...createEntityContractChannelPatterns('task', `${normalizedMissionId}/*`, TaskContract),
        ...createEntityContractChannelPatterns('artifact', `${normalizedMissionId}/*`, ArtifactContract),
        ...createEntityContractChannelPatterns('agent_execution', `${normalizedMissionId}/*`, AgentExecutionContract)
    ];
}

export function createAllRuntimeEventSubscriptionChannels(): string[] {
    return [
        ...createEntityContractChannelPatterns('mission', '*', MissionContract),
        ...createEntityContractChannelPatterns('stage', '*', StageContract),
        ...createEntityContractChannelPatterns('task', '*', TaskContract),
        ...createEntityContractChannelPatterns('artifact', '*', ArtifactContract),
        ...createEntityContractChannelPatterns('agent_execution', '*', AgentExecutionContract)
    ];
}

function createEntityContractChannelPatterns(table: string, uniqueId: string, contract: EntityContractType): string[] {
    return Object.keys(contract.events ?? {}).filter((eventName) => eventName !== 'terminal').map((eventName) =>
        createEntityChannel(createEntityId(table, uniqueId), eventName)
    );
}
