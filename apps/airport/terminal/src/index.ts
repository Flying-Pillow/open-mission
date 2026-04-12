#!/usr/bin/env node

import { bootstrapAirportTerminal } from './bootstrapAirportTerminal.js';

void bootstrapAirportTerminal().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
});