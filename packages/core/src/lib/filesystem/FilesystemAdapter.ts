import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

export class FilesystemAdapter {
    public async readTextFile(filePath: string): Promise<string | undefined> {
        try {
            return await fs.readFile(filePath, 'utf8');
        } catch (error) {
            if (this.isMissingFileError(error)) {
                return undefined;
            }
            throw error;
        }
    }

    public async writeTextFileAtomic(filePath: string, content: string): Promise<void> {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const temporaryPath = `${filePath}.${process.pid.toString(36)}.${randomUUID()}.tmp`;
        await fs.writeFile(temporaryPath, content, 'utf8');
        await fs.rename(temporaryPath, filePath);
    }

    protected isMissingFileError(error: unknown): boolean {
        return error instanceof Error && 'code' in error && error.code === 'ENOENT';
    }
}