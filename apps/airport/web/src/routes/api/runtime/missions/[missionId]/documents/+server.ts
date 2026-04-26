import * as fs from 'node:fs/promises';
import path from 'node:path';
import { error as kitError, json } from '@sveltejs/kit';
import { getMissionWorktreesPath } from '@flying-pillow/mission-core/node';
import { missionRuntimeRouteParamsSchema } from '@flying-pillow/mission-core/schemas';
import { z } from 'zod';
import { resolveSurfacePath } from '$lib/server/daemon/context.server';
import type { RequestHandler } from './$types';

const missionDocumentQuerySchema = z.object({
    path: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1).optional()
});

const missionDocumentWriteSchema = z.object({
    path: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1).optional(),
    content: z.string()
});

export const GET: RequestHandler = async ({ params, url }) => {
    missionRuntimeRouteParamsSchema.parse(params);
    const { path, repositoryRootPath } = missionDocumentQuerySchema.parse({
        path: url.searchParams.get('path'),
        repositoryRootPath: url.searchParams.get('repositoryRootPath')
    });

    await assertPathInsideSurfaceRoot(path, 'read', repositoryRootPath);

    return json(await readMissionDocument(path), {
        headers: {
            'cache-control': 'no-store'
        }
    });
};

export const POST: RequestHandler = async ({ params, request }) => {
    missionRuntimeRouteParamsSchema.parse(params);
    const body = missionDocumentWriteSchema.parse(await request.json());

    await assertPathInsideSurfaceRoot(body.path, 'write', body.repositoryRootPath);

    return json(await writeMissionDocument(body.path, body.content), {
        headers: {
            'cache-control': 'no-store'
        }
    });
};

async function readMissionDocument(filePath: string): Promise<{
    filePath: string;
    content: string;
    updatedAt?: string;
}> {
    const content = await fs.readFile(filePath, 'utf8');
    const stats = await fs.stat(filePath);
    return {
        filePath,
        content,
        updatedAt: stats.mtime.toISOString()
    };
}

async function writeMissionDocument(filePath: string, content: string): Promise<{
    filePath: string;
    content: string;
    updatedAt?: string;
}> {
    await fs.writeFile(filePath, content, 'utf8');
    const stats = await fs.stat(filePath);
    return {
        filePath,
        content,
        updatedAt: stats.mtime.toISOString()
    };
}

async function assertPathInsideSurfaceRoot(
    filePath: string,
    intent: 'read' | 'write',
    repositoryRootPath?: string
): Promise<void> {
    const normalizedPath = filePath.trim();
    if (!normalizedPath) {
        throw kitError(400, 'Document path must not be empty.');
    }

    const allowedRoots = await resolveAllowedRoots(repositoryRootPath);
    const candidatePath = path.resolve(normalizedPath);
    const canonicalPath = await resolveCanonicalDocumentPath(candidatePath, intent);

    if (!allowedRoots.some((rootPath) => isPathInsideRoot(rootPath, canonicalPath))) {
        throw kitError(403, `Document '${normalizedPath}' is outside the active repository root.`);
    }
}

async function resolveAllowedRoots(
    repositoryRootPath?: string
): Promise<string[]> {
    const controlRoot = path.resolve(
        repositoryRootPath?.trim() || resolveSurfacePath(),
    );
    const worktreesRoot = path.resolve(getMissionWorktreesPath(controlRoot));

    const roots = await Promise.all([
        canonicalizeAllowedRoot(controlRoot),
        canonicalizeAllowedRoot(worktreesRoot),
    ]);

    return roots.filter((rootPath, index, allRoots): rootPath is string => {
        return Boolean(rootPath) && allRoots.indexOf(rootPath) === index;
    });
}

async function canonicalizeAllowedRoot(rootPath: string): Promise<string | undefined> {
    try {
        return await fs.realpath(rootPath);
    } catch (error) {
        if (isMissingFileError(error)) {
            return rootPath;
        }

        throw error;
    }
}

async function resolveCanonicalDocumentPath(
    candidatePath: string,
    intent: 'read' | 'write'
): Promise<string> {
    try {
        return await fs.realpath(candidatePath);
    } catch (error) {
        if (!isMissingFileError(error) || intent === 'read') {
            throw error;
        }

        const parentDirectory = await fs.realpath(path.dirname(candidatePath));
        return path.join(parentDirectory, path.basename(candidatePath));
    }
}

function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
    const relativePath = path.relative(rootPath, candidatePath);
    return relativePath === ''
        || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}