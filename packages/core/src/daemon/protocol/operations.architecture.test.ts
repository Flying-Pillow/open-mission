import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const removedProtocolMethods = [
    'airport.status',
    'airport.client.connect',
    'airport.client.observe',
    'airport.pane.bind',
    'control.status',
    'control.settings.update',
    'control.document.read',
    'control.document.write',
    'control.workflow.settings.get',
    'control.workflow.settings.initialize',
    'control.workflow.settings.update',
    'control.repositories.list',
    'control.repositories.add',
    'control.github.issue.detail',
    'control.issues.list',
    'mission.from-brief',
    'mission.from-issue',
    'mission.operator-status',
    'mission.status',
    'mission.gate.evaluate',
    'mission.terminal.ensure',
    'mission.terminal.state',
    'mission.terminal.input',
    'session.list',
    'session.console.state',
    'session.terminal.state',
    'session.terminal.input',
    'session.prompt',
    'session.command',
    'session.complete',
    'session.cancel',
    'session.terminate'
];

describe('daemon protocol architecture boundaries', () => {
    it('keeps the daemon request method surface limited to entity and system APIs', () => {
        const operationsSource = fs.readFileSync(path.join(srcRoot, 'daemon/protocol/operations.ts'), 'utf8');

        expect(operationsSource).toContain("| 'ping'");
        expect(operationsSource).toContain("| 'event.subscribe'");
        expect(operationsSource).toContain("| 'system.status'");
        expect(operationsSource).toContain("| 'entity.query'");
        expect(operationsSource).toContain("| 'entity.command'");
        expect(removedProtocolMethods.filter((method) => operationsSource.includes(method))).toEqual([]);
        expect(operationsSource).not.toMatch(/\b(?:control|mission)\.action\./);
    });

    it('does not export removed daemon facade clients', () => {
        const publicIndexSource = fs.readFileSync(path.join(srcRoot, 'index.ts'), 'utf8');
        const clientDirectory = path.join(srcRoot, 'client');

        expect(publicIndexSource).not.toMatch(/Daemon(Airport|Control|Mission)Api/);
        expect(fs.existsSync(path.join(clientDirectory, 'DaemonAirportApi.ts'))).toBe(false);
        expect(fs.existsSync(path.join(clientDirectory, 'DaemonControlApi.ts'))).toBe(false);
        expect(fs.existsSync(path.join(clientDirectory, 'DaemonMissionApi.ts'))).toBe(false);
    });
});