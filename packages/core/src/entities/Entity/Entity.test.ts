import { describe, expect, it } from 'vitest';
import {
    createEntityChannel,
    createEntityId,
    createEntityAvailabilityMethodName,
    createEntityMethodCommandId,
    Entity,
    getEntityTable,
    matchesEntityChannel
} from './Entity.js';

type ExampleData = {
    exampleId: string;
    label: string;
};

type ExampleUi = {
    mode: 'compact' | 'expanded';
};

class ExampleEntity extends Entity<ExampleData, string, ExampleUi> {
    public static override readonly entityName = 'Example';

    public constructor(data: ExampleData) {
        super(data);
    }

    public get id(): string {
        return this.toData().exampleId;
    }

    public setUi(state: ExampleUi | undefined): void {
        this.ui = state;
    }

    public getUi(): ExampleUi | undefined {
        return this.ui;
    }

    public getData(): ExampleData {
        return this.data;
    }

    public canArchive() {
        return this.unavailable('Already archived.');
    }
}

describe('Entity base class', () => {
    it('owns full entity data and optional ui without exposing mutable internals', () => {
        const entity = new ExampleEntity({ exampleId: 'example-1', label: 'Initial' });
        const data = entity.toData();

        data.label = 'Mutated outside';

        expect(entity.id).toBe('example-1');
        expect(entity.toData()).toEqual({ exampleId: 'example-1', label: 'Initial' });

        entity.updateFromData({ exampleId: 'example-1', label: 'Updated' });
        entity.setUi({ mode: 'expanded' });

        const ui = entity.getUi();
        expect(entity.toData()).toEqual({ exampleId: 'example-1', label: 'Updated' });
        expect(ui).toEqual({ mode: 'expanded' });

        ui!.mode = 'compact';

        expect(entity.toData()).toEqual({ exampleId: 'example-1', label: 'Updated' });
        expect(entity.getUi()).toEqual({ mode: 'expanded' });
    });

    it('derives method command ids and can-prefixed availability method names', () => {
        const entity = new ExampleEntity({ exampleId: 'example-1', label: 'Initial' });

        expect(entity.entityName).toBe('Example');
        expect(entity.commandIdFor('archive')).toBe('example.archive');
        expect(entity.availabilityMethodNameFor('archive')).toBe('canArchive');
        expect(createEntityMethodCommandId('Repository', 'startMissionFromIssue')).toBe('repository.startMissionFromIssue');
        expect(createEntityAvailabilityMethodName('startMissionFromIssue')).toBe('canStartMissionFromIssue');
        expect(entity.canArchive()).toEqual({ available: false, reason: 'Already archived.' });
    });
});

describe('Entity event identity', () => {
    it('creates canonical table ids and event channels', () => {
        const entityId = createEntityId('task', 'mission-29/stage/task-1');

        expect(entityId).toBe('task:mission-29/stage/task-1');
        expect(getEntityTable(entityId)).toBe('task');
        expect(createEntityChannel(entityId, 'data.changed')).toBe('task:mission-29/stage/task-1.data.changed');
    });

    it('matches exact and wildcard channel subscriptions', () => {
        const channel = createEntityChannel(createEntityId('task', 'mission-29/stage/task-1'), 'data.changed');

        expect(matchesEntityChannel(channel, 'task:mission-29/*.*')).toBe(true);
        expect(matchesEntityChannel(channel, 'task:mission-30/*.*')).toBe(false);
        expect(matchesEntityChannel(channel, channel)).toBe(true);
    });
});
