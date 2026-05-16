import { describe, expect, it } from 'vitest';
import { SurrealDatabase } from './SurrealDatabase.js';

describe('SurrealDatabase', () => {
    it('opens the external SurrealDB database', async () => {
        const database = SurrealDatabase.forExternal();

        await database.start();
        try {
            expect(database.readStatus()).toMatchObject({
                available: true,
                engine: 'remote',
                namespace: 'flying_pillow',
                database: 'open_mission'
            });
            await expect(database.query('RETURN $value;', { value: 'ready' })).resolves.toEqual(['ready']);
        } finally {
            await database.stop();
        }
    });
});