import adapter from "@sveltejs/adapter-node";
import type { Config } from "@sveltejs/kit";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { mdsvex } from "mdsvex";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDocsSourcePreprocessor } from "./src/lib/docs/source-normalization.ts";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const docsRootDirectory = path.resolve(currentDirectory, "../../../docs");
const workspacePackageRoots = {
	"@flying-pillow/mission-core": path.resolve(currentDirectory, "../../../packages/core/src"),
	"@flying-pillow/mission": path.resolve(currentDirectory, "../../../packages/mission/src")
} as const;

const workspacePackageAliases = Object.fromEntries(
	Object.entries(workspacePackageRoots).flatMap(([packageName, packageRoot]) => [
		[packageName, packageRoot],
		[`${packageName}/*`, `${packageRoot}/*`]
	])
);

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
			"@flying-pillow/mission-core/browser": path.resolve(
				currentDirectory,
				"../../../packages/core/src/browser.ts",
			),
			...workspacePackageAliases,
		},
	},
};

export default config;
