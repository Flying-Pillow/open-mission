import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
	{
		ignores: [
			'node_modules/**',
			'.turbo/**',
			'build/**',
			'dist/**',
			'out/**',
			'coverage/**',
			'apps/vscode-extension/media/webview/**'
		]
	},
	js.configs.recommended,
	...tseslint.configs.strictTypeChecked,
	...svelte.configs.recommended,
	{
		files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname
			},
			globals: {
				...globals.node
			}
		},
		rules: {
			'@typescript-eslint/consistent-type-imports': 'error',
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/no-misused-promises': 'error',
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/require-await': 'error'
		}
	},
	{
		files: ['apps/vscode-extension/src/webview/**/*.{ts,svelte}'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				tsconfigRootDir: import.meta.dirname
			},
			globals: {
				...globals.browser,
				...globals.node
			}
		}
	},
	{
		files: ['apps/vscode-extension/src/**/*.ts'],
		ignores: ['apps/vscode-extension/src/webview/**/*'],
		languageOptions: {
			parserOptions: {,
				tsconfigRootDir: import.meta.dirname
				projectService: true
			},
			globals: {
				...globals.node
			}
		}
	},
	{
		files: ['**/*.mjs'],
		...tseslint.configs.disableTypeChecked
	},
	{
		files: ['apps/vscode-extension/src/webview/**/*.svelte'],
		rules: {
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off'
		}
	},
	eslintConfigPrettier
);