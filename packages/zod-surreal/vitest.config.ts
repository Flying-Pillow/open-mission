import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'zod-surreal',
        environment: 'node',
        include: ['./src/**/*.{test,spec}.ts', './examples/**/*.{test,spec}.ts']
    }
});