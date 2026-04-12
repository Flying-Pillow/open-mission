import solidPlugin from '@opentui/solid/bun-plugin';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const result = await Bun.build({
	entrypoints: ['./src/tower/mountTowerUi.tsx'],
	outdir: './build/tower',
	target: 'bun',
	format: 'esm',
	sourcemap: 'external',
	plugins: [solidPlugin]
});

if (!result.success) {
	for (const log of result.logs) {
		const message = log.message || 'Unknown Bun build error.';
		console.error(message);
	}
	process.exit(1);
}

await mirrorJsxFilesAsJs('./build');

async function mirrorJsxFilesAsJs(directoryPath) {
	const entries = await readdir(directoryPath, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = path.join(directoryPath, entry.name);
		if (entry.isDirectory()) {
			await mirrorJsxFilesAsJs(entryPath);
			continue;
		}

		if (!entry.isFile() || !entry.name.endsWith('.jsx')) {
			continue;
		}

		const outputPath = entryPath.slice(0, -1);
		const content = await readFile(entryPath);
		await mkdir(path.dirname(outputPath), { recursive: true });
		await writeFile(outputPath, content);

		const sourceMapPath = `${entryPath}.map`;
		try {
			const sourceMapStats = await stat(sourceMapPath);
			if (sourceMapStats.isFile()) {
				const sourceMapContent = await readFile(sourceMapPath, 'utf8');
				const rewrittenSourceMapContent = sourceMapContent.replaceAll(
					`${path.basename(entryPath)}.map`.replace('.jsx.map', '.jsx.map'),
					`${path.basename(outputPath)}.map`
				).replaceAll(path.basename(entryPath), path.basename(outputPath));
				await writeFile(`${outputPath}.map`, rewrittenSourceMapContent);
			}
		} catch {
			// Ignore missing source maps; Bun may omit them for some assets.
		}
	}
}