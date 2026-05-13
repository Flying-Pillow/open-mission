import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

const directoryListingRequestSchema = z.object({
    path: z.string().trim().min(1).optional()
}).strict();

export const GET: RequestHandler = async ({ url }) => {
    const input = directoryListingRequestSchema.parse({
        path: url.searchParams.get('path') ?? undefined
    });
    const currentPath = path.resolve(input.path ?? path.sep);
    const stats = await fs.stat(currentPath).catch(() => undefined);
    if (!stats?.isDirectory()) {
        return json({
            error: `Directory '${currentPath}' does not exist or is not accessible.`
        }, { status: 400 });
    }

    const entries = (await fs.readdir(currentPath, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
            name: entry.name,
            path: path.join(currentPath, entry.name)
        }))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }));

    const parentPath = path.dirname(currentPath);
    return json({
        currentPath,
        parentPath: parentPath !== currentPath ? parentPath : null,
        entries
    });
};