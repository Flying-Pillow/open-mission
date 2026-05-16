import { describe, expect, it } from 'vitest';
import { table as surrealTable } from '@flying-pillow/zod-surreal';
import { z } from 'zod/v4';
import {
    createEntityChannel,
    createEntityId,
    createEntityAvailabilityMethodName,
    createEntityMethodCommandId,
    Entity,
    getEntityTable,
    matchesEntityChannel
} from './Entity.js';
import { Factory } from '../../lib/factory.js';
import type {
    EntityFindResult,
    EntityFindSelection,
    FactoryStore
} from '../../lib/factory.js';
import type {
    EntityCommandAcknowledgementType,
    EntityContractType,
    FindResultType,
    SelectType
} from './EntitySchema.js';

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

class ExampleRemoteEntity extends Entity<{ id: string; archived: boolean }, string> {
    public static override readonly entityName = 'Example';
    public static lastResolvePayload: unknown;

    public constructor(data: { id: string; archived: boolean }) {
        super(data);
    }

    public get id(): string {
        return this.data.id;
    }

    public static async resolve(payload: unknown): Promise<ExampleRemoteEntity> {
        ExampleRemoteEntity.lastResolvePayload = payload;
        const input = z.object({ id: z.string().trim().min(1) }).strict().parse(payload);
        return new ExampleRemoteEntity({ id: input.id, archived: false });
    }

    public async archive(payload: unknown): Promise<{ ok: true; entity: string; method: string; id: string; reason: string }> {
        const input = z.object({ reason: z.string().trim().min(1) }).strict().parse(payload);
        return {
            ok: true,
            entity: 'Example',
            method: 'archive',
            id: this.id,
            reason: input.reason
        };
    }
}

class ExampleClassEntity extends Entity<{ id: string }, string> {
    public static override readonly entityName = 'ExampleClass';

    public constructor(data: { id: string }) {
        super(data);
    }

    public get id(): string {
        return this.data.id;
    }

    public static async list(payload: unknown): Promise<{ ok: true; mode: 'class'; filter?: string }> {
        const input = z.object({ filter: z.string().trim().min(1).optional() }).strict().parse(payload);
        return {
            ok: true,
            mode: 'class',
            ...(input.filter ? { filter: input.filter } : {})
        };
    }
}

class ExampleStoredEntity extends Entity<{ id: string; label: string }, string> {
    public static override readonly entityName = 'ExampleStored';
    public static readonly storageSchema = z.object({
        id: z.string().trim().min(1),
        label: z.string().trim().min(1)
    }).strict().register(surrealTable, {
        table: 'example_stored'
    });

    public constructor(data: { id: string; label: string }) {
        super(data);
    }

    public get id(): string {
        return this.data.id;
    }

    public static async read(payload: unknown, context?: { entityFactory?: Factory; surfacePath: string }) {
        const input = z.object({ id: z.string().trim().min(1) }).strict().parse(payload);
        const entity = await this._read(context, input.id);
        if (!entity) {
            throw new Error(`ExampleStored '${input.id}' could not be resolved.`);
        }
        return entity.toData();
    }

    public static async find(
        payload: unknown,
        context?: { entityFactory?: Factory; surfacePath: string }
    ): Promise<FindResultType<ExampleStoredEntity>> {
        return await this._find(context, z.object({
            where: z.object({
                field: z.string().trim().min(1),
                value: z.unknown(),
                operator: z.string().trim().min(1).optional()
            }).strict().optional()
        }).strict().parse(payload));
    }

    public async rename(label: string, context?: { entityFactory?: Factory; surfacePath: string }) {
        this.updateFromData({ ...this.toData(), label });
        return await this.save(context);
    }
}

class InMemoryDatabaseDriver implements FactoryStore {
    private readonly records = new Map<string, Map<string, { id: string; label: string }>>();
    public lastFindSelection: EntityFindSelection | undefined;

    public seed(table: string, record: { id: string; label: string }): void {
        const tableRecords = this.records.get(table) ?? new Map<string, { id: string; label: string }>();
        tableRecords.set(record.id, structuredClone(record));
        this.records.set(table, tableRecords);
    }

    public async create(table: string, record: { id: string; label: string }): Promise<{ id: string; label: string }> {
        this.seed(table, record);
        return structuredClone(record);
    }

    public async save(table: string, record: { id: string; label: string }): Promise<{ id: string; label: string }> {
        this.seed(table, record);
        return structuredClone(record);
    }

    public async relate(table: string, record: { id: string; label: string }): Promise<{ id: string; label: string }> {
        this.seed(table, record);
        return structuredClone(record);
    }

    public async read(table: string, id: string): Promise<{ id: string; label: string } | undefined> {
        return structuredClone(this.records.get(table)?.get(id));
    }

