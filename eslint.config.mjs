import globals from 'globals';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import eslintConfigPrettier from 'eslint-config-prettier';

const svelteConfig = {
  compilerOptions: {
    runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
    experimental: {
      async: true,
    },
  },
  extensions: ['.svelte', '.md'],
};

export default tseslint.config(
  {
    ignores: ['node_modules/**', '.turbo/**', 'build/**', 'dist/**', 'out/**', 'coverage/**', 'deprecated/**'],
  },
  ...svelte.configs.recommended,
  {
    files: ['apps/web/src/**/*.svelte'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: tseslint.parser,
        svelteConfig,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'svelte/no-navigation-without-resolve': 'off',
      'svelte/no-at-html-tags': 'off',
    },
  },
  eslintConfigPrettier
);
