import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		passWithNoTests: true,
		projects: [
			{
				extends: true,
				test: {
					name: 'core',
					root: './packages/core',
					environment: 'node',
					include: ['src/**/*.{test,spec}.ts']
				}
			},
			{
				extends: true,
				test: {
					name: 'adapters',
					root: './packages/adapters',
					environment: 'node',
					include: ['src/**/*.{test,spec}.ts']
				}
			}
		]
	}
});