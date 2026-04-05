import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
    MISSION_ARTIFACTS,
    MISSION_GATE_INTENTS,
    MISSION_TASK_STAGE_DIRECTORIES,
    connectDaemonClient,
    evaluateMissionGate,
    getControlStatus,
    getMissionStatus,
    isMissionStageId,
    isMissionStageProgress,
    resolveDaemonLaunchModeFromModule,
    resolveMissionWorkspaceContext,
    type GateIntent,
    type MissionArtifactKey,
    type MissionStageId,
    type MissionStageProgress,
    type MissionTaskStatus
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

type MissionControlTask = {
    id: string;
    status: MissionTaskStatus;
    agent: string;
    retries: number;
    updatedAt: string;
};

type MissionControlStage = {
    id: MissionStageId;
    folder: string;
    status: MissionStageProgress;
    tasks: MissionControlTask[];
};

type MissionControlFile = {
    schemaVersion: number;
    updatedAt: string;
    stages: MissionControlStage[];
};

type CurrentWorkflowE2eReport = {
    missionId: string;
    stage: MissionStageId;
    controlRoot: string;
    missionDir: string;
    flightDeckDir: string;
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

    const missionControl = await readMissionControlState(
        path.join(workspaceContext.flightDeckDir, 'mission.json')
    );

    const taskFileIdsByStage = await readTaskFileIdsByStage(workspaceContext.flightDeckDir);

    const client = await connectDaemonClient({
        surfacePath: workspaceContext.missionDir,
        preferredLaunchMode: resolveDaemonLaunchModeFromModule(import.meta.url)
    });

    try {
        const ping = await client.request<{ protocolVersion: number; pid: number }>('ping');
        assertCondition(ping.protocolVersion > 0, 'Daemon ping returned invalid protocol version.');
        assertCondition(ping.pid > 0, 'Daemon ping returned invalid process id.');

        const controlStatus = await getControlStatus(client);
        const missionId = resolveMissionId(controlStatus, workspaceContext.missionId);
        const missionStatus = await getMissionStatus(client, { missionId });

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
            path.resolve(missionStatus.flightDeckDir ?? '') === path.resolve(workspaceContext.flightDeckDir),
            [
                'Flight-deck directory mismatch between daemon status and workspace context.',
                `expected='${workspaceContext.flightDeckDir}'`,
                `actual='${missionStatus.flightDeckDir ?? 'undefined'}'`
            ].join(' ')
        );

        const expectedActiveStage = missionControl.stages.find((stage) => stage.status === 'active')?.id;
        assertCondition(
            expectedActiveStage !== undefined,
            'mission.json does not declare an active stage.'
        );
        assertCondition(
            missionStatus.stage === expectedActiveStage,
            `Stage mismatch. expected='${String(expectedActiveStage)}' actual='${missionStatus.stage ?? 'undefined'}'`
        );

        const stageStatusMap = new Map((missionStatus.stages ?? []).map((stage) => [stage.stage, stage]));

        for (const stageState of missionControl.stages) {
            const daemonStage = stageStatusMap.get(stageState.id);
            assertCondition(Boolean(daemonStage), `Daemon mission status is missing stage '${stageState.id}'.`);

            const expectedStageFolder = MISSION_TASK_STAGE_DIRECTORIES[stageState.id];
            assertCondition(
                stageState.folder === expectedStageFolder,
                `mission.json folder mismatch for stage '${stageState.id}'. expected='${expectedStageFolder}' actual='${stageState.folder}'`
            );

            assertCondition(
                daemonStage?.status === stageState.status,
                `Stage progress mismatch for '${stageState.id}'. expected='${stageState.status}' actual='${daemonStage?.status ?? 'undefined'}'`
            );

            const expectedTaskIds = taskFileIdsByStage.get(stageState.id) ?? [];
            assertCondition(
                daemonStage?.taskCount === expectedTaskIds.length,
                `Task count mismatch for '${stageState.id}'. expected=${String(expectedTaskIds.length)} actual=${String(daemonStage?.taskCount ?? -1)}`
            );

            const expectedCompletedCount = stageState.tasks.filter((task) => task.status === 'done').length;
            assertCondition(
                daemonStage?.completedTaskCount === expectedCompletedCount,
                `Completed task count mismatch for '${stageState.id}'. expected=${String(expectedCompletedCount)} actual=${String(daemonStage?.completedTaskCount ?? -1)}`
            );

            const expectedActiveTaskIds = stageState.tasks
                .filter((task) => task.status === 'active')
                .map((task) => qualifyTaskId(stageState.id, task.id));

            assertStringSetEquals(
                daemonStage?.activeTaskIds ?? [],
                expectedActiveTaskIds,
                `Active task mismatch for stage '${stageState.id}'.`
            );

            for (const taskId of daemonStage?.activeTaskIds ?? []) {
                assertCondition(
                    expectedTaskIds.includes(taskId),
                    `Daemon stage '${stageState.id}' reported active task '${taskId}' that has no task file.`
                );
            }

            for (const taskId of daemonStage?.readyTaskIds ?? []) {
                assertCondition(
                    expectedTaskIds.includes(taskId),
                    `Daemon stage '${stageState.id}' reported ready task '${taskId}' that has no task file.`
                );
                assertCondition(
                    !(daemonStage?.activeTaskIds ?? []).includes(taskId),
                    `Daemon stage '${stageState.id}' reported task '${taskId}' as both ready and active.`
                );
            }
        }

        const expectedGlobalActiveTaskIds = missionControl.stages.flatMap((stageState) =>
            stageState.tasks
                .filter((task) => task.status === 'active')
                .map((task) => qualifyTaskId(stageState.id, task.id))
        );

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

        const expectedArtifactMap = await resolveExpectedArtifactFiles(workspaceContext.flightDeckDir);
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
                `Daemon reported artifact '${key}' but no matching file was found in flight-deck.`
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
            'Artifact key mismatch between mission.status and on-disk flight-deck artifacts.'
        );

        const gateSummary: CurrentWorkflowE2eReport['gateSummary'] = [];
        for (const intent of MISSION_GATE_INTENTS) {
            const gateResult = await evaluateMissionGate(client, { missionId }, intent);
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
            controlRoot: workspaceContext.workspaceRoot,
            missionDir: workspaceContext.missionDir,
            flightDeckDir: workspaceContext.flightDeckDir,
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
                `controlRoot: ${report.controlRoot}`,
                `missionDir: ${report.missionDir}`,
                `flightDeckDir: ${report.flightDeckDir}`,
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

async function readMissionControlState(filePath: string): Promise<MissionControlFile> {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<MissionControlFile>;

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.stages)) {
        throw new Error(`Invalid mission.json structure at '${filePath}'.`);
    }

    const stages: MissionControlStage[] = parsed.stages.map((stage, index) => {
        if (!stage || typeof stage !== 'object') {
            throw new Error(`mission.json stage entry ${String(index)} is invalid.`);
        }

        const stageId = (stage as Partial<MissionControlStage>).id;
        const folder = (stage as Partial<MissionControlStage>).folder;
        const status = (stage as Partial<MissionControlStage>).status;
        const tasks = Array.isArray((stage as Partial<MissionControlStage>).tasks)
            ? ((stage as Partial<MissionControlStage>).tasks as MissionControlTask[])
            : [];

        if (!isMissionStageId(stageId)) {
            throw new Error(`mission.json stage entry ${String(index)} has invalid id '${String(stageId)}'.`);
        }
        if (typeof folder !== 'string' || folder.trim().length === 0) {
            throw new Error(`mission.json stage '${stageId}' has invalid folder value.`);
        }
        if (!isMissionStageProgress(status)) {
            throw new Error(`mission.json stage '${stageId}' has invalid status '${String(status)}'.`);
        }

        return {
            id: stageId,
            folder,
            status,
            tasks
        };
    });

    return {
        schemaVersion: Number(parsed.schemaVersion ?? 0),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
        stages
    };
}

