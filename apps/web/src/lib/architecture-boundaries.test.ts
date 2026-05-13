import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceExtensions = new Set(['.ts', '.svelte']);
const broadMissionCoreEntrypointPattern = /@flying-pillow\/open-mission-core(?:\/node|\/browser|\/daemon)?['"]/;
const forbiddenWebPatterns = [
    /api\.control\b/,
    /api\.mission\b/,
    /mission\.terminal\./,
    /session\.terminal\./,
    /getRepositoryDataBundle\b/,
    /app-home/,
    /entities\/Entity\/EntityRemote(?:\.js)?/,
    /EntityContract\.js/,
    /entities\/[A-Za-z]+\/[A-Za-z]+Contract\.js/
];

const serverOnlyPathPatterns = [
    /\.server\.ts$/,
    /\/server\//,
    /\/routes\/api\//,
    /\+server\.ts$/,
    /\+page\.server\.ts$/,
    /\+layout\.server\.ts$/,
    /\.test\.ts$/
];

describe('Open Mission web architecture boundaries', () => {
    it('uses explicit mission-core owner modules instead of broad entrypoints', () => {
        const offenders = listSourceFiles(srcRoot)
            .filter((filePath) => !filePath.endsWith('.test.ts'))
            .filter((filePath) => broadMissionCoreEntrypointPattern.test(fs.readFileSync(filePath, 'utf8')))
            .map(toRelativeSourcePath);

        expect(offenders).toEqual([]);
    });

    it('does not use legacy control or contract surfaces', () => {
        const offenders = listSourceFiles(srcRoot)
            .filter((filePath) => !filePath.endsWith('.test.ts'))
            .filter((filePath) => !isServerOnlyPath(filePath))
            .flatMap((filePath) => {
                const source = fs.readFileSync(filePath, 'utf8');
                return forbiddenWebPatterns.some((pattern) => pattern.test(source))
                    ? [toRelativeSourcePath(filePath)]
                    : [];
            });

        expect(offenders).toEqual([]);
    });
});

function listSourceFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return listSourceFiles(entryPath);
        }

        return sourceExtensions.has(path.extname(entry.name)) ? [entryPath] : [];
    });
}

function isServerOnlyPath(filePath: string): boolean {
    const normalizedPath = toRelativeSourcePath(filePath);
    return serverOnlyPathPatterns.some((pattern) => pattern.test(normalizedPath));
}

function toRelativeSourcePath(filePath: string): string {
    return path.relative(srcRoot, filePath).split(path.sep).join('/');
}
