import { SurrealDatabase } from './SurrealDatabase.js';

export const TEST_SURREAL_NAMESPACE = 'test' as const;
export const TEST_SURREAL_DATABASE = 'test' as const;

export function createTestSurrealDatabase(input: {
    shared?: boolean;
    provisionOnStart?: boolean;
    schemaDirectory?: string;
} = {}): SurrealDatabase {
    const options = {
        namespace: TEST_SURREAL_NAMESPACE,
        database: TEST_SURREAL_DATABASE,
        ...(input.provisionOnStart !== undefined ? { provisionOnStart: input.provisionOnStart } : {}),
        ...(input.schemaDirectory ? { schemaDirectory: input.schemaDirectory } : {})
    };

    return input.shared
        ? SurrealDatabase.sharedForExternal(options)
        : SurrealDatabase.forExternal(options);
}

export async function clearSurrealTables(database: SurrealDatabase, tables: string[]): Promise<void> {
    const uniqueTables = Array.from(new Set(tables.map((table) => table.trim()).filter(Boolean)));
    if (uniqueTables.length === 0) {
        return;
    }

    await database.start();
    await database.query(uniqueTables.map((table) => `DELETE ${table};`).join('\n'));
}