async function readTaskFileIdsByStage(flightDeckDir: string): Promise<Map<MissionStageId, string[]>> {
    const result = new Map<MissionStageId, string[]>();

    for (const stageId of Object.keys(MISSION_TASK_STAGE_DIRECTORIES) as MissionStageId[]) {
        const tasksDir = path.join(flightDeckDir, MISSION_TASK_STAGE_DIRECTORIES[stageId], 'tasks');
        const taskIds = await listTaskIdsFromDirectory(tasksDir, stageId);
        result.set(stageId, taskIds);
    }

    return result;
}

async function listTaskIdsFromDirectory(tasksDir: string, stageId: MissionStageId): Promise<string[]> {
    const entries = await fs.readdir(tasksDir, { withFileTypes: true }).catch(() => []);
    return entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        .map((entry) => qualifyTaskId(stageId, entry.name.replace(/\.md$/iu, '')))
        .sort();
}

async function resolveExpectedArtifactFiles(
    flightDeckDir: string
): Promise<Partial<Record<MissionArtifactKey, string>>> {
    const result: Partial<Record<MissionArtifactKey, string>> = {};

    for (const artifactKey of MISSION_ARTIFACT_KEY_LIST) {
        const stageId = ARTIFACT_STAGE[artifactKey];
        const artifactPath = stageId
            ? path.join(
                flightDeckDir,
                MISSION_TASK_STAGE_DIRECTORIES[stageId],
                MISSION_ARTIFACTS[artifactKey]
            )
            : path.join(flightDeckDir, MISSION_ARTIFACTS[artifactKey]);

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

function qualifyTaskId(stageId: MissionStageId, taskFileStem: string): string {
    return `${stageId}/${taskFileStem}`;
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
