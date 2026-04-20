import adapter from "@sveltejs/adapter-node";
import type { Config } from "@sveltejs/kit";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { mdsvex } from "mdsvex";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDocsSourcePreprocessor } from "./src/lib/docs/source-normalization.ts";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const docsRootDirectory = path.resolve(currentDirectory, "../../../docs");

const config: Config = {
	compilerOptions: {
		experimental: {
			async: true,
		},
	},
	extensions: [".svelte", ".md"],
	preprocess: [
		createDocsSourcePreprocessor({ docsRootDirectory }),
		vitePreprocess(),
		mdsvex({ extensions: [".md"] }),
	],
	kit: {
		adapter: adapter(),
		experimental: {
			remoteFunctions: true,
		},
		alias: {
			$lib: path.resolve(currentDirectory, "src/lib"),
			$docs: docsRootDirectory,
		},
	},
};

export default config;
