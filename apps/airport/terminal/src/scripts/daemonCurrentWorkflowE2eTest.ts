import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
    DaemonApi,
    MISSION_ARTIFACTS,
    MISSION_GATE_INTENTS,
    MISSION_STAGE_FOLDERS,
    connectAirportControl,
    isMissionStageId,
    resolveAirportControlRuntimeMode,
    resolveMissionWorkspaceContext,
    type GateIntent,
    type MissionArtifactKey,
    type MissionStageId,
    type MissionStageProgress
} from '@flying-pillow/mission-core';

const MISSION_ARTIFACT_KEY_LIST = Object.keys(MISSION_ARTIFACTS) as MissionArtifactKey[];

const ARTIFACT_STAGE: Partial<Record<MissionArtifactKey, MissionStageId>> = {
    prd: 'prd',
    spec: 'spec',
    verify: 'implementation',
    audit: 'audit',
    delivery: 'delivery'
};

type CurrentWorkflowE2eOptions = {
    json: boolean;
};

type MissionRuntimeTask = {
    taskId: string;
    stageId: MissionStageId;
    lifecycle: string;
};

type MissionRuntimeStage = {
    stageId: MissionStageId;
    lifecycle: string;
    taskIds: string[];
    readyTaskIds: string[];
    queuedTaskIds: string[];
    runningTaskIds: string[];
    blockedTaskIds: string[];
    completedTaskIds: string[];
};

type MissionRuntimeFile = {
    schemaVersion: number;
    runtime: {
        lifecycle: string;
        updatedAt: string;
        stages: MissionRuntimeStage[];
        tasks: MissionRuntimeTask[];
    };
};

