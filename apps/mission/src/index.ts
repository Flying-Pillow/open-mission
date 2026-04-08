#!/usr/bin/env node

import { runMission } from './mission.js';

void runMission().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
});