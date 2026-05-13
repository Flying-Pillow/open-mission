#!/usr/bin/env node

import { runOpenMissiondCommand } from '@flying-pillow/open-mission-core/daemon/startDaemon';

void runOpenMissiondCommand().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
});