type CurrentWorkflowE2eReport = {
    missionId: string;
    stage: MissionStageId;
    workspaceRoot: string;
    missionDir: string;
    missionRootDir: string;
    activeTaskIds: string[];
    readyTaskIds: string[];
    gateSummary: Array<{ intent: GateIntent; allowed: boolean; errorCount: number; warningCount: number }>;
    artifactKeys: MissionArtifactKey[];
};

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const workspaceContext = resolveMissionWorkspaceContext(process.cwd());
    if (workspaceContext.kind !== 'mission-worktree') {
        throw new Error(
            [
                'Current workflow e2e test must run inside an active mission worktree.',
                `Resolved context kind: ${workspaceContext.kind}`
            ].join(' ')
        );
    }

    const runtimeDocument = await readMissionRuntimeDocument(
        path.join(workspaceContext.missionRootDir, 'mission.json')
    );

    const client = await connectAirportControl({
        surfacePath: workspaceContext.missionDir,
        runtimeMode: resolveAirportControlRuntimeMode(import.meta.url)
    });

    try {
        const ping = await client.request<{ protocolVersion: number; pid: number }>('ping');
        const api = new DaemonApi(client);
        assertCondition(ping.protocolVersion > 0, 'Daemon ping returned invalid protocol version.');
        assertCondition(ping.pid > 0, 'Daemon ping returned invalid process id.');

        const controlStatus = await api.control.getStatus();
        const missionId = resolveMissionId(controlStatus, workspaceContext.missionId);
        const missionStatus = await api.mission.getStatus({ missionId });

        assertCondition(missionStatus.found, 'Daemon mission.status returned found=false for active mission.');
        assertCondition(
            missionStatus.missionId === workspaceContext.missionId,
            `Mission id mismatch. expected='${workspaceContext.missionId}' actual='${missionStatus.missionId ?? 'undefined'}'`
        );
        assertCondition(
            path.resolve(missionStatus.missionDir ?? '') === path.resolve(workspaceContext.missionDir),
            [
                'Mission directory mismatch between daemon status and workspace context.',
                `expected='${workspaceContext.missionDir}'`,
                `actual='${missionStatus.missionDir ?? 'undefined'}'`
            ].join(' ')
        );
        assertCondition(
            path.resolve(missionStatus.missionRootDir ?? '') === path.resolve(workspaceContext.missionRootDir),
            [
                'Mission root directory mismatch between daemon status and workspace context.',
                `expected='${workspaceContext.missionRootDir}'`,
                `actual='${missionStatus.missionRootDir ?? 'undefined'}'`
            ].join(' ')
        );

        const expectedActiveStage = runtimeDocument.runtime.stages.find((stage) => stage.lifecycle !== 'completed')?.stageId;
        assertCondition(
            expectedActiveStage !== undefined,
            'mission.json does not declare an active stage.'
        );
        assertCondition(
            missionStatus.stage === expectedActiveStage,
            `Stage mismatch. expected='${String(expectedActiveStage)}' actual='${missionStatus.stage ?? 'undefined'}'`
        );

        const stageStatusMap = new Map((missionStatus.stages ?? []).map((stage) => [stage.stage, stage]));

        for (const stageState of runtimeDocument.runtime.stages) {
            const daemonStage = stageStatusMap.get(stageState.stageId);
            assertCondition(Boolean(daemonStage), `Daemon mission status is missing stage '${stageState.stageId}'.`);

            assertCondition(
                daemonStage?.status === mapRuntimeStageProgress(stageState, runtimeDocument.runtime.lifecycle),
                `Stage progress mismatch for '${stageState.stageId}'. expected='${mapRuntimeStageProgress(stageState, runtimeDocument.runtime.lifecycle)}' actual='${daemonStage?.status ?? 'undefined'}'`
            );

            const expectedTaskIds = runtimeDocument.runtime.tasks
                .filter((task) => task.stageId === stageState.stageId)
                .map((task) => task.taskId);
            assertCondition(
                daemonStage?.taskCount === expectedTaskIds.length,
                `Task count mismatch for '${stageState.stageId}'. expected=${String(expectedTaskIds.length)} actual=${String(daemonStage?.taskCount ?? -1)}`
            );

            const expectedCompletedCount = stageState.completedTaskIds.length;
            assertCondition(
                daemonStage?.completedTaskCount === expectedCompletedCount,
                `Completed task count mismatch for '${stageState.stageId}'. expected=${String(expectedCompletedCount)} actual=${String(daemonStage?.completedTaskCount ?? -1)}`
            );

            const expectedActiveTaskIds = runtimeDocument.runtime.tasks
                .filter(
                    (task) =>
                        task.stageId === stageState.stageId &&
                        (task.lifecycle === 'queued' || task.lifecycle === 'running')
                )
                .map((task) => task.taskId);

            assertStringSetEquals(
                daemonStage?.activeTaskIds ?? [],
                expectedActiveTaskIds,
                `Active task mismatch for stage '${stageState.stageId}'.`
            );

            for (const taskId of daemonStage?.activeTaskIds ?? []) {
                assertCondition(
                    expectedTaskIds.includes(taskId),
                    `Daemon stage '${stageState.stageId}' reported active task '${taskId}' that has no task file.`
                );
            }

            for (const taskId of daemonStage?.readyTaskIds ?? []) {
                assertCondition(
                    expectedTaskIds.includes(taskId),
                    `Daemon stage '${stageState.stageId}' reported ready task '${taskId}' that has no task file.`
                );
                assertCondition(
                    !(daemonStage?.activeTaskIds ?? []).includes(taskId),
                    `Daemon stage '${stageState.stageId}' reported task '${taskId}' as both ready and active.`
                );
            }
        }

        const expectedGlobalActiveTaskIds = runtimeDocument.runtime.tasks
            .filter((task) => task.lifecycle === 'queued' || task.lifecycle === 'running')
            .map((task) => task.taskId);

        const actualGlobalActiveTaskIds = (missionStatus.activeTasks ?? []).map((task) => task.taskId);
        assertStringSetEquals(
            actualGlobalActiveTaskIds,
            expectedGlobalActiveTaskIds,
            'Global active task projection mismatch between mission.status and mission.json.'
        );

        for (const task of missionStatus.activeTasks ?? []) {
            await ensureFileExists(task.filePath, `Active task file is missing on disk: ${task.filePath}`);
        }
        for (const task of missionStatus.readyTasks ?? []) {
            await ensureFileExists(task.filePath, `Ready task file is missing on disk: ${task.filePath}`);
        }

        const expectedArtifactMap = await resolveExpectedArtifactFiles(workspaceContext.missionRootDir);
        const actualArtifactMap = missionStatus.productFiles ?? {};

        for (const [artifactKey, artifactPath] of Object.entries(actualArtifactMap)) {
            assertCondition(
                MISSION_ARTIFACT_KEY_LIST.includes(artifactKey as MissionArtifactKey),
                `Daemon reported unknown artifact key '${artifactKey}'.`
            );
            await ensureFileExists(artifactPath, `Daemon reported artifact file that does not exist: ${artifactPath}`);

            const key = artifactKey as MissionArtifactKey;
            const expectedPath = expectedArtifactMap[key];
            assertCondition(
                expectedPath !== undefined,
                `Daemon reported artifact '${key}' but no matching file was found in the mission dossier.`
            );
            assertCondition(
                path.resolve(artifactPath) === path.resolve(expectedPath),
                [
                    `Artifact path mismatch for '${key}'.`,
                    `expected='${expectedPath}'`,
                    `actual='${artifactPath}'`
                ].join(' ')
            );
        }

        assertStringSetEquals(
            Object.keys(actualArtifactMap),
            Object.keys(expectedArtifactMap),
            'Artifact key mismatch between mission.status and on-disk mission dossier artifacts.'
        );

        const gateSummary: CurrentWorkflowE2eReport['gateSummary'] = [];
        for (const intent of MISSION_GATE_INTENTS) {
            const gateResult = await api.mission.evaluateGate({ missionId }, intent);
            assertCondition(gateResult.intent === intent, `Gate intent echo mismatch for '${intent}'.`);
            assertCondition(Array.isArray(gateResult.errors), `Gate '${intent}' returned invalid errors payload.`);
            assertCondition(Array.isArray(gateResult.warnings), `Gate '${intent}' returned invalid warnings payload.`);
            gateSummary.push({
                intent,
                allowed: gateResult.allowed,
                errorCount: gateResult.errors.length,
                warningCount: gateResult.warnings.length
            });
        }

        const report: CurrentWorkflowE2eReport = {
            missionId,
            stage: missionStatus.stage ?? expectedActiveStage,
            workspaceRoot: workspaceContext.workspaceRoot,
            missionDir: workspaceContext.missionDir,
            missionRootDir: workspaceContext.missionRootDir,
            activeTaskIds: actualGlobalActiveTaskIds.slice().sort(),
            readyTaskIds: (missionStatus.readyTasks ?? []).map((task) => task.taskId).sort(),
            gateSummary,
            artifactKeys: (Object.keys(actualArtifactMap) as MissionArtifactKey[]).sort()
        };

        if (options.json) {
            process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
            return;
        }

        process.stdout.write(
            [
                'Mission current workflow e2e test passed.',
                `missionId: ${report.missionId}`,
                `stage: ${report.stage}`,
                `workspaceRoot: ${report.workspaceRoot}`,
                `missionDir: ${report.missionDir}`,
                `missionRootDir: ${report.missionRootDir}`,
                `activeTasks: ${report.activeTaskIds.join(', ') || 'none'}`,
                `readyTasks: ${report.readyTaskIds.join(', ') || 'none'}`,
                `artifacts: ${report.artifactKeys.join(', ') || 'none'}`,
                `gates: ${report.gateSummary.map((gate) => `${gate.intent}=${gate.allowed ? 'allow' : 'deny'}(${String(gate.errorCount)}e/${String(gate.warningCount)}w)`).join(' | ')}`
            ].join('\n') + '\n'
        );
    } finally {
        client.dispose();
    }
}

