import adapter from "@sveltejs/adapter-node";
import type { Config } from "@sveltejs/kit";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { mdsvex } from "mdsvex";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDocsSourcePreprocessor } from "./src/lib/docs/source-normalization.ts";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const docsRootDirectory = path.resolve(currentDirectory, "../../docs");
const workspaceRoot = path.resolve(currentDirectory, "../..");
const useSourcePackages = process.env.NODE_ENV !== "production";
const missionCoreSourceRoot = path.resolve(workspaceRoot, "packages/core/src");

const sourcePackageAliases: Record<string, string> = useSourcePackages
	? {
		"@flying-pillow/open-mission-core": path.join(missionCoreSourceRoot, "index.ts"),
		"@flying-pillow/open-mission-core/*": `${missionCoreSourceRoot}/*`,
	}
	: {};

const config: Config = {
	compilerOptions: {
		runes: ({ filename }) =>
			filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
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
			"$docs/*": `${docsRootDirectory}/*`,
			...sourcePackageAliases,
		},
	},
};

export default config;
