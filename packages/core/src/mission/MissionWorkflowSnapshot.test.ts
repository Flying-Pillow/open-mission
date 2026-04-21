import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { FilesystemAdapter } from '../lib/FilesystemAdapter.js';
import { getMissionWorktreesPath } from '../lib/repoConfig.js';
import { createDefaultWorkflowSettings } from '../workflow/mission/workflow.js';
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
            const eventLog = await adapter.readMissionRuntimeEventLog(mission.getMissionDir());
            expect(workflowDocument?.configuration.workflow.execution.maxParallelTasks).toBe(3);
            expect(eventLog.slice(0, 3).map((event) => event.type)).toEqual([
                'mission.created',
                'tasks.generated',
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
            const eventTypesBeforeRestart = (await adapter.readMissionRuntimeEventLog(mission.getMissionDir())).map((event) => event.type);

            await mission.startWorkflow();
            const unchangedEventTypes = (await adapter.readMissionRuntimeEventLog(mission.getMissionDir())).map((event) => event.type);
            expect(unchangedEventTypes).toEqual(eventTypesBeforeRestart);
            mission.dispose();
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('falls back to a derived task title when generated workflow tasks omit title', async () => {
        const workspaceRoot = await createTempRepo();
        try {
            const adapter = new FilesystemAdapter(workspaceRoot);
            const workflow = {
                ...createDefaultWorkflowSettings(),
                stageOrder: ['delivery'],
                gates: [{ gateId: 'deliver', intent: 'deliver' as const, stageId: 'delivery' }],
                taskGeneration: [
                    {
                        stageId: 'delivery',
                        artifactTasks: false,
                        templateSources: [],
                        tasks: [
                            {
                                taskId: 'delivery/01-closeout',
                                title: '',
                                instruction: 'Close out the delivery stage.',
                                dependsOn: []
                            }
                        ]
                    }
                ]
            };
            const bindings: MissionWorkflowBindings = {
                workflow,
                resolveWorkflow: () => workflow,
                taskRunners: new Map()
            };
            const mission = await Factory.create(adapter, {
                brief: {
                    issueId: 109,
                    title: 'Delivery title fallback',
                    body: 'Ensure malformed workflow task titles do not break status payloads.',
                    type: 'refactor'
                },
                branchRef: adapter.deriveMissionBranchName(109, 'Delivery title fallback')
            }, bindings);

            const status = await mission.startWorkflow();
            expect(status.workflow?.tasks?.[0]?.title).toBe('Closeout');
            expect(status.readyTasks?.[0]?.subject).toBe('Closeout');
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