function parseArgs(argv: string[]): CurrentWorkflowE2eOptions {
    const options: CurrentWorkflowE2eOptions = {
        json: false
    };

    for (const token of argv) {
        if (token === '--') {
            continue;
        }
        if (token === '--json') {
            options.json = true;
            continue;
        }
        throw new Error(`Unknown argument '${token}'. Supported flags: --json.`);
    }

    return options;
}

async function readMissionRuntimeDocument(filePath: string): Promise<MissionRuntimeFile> {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<MissionRuntimeFile>;

    if (!parsed || typeof parsed !== 'object' || !parsed.runtime || !Array.isArray(parsed.runtime.stages) || !Array.isArray(parsed.runtime.tasks)) {
        throw new Error(`Invalid mission.json structure at '${filePath}'.`);
    }

    const stages: MissionRuntimeStage[] = parsed.runtime.stages.map((stage, index) => {
        if (!stage || typeof stage !== 'object') {
            throw new Error(`mission.json stage entry ${String(index)} is invalid.`);
        }

        const candidate = stage as Partial<MissionRuntimeStage>;
        const stageId = candidate.stageId;

        if (!isMissionStageId(stageId)) {
            throw new Error(`mission.json stage entry ${String(index)} has invalid id '${String(stageId)}'.`);
        }
        if (!isRuntimeStageLifecycle(candidate.lifecycle)) {
            throw new Error(`mission.json stage '${stageId}' has invalid lifecycle '${String(candidate.lifecycle)}'.`);
        }

        return {
            stageId,
            lifecycle: candidate.lifecycle,
            taskIds: Array.isArray(candidate.taskIds) ? candidate.taskIds : [],
            readyTaskIds: Array.isArray(candidate.readyTaskIds) ? candidate.readyTaskIds : [],
            queuedTaskIds: Array.isArray(candidate.queuedTaskIds) ? candidate.queuedTaskIds : [],
            runningTaskIds: Array.isArray(candidate.runningTaskIds) ? candidate.runningTaskIds : [],
            blockedTaskIds: Array.isArray(candidate.blockedTaskIds) ? candidate.blockedTaskIds : [],
            completedTaskIds: Array.isArray(candidate.completedTaskIds) ? candidate.completedTaskIds : []
        };
    });

    const tasks: MissionRuntimeTask[] = parsed.runtime.tasks.map((task, index) => {
        if (!task || typeof task !== 'object') {
            throw new Error(`mission.json task entry ${String(index)} is invalid.`);
        }
        const candidate = task as Partial<MissionRuntimeTask>;
        if (typeof candidate.taskId !== 'string' || candidate.taskId.trim().length === 0) {
            throw new Error(`mission.json task entry ${String(index)} has invalid taskId.`);
        }
        if (!isMissionStageId(candidate.stageId)) {
            throw new Error(`mission.json task '${candidate.taskId}' has invalid stageId '${String(candidate.stageId)}'.`);
        }
        if (!isRuntimeTaskLifecycle(candidate.lifecycle)) {
            throw new Error(`mission.json task '${candidate.taskId}' has invalid lifecycle '${String(candidate.lifecycle)}'.`);
        }
        return {
            taskId: candidate.taskId,
            stageId: candidate.stageId,
            lifecycle: candidate.lifecycle
        };
    });

    return {
        schemaVersion: Number(parsed.schemaVersion ?? 0),
        runtime: {
            lifecycle: typeof parsed.runtime.lifecycle === 'string' ? parsed.runtime.lifecycle : 'draft',
            updatedAt: typeof parsed.runtime.updatedAt === 'string' ? parsed.runtime.updatedAt : '',
            stages,
            tasks
        }
    };
}

