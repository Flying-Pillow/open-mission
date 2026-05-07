import * as path from 'node:path';
import { getMissionDaemonDirectory } from '../../settings/MissionInstall.js';
import { JsonFileAdapter } from '../../lib/formats/JsonFileAdapter.js';
import { EntityTableSchema, type EntityStore } from './EntitySchema.js';

export class FilesystemEntityStore implements EntityStore {
    public constructor(
        private readonly rootPath = path.join(getMissionDaemonDirectory(), 'entities'),
        private readonly jsonFiles = new JsonFileAdapter()
    ) { }

    public async read(table: string, id: string): Promise<unknown | undefined> {
        return (await this.readTable(table))[id];
    }

    public async list(table: string): Promise<unknown[]> {
        return Object.values(await this.readTable(table));
    }

    public async write(table: string, id: string, record: unknown): Promise<void> {
        const records = await this.readTable(table);
        records[id] = record;
        await this.writeTable(table, records);
    }

    public async delete(table: string, id: string): Promise<void> {
        const records = await this.readTable(table);
        if (!(id in records)) {
            return;
        }
        delete records[id];
        await this.writeTable(table, records);
    }

    private async readTable(table: string): Promise<Record<string, unknown>> {
        return await this.jsonFiles.readObject(this.getTablePath(table)) ?? {};
    }

    private async writeTable(table: string, records: Record<string, unknown>): Promise<void> {
        await this.jsonFiles.writeObject(this.getTablePath(table), records);
    }

    private getTablePath(table: string): string {
        return path.join(this.rootPath, `${EntityTableSchema.parse(table)}.json`);
    }
}