    public async find(
        table: string,
        _storageSchema: z.ZodType<{ id: string; label: string }>,
        select?: EntityFindSelection
    ): Promise<EntityFindResult<{ id: string; label: string }>> {
        this.lastFindSelection = select;
        const entities = [...(this.records.get(table)?.values() ?? [])].map((record) => structuredClone(record));
        return {
            count: entities.length,
            start: 0,
            total: entities.length,
            entities
        };
    }

    public async remove(table: string, id: string): Promise<void> {
        this.records.get(table)?.delete(id);
    }
}

const exampleRemoteContract: EntityContractType = {
    entity: 'Example',
    entityClass: ExampleRemoteEntity,
    methods: {
        archive: {
            kind: 'mutation',
            payload: z.object({ reason: z.string().trim().min(1) }).strict(),
            result: z.object({
                ok: z.literal(true),
                entity: z.literal('Example'),
                method: z.literal('archive'),
                id: z.string().trim().min(1),
                reason: z.string().trim().min(1)
            }).strict(),
            execution: 'entity'
        }
    }
};

const exampleClassContract: EntityContractType = {
    entity: 'ExampleClass',
    entityClass: ExampleClassEntity,
    methods: {
        list: {
            kind: 'query',
            payload: z.object({ filter: z.string().trim().min(1).optional() }).strict(),
            result: z.object({
                ok: z.literal(true),
                mode: z.literal('class'),
                filter: z.string().trim().min(1).optional()
            }).strict(),
            execution: 'class'
        }
    }
};

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

describe('Entity remote invocation', () => {
    it('resolves entity instance methods from id instead of payload identity', async () => {
        ExampleRemoteEntity.lastResolvePayload = undefined;

        const result = await Entity.executeCommand(exampleRemoteContract, {
            entity: 'Example',
            method: 'archive',
            id: 'example:remote-1',
            payload: { reason: 'Operator request.' }
        }, {
            surfacePath: '/tmp/open-mission'
        });

        expect(ExampleRemoteEntity.lastResolvePayload).toEqual({ id: 'example:remote-1' });
        expect(result).toEqual({
            ok: true,
            entity: 'Example',
            method: 'archive',
            id: 'example:remote-1',
            reason: 'Operator request.'
        });
    });

    it('rejects entity methods that omit top-level id', async () => {
        await expect(Entity.executeCommand(exampleRemoteContract, {
            entity: 'Example',
            method: 'archive',
            payload: { reason: 'Operator request.' }
        }, {
            surfacePath: '/tmp/open-mission'
        })).rejects.toThrow("Entity method 'Example.archive' requires top-level id.");
    });

    it('rejects class methods that provide top-level id', async () => {
        await expect(Entity.executeQuery(exampleClassContract, {
            entity: 'ExampleClass',
            method: 'list',
            id: 'example_class:remote-1',
            payload: {}
        }, {
            surfacePath: '/tmp/open-mission'
        })).rejects.toThrow("Class method 'ExampleClass.list' must not receive top-level id.");
    });
});

describe('Entity storage-backed helpers', () => {
    it('routes _read, _find, save, and remove through the Entity factory', async () => {
        const driver = new InMemoryDatabaseDriver();
        const factory = new Factory(driver);
        driver.seed('example_stored', { id: 'example_stored:1', label: 'First' });
        const context = {
            surfacePath: '/tmp/open-mission',
            entityFactory: factory
        };

        expect(await ExampleStoredEntity.read({ id: 'example_stored:1' }, context)).toEqual({
            id: 'example_stored:1',
            label: 'First'
        });

        const findResult = await ExampleStoredEntity.find({
            where: {
                field: 'label',
                operator: '=',
                value: 'First'
            }
        } satisfies SelectType, context);

        expect(driver.lastFindSelection).toEqual({
            where: {
                field: 'label',
                operator: '=',
                value: 'First'
            }
        });
        expect(findResult.total).toBe(1);
        expect(findResult.entities[0]?.toData()).toEqual({
            id: 'example_stored:1',
            label: 'First'
        });

        const entity = await factory.read(ExampleStoredEntity, 'example_stored:1');
        await entity!.rename('Renamed', context);
        expect((await factory.read(ExampleStoredEntity, 'example_stored:1'))?.toData()).toEqual({
            id: 'example_stored:1',
            label: 'Renamed'
        });

        await expect(entity!.remove({}, context)).resolves.toEqual<EntityCommandAcknowledgementType>({
            ok: true,
            entity: 'ExampleStored',
            method: 'remove',
            id: 'example_stored:1'
        });
        await expect(factory.read(ExampleStoredEntity, 'example_stored:1')).resolves.toBeUndefined();
    });
});
