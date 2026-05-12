import * as fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
    generatedSchemaUrl,
    generateSurrealDealStoreSchemaSurql
} from './generate-schema.js';

describe('surreal deal store example', () => {
    it('generates DDL matching the official mini-v3 schema excerpt', async () => {
        const generatedSurql = generateSurrealDealStoreSchemaSurql();
        const persistedGeneratedSurql = await fs.readFile(generatedSchemaUrl, 'utf8');
        const officialStatements = await readOfficialSchemaStatements();

        expect(persistedGeneratedSurql).toBe(generatedSurql);
        expect(normalizeStatements(splitDefineStatements(generatedSurql))).toEqual(normalizeStatements(officialStatements));
    });
});

async function readOfficialSchemaStatements(): Promise<string[]> {
    const fixture = await fs.readFile(new URL('./official-schema.surql', import.meta.url), 'utf8');
    return fixture
        .split(';')
        .map((statement) => statement.trim())
        .filter((statement) => statement.startsWith('DEFINE '))
        .map((statement) => `${statement};`);
}

function splitDefineStatements(surql: string): string[] {
    return surql
        .split(';')
        .map((statement) => statement.trim())
        .filter((statement) => statement.startsWith('DEFINE '))
        .map((statement) => `${statement};`);
}

function normalizeStatements(statements: string[]): string[] {
    return statements
        .map((statement) => statement.replace(/\s+/gu, ' ').trim())
        .sort((left, right) => left.localeCompare(right));
}