import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import { attachTerminalWebSocketServer } from "./src/lib/server/terminal-websocket.server";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDocsRoot = path.resolve(currentDirectory, "../../../docs");

const workspacePackageRoots = {
	"@flying-pillow/mission-core": path.resolve(currentDirectory, "../../../packages/core/src"),
	"@flying-pillow/mission": path.resolve(currentDirectory, "../../../packages/mission/src")
} as const;

type ViteHttpServer = HttpServer | HttpsServer;

function missionTerminalWebSocketPlugin() {
	return {
		name: "mission-terminal-websocket",
		configureServer(server: { httpServer?: ViteHttpServer | null }) {
			if (server.httpServer) {
				attachTerminalWebSocketServer(server.httpServer);
			}
		},
		configurePreviewServer(server: { httpServer?: ViteHttpServer | null }) {
			if (server.httpServer) {
				attachTerminalWebSocketServer(server.httpServer);
			}
		}
	};
}

export default defineConfig({
	cacheDir: "/tmp/mission-airport-vite-cache",
	plugins: [
		tailwindcss(),
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
			allow: [".", repositoryDocsRoot, ...Object.values(workspacePackageRoots)]
		}
	}
});
