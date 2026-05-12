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
    MissionSendTerminalInputSchema,
    MissionTerminalSnapshotSchema
} from '../Terminal/MissionTerminalSchema.js';
import {
    missionEntityName,
    MissionStorageSchema,
    MissionFindSchema,
    MissionCatalogEntrySchema,
    MissionDocumentSchema,
    MissionWorktreeSchema,
    MissionSchema,
    MissionControlSchema,
    MissionReadDocumentInputSchema,
    MissionLocatorSchema,
    MissionWriteDocumentInputSchema,
    MissionCommandAcknowledgementSchema,
    MissionChangedEventSchema
} from './MissionSchema.js';

export const MissionContract: EntityContractType = {
    entity: missionEntityName,
    entityClass: Mission,
    properties: Object.fromEntries(
        Object.entries(MissionStorageSchema.shape).map(([name, schema]) => [
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
            result: MissionSchema,
            execution: 'entity'
        },
        readControl: {
            kind: 'query',
            payload: MissionLocatorSchema,
            result: MissionControlSchema,
            execution: 'entity'
        },
        readDocument: {
            kind: 'query',
            payload: MissionReadDocumentInputSchema,
            result: MissionDocumentSchema,
            execution: 'entity'
        },
        readWorktree: {
            kind: 'query',
            payload: MissionLocatorSchema,
            result: MissionWorktreeSchema,
            execution: 'entity'
        },
        readTerminal: {
            kind: 'query',
            payload: MissionLocatorSchema,
            result: MissionTerminalSnapshotSchema,
            execution: 'entity'
        },
        pause: {
            kind: 'mutation',
            payload: MissionLocatorSchema,
            result: MissionCommandAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Pause Mission',
                icon: 'pause',
                presentationOrder: 10
            }
        },
        resume: {
            kind: 'mutation',
            payload: MissionLocatorSchema,
            result: MissionCommandAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Resume Mission',
                icon: 'play',
                presentationOrder: 20
            }
        },
        restartQueue: {
            kind: 'mutation',
            payload: MissionLocatorSchema,
            result: MissionCommandAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Restart Launch Queue',
                icon: 'refresh-cw',
                confirmation: {
                    required: true,
                    prompt: 'Clear stale launch requests and retry queued tasks now?'
                },
                presentationOrder: 30
            }
        },
        deliver: {
            kind: 'mutation',
            payload: MissionLocatorSchema,
            result: MissionCommandAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Deliver Mission',
                icon: 'rocket',
                confirmation: {
                    required: true,
                    prompt: 'Deliver this mission now?'
                },
                presentationOrder: 40
            }
        },
        writeDocument: {
            kind: 'mutation',
            payload: MissionWriteDocumentInputSchema,
            result: MissionDocumentSchema,
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
        changed: {
            payload: MissionChangedEventSchema
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
