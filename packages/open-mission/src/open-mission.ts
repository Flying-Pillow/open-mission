#!/usr/bin/env node

import { routeOpenMissionEntry } from './routeOpenMissionEntry.js';

void routeOpenMissionEntry().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
});