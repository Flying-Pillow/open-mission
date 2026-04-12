import solidPlugin from '@opentui/solid/bun-plugin';

const result = await Bun.build({
	entrypoints: ['./src/index.ts', './src/main.ts'],
	outdir: './build',
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