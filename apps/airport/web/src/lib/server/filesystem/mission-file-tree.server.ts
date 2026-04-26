import * as fs from "node:fs/promises";
import path from "node:path";
import { getMissionWorktreesPath } from "@flying-pillow/mission-core/node";
import { resolveSurfacePath } from "$lib/server/daemon/context.server";
import type {
	MissionFileTreeNode,
	MissionFileTreeResponse,
} from "$lib/types/mission-file-tree";

const IGNORED_ENTRY_NAMES = new Set([
	".git",
	"node_modules",
	".pnpm-store",
	".svelte-kit",
	".turbo",
	"dist",
	"build",
]);

export async function readMissionFileTree(input: {
	missionId: string;
	repositoryRootPath?: string;
}): Promise<MissionFileTreeResponse> {
	const missionId = input.missionId.trim();
	if (!missionId) {
		throw new Error("Mission file tree requires a missionId.");
	}

	const controlRoot = path.resolve(
		input.repositoryRootPath?.trim() || resolveSurfacePath(),
	);
	const worktreeRoot = path.join(getMissionWorktreesPath(controlRoot), missionId);
	const tree = await readDirectoryTree(worktreeRoot, worktreeRoot);

	return {
		rootPath: worktreeRoot,
		fetchedAt: new Date().toISOString(),
		tree,
	};
}

async function readDirectoryTree(
	directoryPath: string,
	rootPath: string,
): Promise<MissionFileTreeNode[]> {
	const entries = await fs.readdir(directoryPath, { withFileTypes: true });
	const visibleEntries = entries.filter(
		(entry) => !IGNORED_ENTRY_NAMES.has(entry.name),
	);

	const nodes = await Promise.all(
		visibleEntries.map(async (entry) => {
			const absolutePath = path.join(directoryPath, entry.name);
			const relativePath = path.relative(rootPath, absolutePath) || entry.name;

			if (entry.isDirectory()) {
				return {
					name: entry.name,
					relativePath,
					absolutePath,
					kind: "directory",
					children: await readDirectoryTree(absolutePath, rootPath),
				} satisfies MissionFileTreeNode;
			}

			return {
				name: entry.name,
				relativePath,
				absolutePath,
				kind: "file",
			} satisfies MissionFileTreeNode;
		}),
	);

	return nodes.sort(compareMissionFileTreeNodes);
}

function compareMissionFileTreeNodes(
	left: MissionFileTreeNode,
	right: MissionFileTreeNode,
): number {
	if (left.kind !== right.kind) {
		return left.kind === "directory" ? -1 : 1;
	}

	return left.name.localeCompare(right.name, undefined, { numeric: true });
}