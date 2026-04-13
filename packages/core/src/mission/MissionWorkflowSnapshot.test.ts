import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { FilesystemAdapter } from '../lib/FilesystemAdapter.js';
import { getMissionWorktreesPath } from '../lib/repoConfig.js';
import { createDefaultWorkflowSettings } from '../workflow/engine/defaultWorkflow.js';
import { Factory } from './Factory.js';
import type { MissionWorkflowBindings } from './Mission.js';

const temporaryWorkspaceRoots = new Set<string>();

afterEach(async () => {
    await Promise.all(
        [...temporaryWorkspaceRoots].map(async (workspaceRoot) => {
            temporaryWorkspaceRoots.delete(workspaceRoot);
            await fs.rm(getMissionWorktreesPath(workspaceRoot), { recursive: true, force: true }).catch(() => undefined);
            await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
        })
    );
});

describe('Mission workflow snapshot timing', () => {
    it('keeps draft missions linked to repository workflow settings until workflow start', async () => {
        const workspaceRoot = await createTempRepo();
        try {
            const adapter = new FilesystemAdapter(workspaceRoot);
            let workflow = {
                ...createDefaultWorkflowSettings(),
                autostart: { mission: false }
            };
            const bindings: MissionWorkflowBindings = {
                workflow,
                resolveWorkflow: () => workflow,
                taskRunners: new Map()
            };
            const mission = await Factory.create(adapter, {
                brief: {
                    issueId: 107,
                    title: 'Draft snapshot timing',
                    body: 'Defer workflow snapshot capture until the mission is ready.',
                    type: 'refactor'
                },
                branchRef: adapter.deriveMissionBranchName(107, 'Draft snapshot timing')
            }, bindings);

            expect(await adapter.readMissionRuntimeRecord(mission.getMissionDir())).toBeUndefined();

            const draftStatus = await mission.status();
            expect(draftStatus.workflow?.lifecycle).toBe('draft');
            expect(draftStatus.readyTasks ?? []).toEqual([]);
            expect(draftStatus.workflow?.configuration.workflow.execution.maxParallelTasks).toBe(1);

            workflow = {
                ...workflow,
                execution: {
                    ...workflow.execution,
                    maxParallelTasks: 3
                }
            };

            const updatedDraftStatus = await mission.status();
            expect(updatedDraftStatus.workflow?.configuration.workflow.execution.maxParallelTasks).toBe(3);

            const startedStatus = await mission.startWorkflow();
            expect(startedStatus.workflow?.configuration.workflow.execution.maxParallelTasks).toBe(3);
            expect(startedStatus.workflow?.lifecycle).toBe('running');

            const workflowDocument = await adapter.readMissionRuntimeRecord(mission.getMissionDir());
            expect(workflowDocument?.configuration.workflow.execution.maxParallelTasks).toBe(3);
            expect(workflowDocument?.eventLog.slice(0, 2).map((event) => event.type)).toEqual([
                'mission.created',
                'mission.started'
            ]);
            mission.dispose();
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('keeps mission workflow snapshots isolated after the mission is ready', async () => {
        const workspaceRoot = await createTempRepo();
        try {
            const adapter = new FilesystemAdapter(workspaceRoot);
            let workflow = {
                ...createDefaultWorkflowSettings(),
                autostart: { mission: false }
            };
            const bindings: MissionWorkflowBindings = {
                workflow,
                resolveWorkflow: () => workflow,
                taskRunners: new Map()
            };
            const mission = await Factory.create(adapter, {
                brief: {
                    issueId: 108,
                    title: 'Ready snapshot isolation',
                    body: 'Started missions should ignore later repository workflow edits.',
                    type: 'refactor'
                },
                branchRef: adapter.deriveMissionBranchName(108, 'Ready snapshot isolation')
            }, bindings);

            workflow = {
                ...workflow,
                execution: {
                    ...workflow.execution,
                    maxParallelTasks: 2
                }
            };
            await mission.startWorkflow();

            workflow = {
                ...workflow,
                execution: {
                    ...workflow.execution,
                    maxParallelTasks: 5
                }
            };

            const status = await mission.status();
            expect(status.workflow?.configuration.workflow.execution.maxParallelTasks).toBe(2);

            const workflowDocument = await adapter.readMissionRuntimeRecord(mission.getMissionDir());
            expect(workflowDocument?.configuration.workflow.execution.maxParallelTasks).toBe(2);
            const eventTypesBeforeRestart = workflowDocument?.eventLog.map((event) => event.type) ?? [];

            await mission.startWorkflow();
            const unchangedDocument = await adapter.readMissionRuntimeRecord(mission.getMissionDir());
            expect(unchangedDocument?.eventLog.map((event) => event.type)).toEqual(eventTypesBeforeRestart);
            mission.dispose();
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });
});

async function createTempRepo(): Promise<string> {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-snapshot-'));
    temporaryWorkspaceRoots.add(workspaceRoot);
    runGit(workspaceRoot, ['init']);
    runGit(workspaceRoot, ['config', 'user.email', 'mission@example.com']);
    runGit(workspaceRoot, ['config', 'user.name', 'Mission Test']);
    await fs.writeFile(path.join(workspaceRoot, 'README.md'), '# Mission Test\n', 'utf8');
    runGit(workspaceRoot, ['add', 'README.md']);
    runGit(workspaceRoot, ['commit', '-m', 'init']);
    return workspaceRoot;
}

function runGit(workspaceRoot: string, args: string[]): void {
    const result = spawnSync('git', args, {
        cwd: workspaceRoot,
        encoding: 'utf8'
    });
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed.`);
    }
}