import { access, chmod, copyFile, cp, mkdir, readdir, readlink, rm, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const nativeRoot = path.resolve(currentDirectory, "..");
const workspaceRoot = path.resolve(nativeRoot, "../..");
const webRoot = path.resolve(nativeRoot, "../web");
const resourceRoot = path.join(nativeRoot, "resources");
const embeddedServerRoot = path.join(resourceRoot, "embedded-server");
const runtimeRoot = path.join(resourceRoot, "runtime");
const bundledNodeBinaryPath = path.join(runtimeRoot, "node");

function run(command, args, cwd) {
	const result = spawnSync(command, args, {
		cwd,
		stdio: "inherit"
	});

	if (result.error) {
		throw result.error;
	}

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

async function ensureExecutable(filePath) {
	const fileStats = await stat(filePath);
	await chmod(filePath, fileStats.mode | 0o111);
}

function shouldMaterializeSymlink(entryPath, rootPath) {
	const relativePath = path.relative(rootPath, entryPath);
	const normalizedPath = relativePath.split(path.sep).join("/");

	if (!normalizedPath.includes("node_modules/.pnpm/")) {
		return true;
	}

	return normalizedPath.startsWith("node_modules/.pnpm/node_modules/");
}

async function materializeSymlinks(directoryPath, rootPath) {
	const directoryEntries = await readdir(directoryPath, { withFileTypes: true });

	for (const directoryEntry of directoryEntries) {
		const entryPath = path.join(directoryPath, directoryEntry.name);

		if (directoryEntry.isDirectory()) {
			await materializeSymlinks(entryPath, rootPath);
			continue;
		}

		if (!directoryEntry.isSymbolicLink()) {
			continue;
		}

		const linkTarget = await readlink(entryPath);
		const resolvedTargetPath = path.resolve(path.dirname(entryPath), linkTarget);

		try {
			await access(resolvedTargetPath);

			if (!resolvedTargetPath.startsWith(`${rootPath}${path.sep}`) && resolvedTargetPath !== rootPath) {
				await rm(entryPath, { force: true });
				continue;
			}

			if (!shouldMaterializeSymlink(entryPath, rootPath)) {
				continue;
			}

			const targetStats = await stat(resolvedTargetPath);
			if (targetStats.isDirectory()) {
				await rm(entryPath, { recursive: true, force: true });
				await cp(resolvedTargetPath, entryPath, { recursive: true, dereference: true });
				await materializeSymlinks(entryPath, rootPath);
				continue;
			}

			await rm(entryPath, { force: true });
			await copyFile(resolvedTargetPath, entryPath);
		} catch {
			await rm(entryPath, { force: true });
		}
	}
}

await rm(resourceRoot, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });

run(
	"pnpm",
	[
		"deploy",
		"--filter",
		"@flying-pillow/open-mission-web",
		"--prod",
		"--legacy",
		embeddedServerRoot
	],
	workspaceRoot,
);

await cp(path.join(webRoot, "build"), path.join(embeddedServerRoot, "build"), {
	recursive: true,
});
await materializeSymlinks(embeddedServerRoot, embeddedServerRoot);

await copyFile(process.execPath, bundledNodeBinaryPath);
await ensureExecutable(bundledNodeBinaryPath);

console.log(`Prepared embedded Open Mission web server at ${embeddedServerRoot}.`);
console.log(`Bundled Node runtime at ${bundledNodeBinaryPath}.`);