import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import fs from "node:fs";
import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDocsRoot = path.resolve(currentDirectory, "../../docs");
const workspaceRoot = path.resolve(currentDirectory, "../..");
const useSourcePackages = process.env.NODE_ENV !== "production";
const missionCoreSourceRoot = path.resolve(workspaceRoot, "packages/core/src");
const terminalWebSocketServerModule = "./src/lib/server/terminal-websocket.server.ts";
const terminalWebSocketSsrModule = "/src/lib/server/terminal-websocket.server.ts";

type ViteHttpServer = HttpServer | HttpsServer;

async function attachMissionTerminalWebSockets(
	server: ViteHttpServer,
	loadModule: () => Promise<TerminalWebSocketModule>,
): Promise<void> {
	const { attachTerminalWebSocketServer } = await loadModule();
	attachTerminalWebSocketServer(server);
}

type TerminalWebSocketModule = {
	attachTerminalWebSocketServer(server: ViteHttpServer): void;
};

function missionTerminalWebSocketPlugin() {
	return {
		name: "mission-terminal-websocket",
		configureServer(server: { httpServer?: ViteHttpServer | null; ssrLoadModule(url: string): Promise<unknown> }) {
			if (server.httpServer) {
				void attachMissionTerminalWebSockets(
					server.httpServer,
					() => server.ssrLoadModule(terminalWebSocketSsrModule) as Promise<TerminalWebSocketModule>
				);
			}
		},
		configurePreviewServer(server: { httpServer?: ViteHttpServer | null }) {
			if (server.httpServer) {
				void attachMissionTerminalWebSockets(
					server.httpServer,
					() => import(terminalWebSocketServerModule)
				);
			}
		}
	};
}

function missionCoreSourceResolvePlugin() {
	return {
		name: "mission-core-source-resolve",
		enforce: "pre",
		resolveId(source: string, importer?: string) {
			if (!useSourcePackages) {
				return null;
			}

			if (importer?.startsWith(missionCoreSourceRoot) && source.startsWith(".") && source.endsWith(".js")) {
				const sourcePath = path.resolve(path.dirname(importer), source);
				const typescriptSourcePath = sourcePath.replace(/\.js$/u, ".ts");
				if (typescriptSourcePath.startsWith(missionCoreSourceRoot) && fs.existsSync(typescriptSourcePath)) {
					return typescriptSourcePath;
				}
			}

			if (source === "@flying-pillow/open-mission-core") {
				return path.join(missionCoreSourceRoot, "index.ts");
			}

			const missionCoreSubpath = source.match(/^@flying-pillow\/open-mission-core\/(.+)$/);
			if (!missionCoreSubpath) {
				return null;
			}

			return path.join(missionCoreSourceRoot, `${missionCoreSubpath[1]}.ts`);
		}
	};
}

export default defineConfig({
	cacheDir: "/tmp/open-mission-web-vite-cache",
	plugins: [
		...tailwindcss(),
		missionCoreSourceResolvePlugin(),
		sveltekit(),
		missionTerminalWebSocketPlugin()
	],
	ssr: {
		external: [
			"node-pty"
		],
		noExternal: [
			"@flying-pillow/open-mission-core",
			"@flying-pillow/open-mission"
		]
	},
	resolve: {
		alias: useSourcePackages
			? [
				{
					find: /^@flying-pillow\/open-mission-core$/,
					replacement: path.join(missionCoreSourceRoot, "index.ts")
				},
				{
					find: /^@flying-pillow\/open-mission-core\/(.+)$/,
					replacement: `${missionCoreSourceRoot}/$1.ts`
				}
			]
			: []
	},
	server: {
		fs: {
			allow: [workspaceRoot, repositoryDocsRoot]
		}
	}
});
