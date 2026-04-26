import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDocsRoot = path.resolve(currentDirectory, "../../../docs");
const workspacePackageRoots = [
	path.resolve(currentDirectory, "../../../packages/core/src"),
	path.resolve(currentDirectory, "../../../packages/mission/src")
];

type ViteHttpServer = HttpServer | HttpsServer;

const enableMissionTerminalWebSockets =
	process.env.MISSION_AIRPORT_ENABLE_TERMINAL_WS === "true";

async function attachMissionTerminalWebSockets(
	server: ViteHttpServer,
): Promise<void> {
	const { attachTerminalWebSocketServer } = await import(
		"./src/lib/server/terminal-websocket.server"
	);
	attachTerminalWebSocketServer(server);
}

function missionTerminalWebSocketPlugin() {
	return {
		name: "mission-terminal-websocket",
		configureServer(server: { httpServer?: ViteHttpServer | null }) {
			if (enableMissionTerminalWebSockets && server.httpServer) {
				void attachMissionTerminalWebSockets(server.httpServer);
			}
		},
		configurePreviewServer(server: { httpServer?: ViteHttpServer | null }) {
			if (enableMissionTerminalWebSockets && server.httpServer) {
				void attachMissionTerminalWebSockets(server.httpServer);
			}
		}
	};
}

export default defineConfig({
	cacheDir: "/tmp/mission-airport-vite-cache",
	plugins: [
		...tailwindcss(),
		sveltekit(),
		missionTerminalWebSocketPlugin()
	],
	ssr: {
		noExternal: [
			"@flying-pillow/mission-core",
			"@flying-pillow/mission"
		]
	},
	server: {
		fs: {
			allow: [".", repositoryDocsRoot, ...workspacePackageRoots]
		}
	}
});
