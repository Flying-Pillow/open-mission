import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
	activateTask,
	completeTask,
	DaemonClient,
	deliverMission,
	evaluateMissionGate,
	getControlStatus,
	MISSION_STAGES,
	getMissionStatus,
	getSessionConsoleState,
	getDaemonManifestPath,
	getDaemonRuntimePath,
	initializeMissionRepository,
	launchTaskSession,
	MissionAgentContext,
	readDaemonManifest,
	resolveDaemonLaunchModeFromModule,
	startDaemonProcess,
	startMission,
	terminateSession,
	transitionMissionStage,
	type MissionAgentTurnRequest,
	type MissionBrief,
	type MissionSelector,
	type MissionStageId,
	type MissionStatus,
	type MissionTaskState
} from '@flying-pillow/mission-core';

type SmokeTestOptions = {
	json: boolean;
	keepRepo: boolean;
	repoRoot?: string;
	resumeExisting: boolean;
};

type SmokeTestReport = {
	repoRoot: string;
	keptRepo: boolean;
	manifestPath: string;
	missionId?: string;
	missionDir?: string;
	branchRef?: string;
	finalStage?: string;
	deliveredAt?: string;
	productFiles: string[];
	stageSummary: Array<{ stage: string; progress: string }>;
};

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : await createTempRepo();
	let client: DaemonClient | undefined;

	try {
		await initializeMissionRepository(repoRoot);
		await startDaemonProcess({
			repoRoot,
			preferredLaunchMode: resolveDaemonLaunchModeFromModule(import.meta.url)
		});

		client = await connectToStartedDaemon(repoRoot);

		let selector: MissionSelector;
		if (options.resumeExisting) {
			const status = await getControlStatus(client);
			const missionId = status.missionId ?? status.availableMissions?.[0]?.missionId;
			if (!missionId) {
				throw new Error('No existing mission is available to resume.');
			}
			selector = { missionId };
			await getMissionStatus(client, selector);
		} else {
			const started = await startMission(client, {
				brief: createSmokeBrief(),
				agentContext: MissionAgentContext.build({ mode: 'interactive', environment: 'local' })
			});
			if (!started.missionId) {
				throw new Error('Mission start did not return a mission id.');
			}
			selector = { missionId: started.missionId };
		}
		const finalStatus = await driveMissionToCompletion(client, selector, repoRoot);

		const report = createReport(repoRoot, finalStatus, options.keepRepo);
		if (options.json) {
			process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		} else {
			printReport(report);
		}
	} finally {
		client?.dispose();
		await stopDaemon(repoRoot);
		if (!options.keepRepo && !options.repoRoot) {
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	}
}

function parseArgs(argv: string[]): SmokeTestOptions {
	const options: SmokeTestOptions = {
		json: false,
		keepRepo: false,
		resumeExisting: false
	};

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === '--') {
			continue;
		}
		if (token === '--json') {
			options.json = true;
			continue;
		}
		if (token === '--keep-repo') {
			options.keepRepo = true;
			continue;
		}
		if (token === '--repo-root') {
			const next = argv[index + 1];
			if (!next) {
				throw new Error('Expected a path after --repo-root.');
			}
			options.repoRoot = next;
			index += 1;
			continue;
		}
		if (token === '--resume-existing') {
			options.resumeExisting = true;
			continue;
		}

		throw new Error(`Unknown argument '${token}'. Supported flags: --json, --keep-repo, --repo-root <path>, --resume-existing.`);
	}

	return options;
}

function createSmokeBrief(): MissionBrief {
	return {
		issueId: 9001,
		title: 'Generate the game doom in pure html, css and javascript',
		body: 'Generate the game doom in pure html, css and javascript',
		type: 'task'
	};
}

async function createTempRepo(): Promise<string> {
	const testRoot = path.join(getWorkspaceRoot(), '.test');
	await fs.mkdir(testRoot, { recursive: true });
	const repoRoot = await fs.mkdtemp(path.join(testRoot, 'mission-daemon-smoke-'));
	runGit(repoRoot, ['init']);
	runGit(repoRoot, ['config', 'user.email', 'mission@example.com']);
	runGit(repoRoot, ['config', 'user.name', 'Mission Smoke']);
	await fs.writeFile(path.join(repoRoot, 'README.md'), '# Mission Smoke Test\n', 'utf8');
	runGit(repoRoot, ['add', 'README.md']);
	runGit(repoRoot, ['commit', '-m', 'init']);
	return repoRoot;
}

