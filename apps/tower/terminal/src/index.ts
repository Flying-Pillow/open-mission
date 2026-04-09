#!/usr/bin/env node

import { routeTowerEntry } from './routeTowerEntry.js';

void routeTowerEntry().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
});