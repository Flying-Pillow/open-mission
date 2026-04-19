import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

const workspacePackageRoots = {
	"@flying-pillow/mission-core": path.resolve(currentDirectory, "../../../packages/core/src"),
	"@flying-pillow/mission": path.resolve(currentDirectory, "../../../packages/mission/src")
} as const;

export default defineConfig(({ command }) => {
	const isDevServer = command === "serve";

	return {
		cacheDir: "/tmp/mission-airport-vite-cache",
		plugins: [tailwindcss(), sveltekit()],
		ssr: isDevServer
			? {
				noExternal: [
					"@flying-pillow/mission-core",
					"@flying-pillow/mission"
				]
			}
			: undefined,
		server: isDevServer
			? {
				fs: {
					allow: [".", ...Object.values(workspacePackageRoots)]
				}
			}
			: undefined,
	};
});