function getWorkspaceRoot(): string {
	const scriptDir = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(scriptDir, '../../../../');
}

function runGit(repoRoot: string, args: string[]): void {
	const result = spawnSync('git', args, {
		cwd: repoRoot,
		encoding: 'utf8'
	});
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed.`);
	}
}

async function connectToStartedDaemon(repoRoot: string): Promise<DaemonClient> {
	const timeoutAt = Date.now() + 15000;
	let lastError: Error | undefined;

	while (Date.now() < timeoutAt) {
		const client = new DaemonClient();
		try {
			await client.connect({ repoRoot });
			return client;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			client.dispose();
			await delay(150);
		}
	}

	throw new Error(
		lastError
			? `Mission daemon did not become ready: ${lastError.message}`
			: 'Mission daemon did not become ready.'
	);
}

async function driveMissionToCompletion(
	client: DaemonClient,
	selector: MissionSelector,
	repoRoot: string
): Promise<MissionStatus> {
	const timeoutAt = Date.now() + 10 * 60 * 1000;

	while (Date.now() < timeoutAt) {
		const status = await getMissionStatus(client, selector);
		if (status.deliveredAt) {
			return status;
		}

		const failure = summarizeMissionFailure(status);
		if (failure) {
			throw new Error(failure);
		}

		const nextTask = pickNextTask(status);
		if (nextTask) {
			if (nextTask.status !== 'active') {
				await activateTask(client, selector, nextTask.taskId);
			}
			await executeTask(client, selector, nextTask, status, repoRoot);
			await completeTask(client, selector, nextTask.taskId);
			continue;
		}

		const nextStage = findNextStage(status);
		if (nextStage) {
			await transitionMissionStage(client, selector, nextStage);
			continue;
		}

		const deliveryGate = await evaluateMissionGate(client, selector, 'deliver');
		if (deliveryGate.allowed) {
			await deliverMission(client, selector);
			continue;
		}

		await delay(500);
	}

	const finalStatus = await getMissionStatus(client, selector);
	throw new Error(
		`Timed out driving the staged mission to completion. Last stage: ${finalStatus.stage ?? 'unknown'}.`
	);
}

function pickNextTask(status: MissionStatus): MissionTaskState | undefined {
	const activeTask = status.activeTasks?.[0];
	if (activeTask) {
		return activeTask;
	}

	return status.readyTasks?.[0];
}

function findNextStage(status: MissionStatus): MissionStageId | undefined {
	const currentStage = status.stage;
	if (!currentStage) {
		return undefined;
	}

	const currentStageStatus = status.stages?.find((stage) => stage.stage === currentStage);
	if (!currentStageStatus || currentStageStatus.completedTaskCount !== currentStageStatus.taskCount) {
		return undefined;
	}

	const currentIndex = MISSION_STAGES.indexOf(currentStage);
	return currentIndex >= 0 ? MISSION_STAGES[currentIndex + 1] : undefined;
}

async function executeTask(
	client: DaemonClient,
	selector: MissionSelector,
	task: MissionTaskState,
	status: MissionStatus,
	repoRoot: string
): Promise<void> {
	const request = createTaskTurnRequest(task, status, repoRoot);
	const launchRequest = {
		workingDirectory: request.workingDirectory,
		prompt: request.prompt,
		startFreshSession: true,
		...(request.title ? { title: request.title } : {}),
		...(request.operatorIntent ? { operatorIntent: request.operatorIntent } : {}),
		...(request.scope ? { scope: request.scope } : {})
	};
	const session = await launchTaskSession(client, selector, task.taskId, launchRequest);

	await waitForTaskSessionCompletion(client, selector, session.sessionId, task.taskId);
}

async function waitForTaskSessionCompletion(
	client: DaemonClient,
	selector: MissionSelector,
	sessionId: string,
	taskId: string
): Promise<void> {
	const timeoutAt = Date.now() + 5 * 60 * 1000;

	while (Date.now() < timeoutAt) {
		const status = await getMissionStatus(client, selector);
		const session = (status.agentSessions ?? []).find((candidate) => candidate.sessionId === sessionId);
		if (!session) {
			await delay(250);
			continue;
		}

		if (session.lifecycleState === 'completed') {
			return;
		}

		if (session.lifecycleState === 'failed' || session.lifecycleState === 'cancelled') {
			throw new Error(
				`Mission task session '${sessionId}' failed for '${taskId}' with lifecycle '${session.lifecycleState}'.`
			);
		}

		if (session.lifecycleState === 'awaiting-input') {
			const consoleState = await getSessionConsoleState(client, selector, sessionId);
			throw new Error(
				[
					`Mission task session '${sessionId}' unexpectedly requested input for '${taskId}'.`,
					...(consoleState?.lines?.slice(-10) ?? [])
				].join('\n')
			);
		}

		await delay(500);
	}

	await terminateSession(
		client,
		selector,
		sessionId,
		`Timed out waiting for '${taskId}' to finish.`
	).catch(() => undefined);
	throw new Error(`Timed out waiting for mission task session '${sessionId}' to complete for '${taskId}'.`);
}

function createTaskTurnRequest(
	task: MissionTaskState,
	status: MissionStatus,
	repoRoot: string
): MissionAgentTurnRequest {
	const missionDir = status.missionDir ?? repoRoot;
	return {
		workingDirectory:
			task.stage === 'implementation' || task.stage === 'verification' ? repoRoot : missionDir,
		prompt: task.instruction,
		title: task.subject,
		operatorIntent: 'Complete this mission task autonomously and stop when the task is finished.',
		scope: {
			kind: 'slice',
			sliceTitle: task.subject,
			verificationTargets: [],
			requiredSkills: [],
			dependsOn: [...task.dependsOn],
			...(status.missionId ? { missionId: status.missionId } : {}),
			...(missionDir ? { missionDir } : {}),
			stage: task.stage,
			taskId: task.taskId,
			taskTitle: task.subject,
			taskSummary: task.subject,
			taskInstruction: task.instruction
		}
	};
}

function summarizeMissionFailure(status: MissionStatus): string | undefined {
	const currentStage = status.stages?.find((stage) => stage.stage === status.stage);
	if (currentStage?.status === 'blocked') {
		return `Autonomous mission is blocked in stage '${currentStage.stage}'.`;
	}

	return undefined;
}

async function stopDaemon(repoRoot: string): Promise<void> {
	const manifest = await readDaemonManifest(repoRoot);
	if (!manifest) {
		return;
	}

	try {
		process.kill(manifest.pid, 'SIGTERM');
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== 'ESRCH') {
			throw error;
		}
	}

	await fs.rm(getDaemonManifestPath(repoRoot), { force: true }).catch(() => undefined);
	if (manifest.endpoint.transport === 'ipc') {
		await fs.rm(manifest.endpoint.path, { force: true }).catch(() => undefined);
	}
	await fs.rm(getDaemonRuntimePath(repoRoot), { recursive: true, force: true }).catch(
		() => undefined
	);
}

function createReport(repoRoot: string, status: MissionStatus, keptRepo: boolean): SmokeTestReport {
	return {
		repoRoot,
		keptRepo,
		manifestPath: getDaemonManifestPath(repoRoot),
		...(status.missionId ? { missionId: status.missionId } : {}),
		...(status.missionDir ? { missionDir: status.missionDir } : {}),
		...(status.branchRef ? { branchRef: status.branchRef } : {}),
		...(status.stage ? { finalStage: status.stage } : {}),
		...(status.deliveredAt ? { deliveredAt: status.deliveredAt } : {}),
		productFiles: Object.keys(status.productFiles ?? {}).sort(),
		stageSummary: (status.stages ?? []).map((stage) => ({
			stage: stage.stage,
			progress: `${String(stage.completedTaskCount)}/${String(stage.taskCount)}`
		}))
	};
}

function printReport(report: SmokeTestReport): void {
	process.stdout.write(
		[
			'Mission daemon smoke test passed.',
			`repoRoot: ${report.repoRoot}`,
			`manifest: ${report.manifestPath}`,
			`missionId: ${report.missionId ?? 'unknown'}`,
			`branchRef: ${report.branchRef ?? 'unknown'}`,
			`finalStage: ${report.finalStage ?? 'unknown'}`,
			`deliveredAt: ${report.deliveredAt ?? 'not delivered'}`,
			`products: ${report.productFiles.join(', ') || 'none'}`,
			`stages: ${report.stageSummary.map((stage) => `${stage.stage}=${stage.progress}`).join(' | ')}`,
			report.keptRepo ? `keptRepo: ${report.repoRoot}` : 'keptRepo: no'
		].join('\n') + '\n'
	);
}

void main().catch((error: unknown) => {
	const message = error instanceof Error ? error.stack ?? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
});