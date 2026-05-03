import { FilesystemAdapter } from '../filesystem/FilesystemAdapter.js';

export class JsonFileAdapter {
    public constructor(private readonly filesystem = new FilesystemAdapter()) { }

    public async readObject(filePath: string): Promise<Record<string, unknown> | undefined> {
        const content = await this.filesystem.readTextFile(filePath);
        if (content === undefined) {
            return undefined;
        }

        const parsed = JSON.parse(content) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`JSON file '${filePath}' must contain an object.`);
        }
        return parsed as Record<string, unknown>;
    }

    public async writeObject(filePath: string, value: Record<string, unknown>): Promise<void> {
        await this.filesystem.writeTextFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
    }
}