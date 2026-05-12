import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileDefineStatements, compileSchema } from '../../src/index.js';
import { surrealDealStoreModels } from './schema.js';

export const generatedSchemaUrl = new URL('./generated-schema.surql', import.meta.url);

export function generateSurrealDealStoreSchemaStatements(): string[] {
    return compileDefineStatements(compileSchema({ models: surrealDealStoreModels }));
}

export function generateSurrealDealStoreSchemaSurql(): string {
    return `${generateSurrealDealStoreSchemaStatements().join('\n')}\n`;
}

export async function writeSurrealDealStoreGeneratedSchema(outputUrl: URL = generatedSchemaUrl): Promise<void> {
    await fs.mkdir(path.dirname(fileURLToPath(outputUrl)), { recursive: true });
    await fs.writeFile(outputUrl, generateSurrealDealStoreSchemaSurql(), 'utf8');
}

function isMainModule(): boolean {
    return process.argv[1] ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) : false;
}

if (isMainModule()) {
    await writeSurrealDealStoreGeneratedSchema();
    process.stdout.write(`Wrote ${path.relative(process.cwd(), fileURLToPath(generatedSchemaUrl))}\n`);
}