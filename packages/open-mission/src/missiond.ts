#!/usr/bin/env node

import { runMissiondCommand } from '@flying-pillow/mission-core/daemon/startDaemon';

void runMissiondCommand().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
});