import * as fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { compileDefineStatements, compileSchema } from '../../src/index.js';
import { surrealDealStoreModels } from './schema.js';

describe('surreal deal store example', () => {
    it('generates DDL matching the official mini-v3 schema excerpt', async () => {
        const generatedStatements = compileDefineStatements(compileSchema({ models: surrealDealStoreModels }));
        const officialStatements = await readOfficialSchemaStatements();

        expect(normalizeStatements(generatedStatements)).toEqual(normalizeStatements(officialStatements));
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

function normalizeStatements(statements: string[]): string[] {
    return statements
        .map((statement) => statement.replace(/\s+/gu, ' ').trim())
        .sort((left, right) => left.localeCompare(right));
}