function mapRuntimeStageProgress(
    stage: MissionRuntimeStage,
    missionLifecycle: string
): MissionStageProgress {
    if (missionLifecycle === 'delivered' && stage.stageId === 'delivery') {
        return 'done';
    }
    switch (stage.lifecycle) {
        case 'completed':
            return 'done';
        case 'active':
        case 'blocked':
            return 'active';
        case 'ready':
        case 'pending':
        default:
            return 'pending';
    }
}

function isRuntimeStageLifecycle(value: unknown): value is MissionRuntimeStage['lifecycle'] {
    return value === 'pending' || value === 'ready' || value === 'active' || value === 'blocked' || value === 'completed';
}

function isRuntimeTaskLifecycle(value: unknown): value is MissionRuntimeTask['lifecycle'] {
    return value === 'pending'
        || value === 'ready'
        || value === 'queued'
        || value === 'running'
        || value === 'blocked'
        || value === 'completed'
        || value === 'failed'
        || value === 'cancelled';
}

async function resolveExpectedArtifactFiles(
    missionRootDir: string
): Promise<Partial<Record<MissionArtifactKey, string>>> {
    const result: Partial<Record<MissionArtifactKey, string>> = {};

    for (const artifactKey of MISSION_ARTIFACT_KEY_LIST) {
        const stageId = ARTIFACT_STAGE[artifactKey];
        const artifactPath = stageId
            ? path.join(
                missionRootDir,
                MISSION_STAGE_FOLDERS[stageId],
                MISSION_ARTIFACTS[artifactKey]
            )
            : path.join(missionRootDir, MISSION_ARTIFACTS[artifactKey]);

        if (await fileExists(artifactPath)) {
            result[artifactKey] = artifactPath;
        }
    }

    return result;
}

function resolveMissionId(
    controlStatus: { missionId?: string; availableMissions?: Array<{ missionId: string }> },
    expectedMissionId: string
): string {
    if (controlStatus.missionId) {
        return controlStatus.missionId;
    }

    const matching = (controlStatus.availableMissions ?? []).find(
        (candidate) => candidate.missionId === expectedMissionId
    );
    if (matching) {
        return matching.missionId;
    }

    const fallback = controlStatus.availableMissions?.[0]?.missionId;
    if (fallback) {
        return fallback;
    }

    throw new Error('Daemon control.status did not provide a missionId or available mission candidates.');
}
function assertStringSetEquals(actual: string[], expected: string[], message: string): void {
    const actualSorted = [...actual].sort();
    const expectedSorted = [...expected].sort();
    const actualText = JSON.stringify(actualSorted);
    const expectedText = JSON.stringify(expectedSorted);
    assertCondition(actualText === expectedText, `${message} expected=${expectedText} actual=${actualText}`);
}

function assertCondition(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function ensureFileExists(filePath: string, errorMessage: string): Promise<void> {
    if (!(await fileExists(filePath))) {
        throw new Error(errorMessage);
    }
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
