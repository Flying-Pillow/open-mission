import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
	parseFrontmatterDocument,
	renderFrontmatterDocument,
	type FrontmatterValue
} from './frontmatter.js';
import { getMissionWorktreesPath } from './repoConfig.js';
import {
	MISSION_ARTIFACTS,
	MISSION_CONTROL_FILE_NAME,
	MISSION_CONTROL_SCHEMA_VERSION,
	MISSION_STAGES,
	MISSION_TASK_STAGE_DIRECTORIES,
	isMissionTaskAgent,
	isMissionTaskStatus,
	type MissionBrief,
	type MissionControlState,
	type MissionDescriptor,
	type MissionProductKey,
	type MissionSelector,
	type MissionStageId,
	type MissionTaskControlState,
	type MissionTaskAgent,
	type MissionTaskState,
	type MissionTaskStatus,
	type MissionType
} from '../types.js';
import { renderMissionBriefBody } from '../templates/mission/index.js';

export class ArtifactFormatError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'ArtifactFormatError';
	}
}

export class ArtifactTypeError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'ArtifactTypeError';
	}
}

export type ArtifactRecord = {
	artifact: MissionProductKey;
	fileName: string;
	filePath: string;
	relativePath: string;
	attributes: Record<string, FrontmatterValue>;
	body: string;
};

export type ArtifactRecordWrite = {
	attributes?: Record<string, FrontmatterValue>;
	body: string;
};

export type TaskArtifactWrite = {
	subject: string;
	instruction: string;
	dependsOn?: string[];
	agent: MissionTaskAgent;
	status?: MissionTaskStatus;
	retries?: number;
};

export type ResolvedMission = {
	missionDir: string;
	descriptor: MissionDescriptor;
};

export class FilesystemAdapter {
	public constructor(private readonly repoRoot: string) {}

	public getRepoRoot(): string {
		return this.repoRoot;
	}

	public getMissionsPath(): string {
		return getMissionWorktreesPath(this.repoRoot);
	}

	public getMissionDir(missionId: string): string {
		return path.join(this.getMissionsPath(), missionId);
	}

	public getTasksPath(missionDir: string): string {
		return path.join(missionDir, 'tasks');
	}

	public getStageTasksPath(missionDir: string, stage: MissionStageId): string {
		return path.join(this.getTasksPath(missionDir), MISSION_TASK_STAGE_DIRECTORIES[stage]);
	}

	public getCurrentBranch(startPath = this.repoRoot): string {
		return this.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], startPath);
	}

	public isGitRepository(): boolean {
		return this.runGit(['rev-parse', '--is-inside-work-tree']) === 'true';
	}

	public deriveMissionBranchName(issueId: number, title?: string): string {
		const slug = this.slugify(title, 48);
		return slug.length > 0 ? `mission/${String(issueId)}-${slug}` : `mission/${String(issueId)}`;
	}

	public deriveDraftMissionBranchName(title?: string): string {
		const slug = this.slugify(title, 48);
		const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
		return slug.length > 0
			? `mission/draft-${timestamp}-${slug}`
			: `mission/draft-${timestamp}`;
	}

	public async materializeMissionWorktree(missionDir: string, branchRef: string): Promise<string> {
		const normalizedBranch = branchRef.trim();
		if (!normalizedBranch) {
			throw new Error('Mission branch cannot be empty.');
		}

		const existingMissionPath = await fs.lstat(missionDir).then(
			(stats) => stats.isDirectory(),
			() => false
		);
		if (existingMissionPath) {
			throw new Error(`Mission worktree path '${missionDir}' already exists.`);
		}

		await fs.mkdir(path.dirname(missionDir), { recursive: true });

		const branchExists = this.runGit(['rev-parse', '--verify', `refs/heads/${normalizedBranch}`]);
		try {
			if (branchExists) {
				this.assertGit(['worktree', 'add', missionDir, normalizedBranch]);
			} else {
				this.assertGit(['worktree', 'add', '-b', normalizedBranch, missionDir]);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes('already checked out')) {
				throw new Error(
					`Mission branch '${normalizedBranch}' is already checked out in another worktree. Switch that worktree away before adopting it as a mission.`
				);
			}
			throw error;
		}

		const nextBranch = this.getCurrentBranch(missionDir);
		if (nextBranch !== normalizedBranch) {
			throw new Error(`Failed to materialize mission worktree for branch '${normalizedBranch}'.`);
		}

		return normalizedBranch;
	}

	public createMissionId(brief: MissionBrief): string {
		const slug = this.slugify(brief.title, 48);
		if (brief.issueId !== undefined) {
			return slug.length > 0 ? `mission-${String(brief.issueId)}-${slug}` : `mission-${String(brief.issueId)}`;
		}

		const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
		return slug.length > 0 ? `mission-${timestamp}-${slug}` : `mission-${timestamp}`;
	}

	public async initializeMissionEnvironment(missionDir: string): Promise<void> {
		await fs.mkdir(missionDir, { recursive: true });
	}

	public async ensureStageDirectory(missionDir: string, stage: MissionStageId): Promise<string> {
		const stagePath = this.getStageTasksPath(missionDir, stage);
		await fs.mkdir(stagePath, { recursive: true });
		return stagePath;
	}

	public async listMissions(): Promise<ResolvedMission[]> {
		const missionEntries = await fs.readdir(this.getMissionsPath(), { withFileTypes: true }).catch(() => []);
		const missions: ResolvedMission[] = [];

		for (const entry of missionEntries) {
			if (!entry.isDirectory()) {
				continue;
			}

			const missionDir = path.join(this.getMissionsPath(), entry.name);
			const descriptor = await this.readMissionDescriptor(missionDir);
			if (!descriptor) {
				continue;
			}

			missions.push({ missionDir, descriptor });
		}

		return missions.sort((left, right) => right.descriptor.createdAt.localeCompare(left.descriptor.createdAt));
	}

	public async resolveMission(selector: MissionSelector = {}): Promise<ResolvedMission | undefined> {
		const missions = await this.listMissions();
		const currentBranch = selector.branchRef ?? this.getCurrentBranch();
		const issueId = selector.issueId;
		const missionId = selector.missionId?.trim();

		return missions.find(({ descriptor }) => {
			if (missionId && descriptor.missionId !== missionId) {
				return false;
			}

			if (issueId !== undefined && descriptor.brief.issueId !== issueId) {
				return false;
			}

			if (selector.branchRef && descriptor.branchRef !== selector.branchRef) {
				return false;
			}

			if (!selector.branchRef && missionId === undefined && issueId === undefined) {
				return descriptor.branchRef === currentBranch;
			}

			return true;
		});
	}

	public async readMissionDescriptor(missionDir: string): Promise<MissionDescriptor | undefined> {
		const brief = await this.readArtifactRecord(missionDir, 'brief');
		if (!brief) {
			return undefined;
		}

		const issueId = this.readOptionalNumberAttribute(brief.attributes, 'issueId', brief.filePath);
		const title =
			this.readOptionalStringAttribute(brief.attributes, 'title', brief.filePath) ?? path.basename(missionDir);
		const type = this.readMissionTypeAttribute(brief.attributes, 'type', brief.filePath) ?? 'task';
		const branchRef =
			this.readOptionalStringAttribute(brief.attributes, 'branchRef', brief.filePath) ??
			this.getCurrentBranch(missionDir) ??
			'HEAD';
		const createdAt =
			this.readOptionalStringAttribute(brief.attributes, 'createdAt', brief.filePath) ??
			new Date().toISOString();
		const url = this.readOptionalStringAttribute(brief.attributes, 'url', brief.filePath);

		return {
			missionId: path.basename(missionDir),
			missionDir,
			brief: {
				title,
				body: this.extractBriefBody(brief.body),
				type,
				...(issueId !== undefined ? { issueId } : {}),
				...(url ? { url } : {})
			},
			branchRef,
			createdAt
		};
	}

	public async writeMissionDescriptor(missionDir: string, descriptor: MissionDescriptor): Promise<void> {
		await this.writeArtifactRecord(missionDir, 'brief', {
			attributes: {
				...(descriptor.brief.issueId !== undefined ? { issueId: descriptor.brief.issueId } : {}),
				title: descriptor.brief.title,
				type: descriptor.brief.type,
				branchRef: descriptor.branchRef,
				createdAt: descriptor.createdAt,
				...(descriptor.brief.url ? { url: descriptor.brief.url } : {})
			},
			body: renderMissionBriefBody(descriptor.brief)
		});
	}

	public getMissionControlStatePath(missionDir: string): string {
		return path.join(missionDir, MISSION_CONTROL_FILE_NAME);
	}

	public async readMissionControlState(missionDir: string): Promise<MissionControlState | undefined> {
		const filePath = this.getMissionControlStatePath(missionDir);
		try {
			const content = await fs.readFile(filePath, 'utf8');
			return this.parseMissionControlState(JSON.parse(content) as unknown, filePath);
		} catch (error) {
			if (this.isMissingFileError(error)) {
				return undefined;
			}
			if (error instanceof SyntaxError) {
				throw new ArtifactFormatError(`Mission control state '${filePath}' is not valid JSON.`);
			}
			throw error;
		}
	}

	public async reconcileMissionControlState(missionDir: string): Promise<MissionControlState> {
		const existing = await this.readMissionControlState(missionDir);
		const nextTasks: Record<string, MissionTaskControlState> = {};
		const legacyDeliveredAt = existing?.deliveredAt ?? (await this.readLegacyMissionDeliveredAt(missionDir));

		for (const stage of MISSION_STAGES) {
			for (const fileName of await this.listTaskFileNames(missionDir, stage)) {
				const taskId = this.createTaskId(stage, fileName);
				const existingTaskState = existing?.tasks[taskId];
				if (existingTaskState) {
					nextTasks[taskId] = { ...existingTaskState };
					continue;
				}

				nextTasks[taskId] = existing
					? this.createTaskControlState()
					: await this.readLegacyTaskControlState(missionDir, stage, fileName);
			}
		}

		const candidateState: MissionControlState = {
			schemaVersion: MISSION_CONTROL_SCHEMA_VERSION,
			updatedAt: existing?.updatedAt ?? new Date().toISOString(),
			...(legacyDeliveredAt ? { deliveredAt: legacyDeliveredAt } : {}),
			tasks: nextTasks
		};

		if (existing && this.isMissionControlStateEqual(existing, candidateState)) {
			return candidateState;
		}

		const nextState: MissionControlState = {
			...candidateState,
			updatedAt: new Date().toISOString()
		};
		await this.writeMissionControlState(missionDir, nextState);
		return nextState;
	}

	public async setMissionDeliveredAt(
		missionDir: string,
		deliveredAt: string
	): Promise<MissionControlState> {
		const controlState = await this.reconcileMissionControlState(missionDir);
		const nextState: MissionControlState = {
			...controlState,
			deliveredAt,
			updatedAt: new Date().toISOString()
		};
		await this.writeMissionControlState(missionDir, nextState);
		return nextState;
	}

	public async artifactExists(missionDir: string, artifact: MissionProductKey): Promise<boolean> {
		try {
			await fs.stat(this.getArtifactPath(missionDir, artifact));
			return true;
		} catch {
			return false;
		}
	}

	public async readArtifactRecord(
		missionDir: string,
		artifact: MissionProductKey
	): Promise<ArtifactRecord | undefined> {
		const filePath = this.getArtifactPath(missionDir, artifact);
		try {
			const content = await fs.readFile(filePath, 'utf8');
			const document = parseFrontmatterDocument(content);
			return {
				artifact,
				fileName: path.basename(filePath),
				filePath,
				relativePath: path.relative(missionDir, filePath).split(path.sep).join('/'),
				attributes: document.attributes,
				body: document.body
			};
		} catch (error) {
			if (this.isMissingFileError(error)) {
				return undefined;
			}
			throw error;
		}
	}

	public async writeArtifactRecord(
		missionDir: string,
		artifact: MissionProductKey,
		record: ArtifactRecordWrite
	): Promise<void> {
		const filePath = this.getArtifactPath(missionDir, artifact);
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, this.renderDocument(record.attributes ?? {}, record.body), 'utf8');
	}

	public async taskExists(missionDir: string, stage: MissionStageId, fileName: string): Promise<boolean> {
		try {
			await fs.stat(this.getTaskPath(missionDir, stage, fileName));
			return true;
		} catch {
			return false;
		}
	}

	public async readTaskState(
		missionDir: string,
		stage: MissionStageId,
		fileName: string,
		controlState?: MissionControlState
	): Promise<MissionTaskState | undefined> {
		try {
			const tasks = await this.listTaskStates(missionDir, stage, controlState);
			return tasks.find((task) => task.fileName === fileName);
		} catch (error) {
			if (this.isMissingFileError(error)) {
				return undefined;
			}
			throw error;
		}
	}

	public async listTaskStates(
		missionDir: string,
		stage: MissionStageId,
		controlState?: MissionControlState
	): Promise<MissionTaskState[]> {
		const stagePath = this.getStageTasksPath(missionDir, stage);
		const fileNames = await this.listTaskFileNames(missionDir, stage);
		const resolvedControlState = controlState ?? (await this.reconcileMissionControlState(missionDir));

		const tasks = await Promise.all(
			fileNames.map((fileName, index) =>
				this.readTaskStateInternal(
					missionDir,
					stage,
					path.join(stagePath, fileName),
					fileName,
					index + 1,
					resolvedControlState
				)
			)
		);

		return this.resolveTaskDependencies(tasks);
	}

	public async writeTaskRecord(
		missionDir: string,
		stage: MissionStageId,
		fileName: string,
		record: TaskArtifactWrite
	): Promise<void> {
		await this.ensureStageDirectory(missionDir, stage);
		const filePath = this.getTaskPath(missionDir, stage, fileName);
		await fs.writeFile(
			filePath,
			this.renderTaskDocument(record.subject, record.instruction, record.dependsOn),
			'utf8'
		);

		const controlState = await this.reconcileMissionControlState(missionDir);
		const taskId = this.createTaskId(stage, fileName);
		const nextState: MissionControlState = {
			...controlState,
			updatedAt: new Date().toISOString(),
			tasks: {
				...controlState.tasks,
				[taskId]: this.createTaskControlState({
					status: record.status ?? 'todo',
					agent: record.agent,
					retries: record.retries ?? 0
				})
			}
		};
		await this.writeMissionControlState(missionDir, nextState);
	}

	public async updateTaskState(
		task: MissionTaskState,
		changes: Partial<{ status: MissionTaskStatus; agent: MissionTaskAgent; retries: number }>
	): Promise<void> {
		const missionDir = this.resolveMissionDirFromTask(task);
		const controlState = await this.reconcileMissionControlState(missionDir);
		const taskState = controlState.tasks[task.taskId];
		if (!taskState) {
			throw new ArtifactFormatError(`Mission control state is missing task '${task.taskId}'.`);
		}

		const nextState: MissionControlState = {
			...controlState,
			updatedAt: new Date().toISOString(),
			tasks: {
				...controlState.tasks,
				[task.taskId]: {
					...taskState,
					...(changes.status ? { status: changes.status } : {}),
					...(changes.agent ? { agent: changes.agent } : {}),
					...(changes.retries !== undefined ? { retries: changes.retries } : {}),
					updatedAt: new Date().toISOString()
				}
			}
		};
		await this.writeMissionControlState(missionDir, nextState);
	}

	private getArtifactPath(missionDir: string, artifact: MissionProductKey): string {
		return path.join(missionDir, MISSION_ARTIFACTS[artifact]);
	}

	private getTaskPath(missionDir: string, stage: MissionStageId, fileName: string): string {
		return path.join(this.getStageTasksPath(missionDir, stage), fileName);
	}

	private async writeMissionControlState(
		missionDir: string,
		state: MissionControlState
	): Promise<void> {
		const filePath = this.getMissionControlStatePath(missionDir);
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
	}

	private parseMissionControlState(rawState: unknown, filePath: string): MissionControlState {
		if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
			throw new ArtifactFormatError(`Mission control state '${filePath}' must be a JSON object.`);
		}

		const candidateState = rawState as {
			schemaVersion?: unknown;
			updatedAt?: unknown;
			deliveredAt?: unknown;
			tasks?: unknown;
		};
		if (candidateState.schemaVersion !== MISSION_CONTROL_SCHEMA_VERSION) {
			throw new ArtifactTypeError(
				`Mission control state '${filePath}' has unsupported schema version '${String(candidateState.schemaVersion)}'.`
			);
		}
		if (typeof candidateState.updatedAt !== 'string' || candidateState.updatedAt.trim().length === 0) {
			throw new ArtifactTypeError(`Mission control state '${filePath}' is missing updatedAt.`);
		}
		if (
			candidateState.tasks === undefined ||
			typeof candidateState.tasks !== 'object' ||
			candidateState.tasks === null ||
			Array.isArray(candidateState.tasks)
		) {
			throw new ArtifactTypeError(`Mission control state '${filePath}' must contain a tasks object.`);
		}

		const tasks: Record<string, MissionTaskControlState> = {};
		for (const [taskId, rawTaskState] of Object.entries(candidateState.tasks)) {
			if (!rawTaskState || typeof rawTaskState !== 'object' || Array.isArray(rawTaskState)) {
				throw new ArtifactTypeError(
					`Mission control state '${filePath}' task '${taskId}' must be an object.`
				);
			}

			const candidateTaskState = rawTaskState as {
				status?: unknown;
				agent?: unknown;
				retries?: unknown;
				updatedAt?: unknown;
			};
			if (!isMissionTaskStatus(candidateTaskState.status)) {
				throw new ArtifactTypeError(
					`Mission control state '${filePath}' task '${taskId}' has invalid status '${String(candidateTaskState.status)}'.`
				);
			}
			if (!isMissionTaskAgent(candidateTaskState.agent)) {
				throw new ArtifactTypeError(
					`Mission control state '${filePath}' task '${taskId}' has invalid agent '${String(candidateTaskState.agent)}'.`
				);
			}
			if (
				typeof candidateTaskState.retries !== 'number' ||
				!Number.isFinite(candidateTaskState.retries)
			) {
				throw new ArtifactTypeError(
					`Mission control state '${filePath}' task '${taskId}' has invalid retries '${String(candidateTaskState.retries)}'.`
				);
			}
			if (
				typeof candidateTaskState.updatedAt !== 'string' ||
				candidateTaskState.updatedAt.trim().length === 0
			) {
				throw new ArtifactTypeError(
					`Mission control state '${filePath}' task '${taskId}' is missing updatedAt.`
				);
			}

			tasks[taskId] = {
				status: candidateTaskState.status,
				agent: candidateTaskState.agent,
				retries: candidateTaskState.retries,
				updatedAt: candidateTaskState.updatedAt
			};
		}

		return {
			schemaVersion: MISSION_CONTROL_SCHEMA_VERSION,
			updatedAt: candidateState.updatedAt,
			...(typeof candidateState.deliveredAt === 'string' && candidateState.deliveredAt.trim().length > 0
				? { deliveredAt: candidateState.deliveredAt }
				: {}),
			tasks
		};
	}

	private isMissionControlStateEqual(
		left: MissionControlState,
		right: MissionControlState
	): boolean {
		return JSON.stringify(left) === JSON.stringify(right);
	}

	private async listTaskFileNames(missionDir: string, stage: MissionStageId): Promise<string[]> {
		const stagePath = this.getStageTasksPath(missionDir, stage);
		const entries = await fs.readdir(stagePath, { withFileTypes: true }).catch(() => []);
		return entries
			.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
			.map((entry) => entry.name)
			.sort((left, right) => this.compareTaskFiles(left, right));
	}

	private createTaskId(stage: MissionStageId, fileName: string): string {
		return `${stage}/${path.basename(fileName, '.md')}`;
	}

	private createTaskControlState(
		overrides: Partial<Pick<MissionTaskControlState, 'status' | 'agent' | 'retries'>> = {}
	): MissionTaskControlState {
		return {
			status: overrides.status ?? 'todo',
			agent: overrides.agent ?? 'default',
			retries: overrides.retries ?? 0,
			updatedAt: new Date().toISOString()
		};
	}

	private renderTaskDocument(subject: string, instruction: string, dependsOn: string[] = []): string {
		const body = [
			`# ${subject}`,
			'',
			instruction,
			'',
			'Use the product artifacts in this mission folder as the canonical context boundary.',
			''
		].join('\n');

		if (dependsOn.length > 0) {
			return this.renderDocument({ dependsOn }, body);
		}

		return body;
	}

	private resolveMissionDirFromTask(task: MissionTaskState): string {
		return path.resolve(task.filePath, ...task.relativePath.split('/').map(() => '..'));
	}

	private async readLegacyMissionDeliveredAt(missionDir: string): Promise<string | undefined> {
		const brief = await this.readArtifactRecord(missionDir, 'brief');
		if (!brief) {
			return undefined;
		}

		return this.readOptionalStringAttribute(brief.attributes, 'deliveredAt', brief.filePath);
	}

	private async readLegacyTaskControlState(
		missionDir: string,
		stage: MissionStageId,
		fileName: string
	): Promise<MissionTaskControlState> {
		const filePath = this.getTaskPath(missionDir, stage, fileName);
		const content = await fs.readFile(filePath, 'utf8');
		const document = parseFrontmatterDocument(content);
		return this.createTaskControlState({
			status: this.readTaskStatus(document.attributes, filePath),
			agent: this.readTaskAgent(document.attributes, filePath),
			retries: this.readTaskRetries(document.attributes, filePath)
		});
	}

	private async readTaskStateInternal(
		missionDir: string,
		stage: MissionStageId,
		filePath: string,
		fileName: string,
		sequenceFallback: number,
		controlState: MissionControlState
	): Promise<MissionTaskState> {
		const content = await fs.readFile(filePath, 'utf8');
		const document = parseFrontmatterDocument(content);
		const body = document.body;
		const sequence = this.parseTaskSequence(fileName, sequenceFallback);
		const parsedTaskBody = this.parseTaskBody(body, fileName);
		const taskId = this.createTaskId(stage, fileName);
		const taskControlState = controlState.tasks[taskId];
		if (!taskControlState) {
			throw new ArtifactFormatError(`Mission control state is missing task '${taskId}'.`);
		}

		return {
			taskId,
			stage,
			sequence,
			subject: parsedTaskBody.subject,
			instruction: parsedTaskBody.instruction,
			body,
			dependsOn: this.readTaskDependsOn(document.attributes, filePath),
			blockedBy: [],
			status: taskControlState.status,
			agent: taskControlState.agent,
			retries: taskControlState.retries,
			fileName,
			filePath,
			relativePath: path.relative(missionDir, filePath).split(path.sep).join('/')
		};
	}

	private readTaskStatus(attributes: Record<string, FrontmatterValue>, filePath: string): MissionTaskStatus {
		const value = attributes['status'];
		if (value === undefined) {
			return 'todo';
		}
		if (!isMissionTaskStatus(value)) {
			throw new ArtifactTypeError(`Task '${filePath}' has invalid status '${String(value)}'.`);
		}
		return value;
	}

	private readTaskAgent(attributes: Record<string, FrontmatterValue>, filePath: string): MissionTaskAgent {
		const value = attributes['agent'];
		if (value === undefined) {
			return 'default';
		}
		if (!isMissionTaskAgent(value)) {
			throw new ArtifactTypeError(`Task '${filePath}' has invalid agent '${String(value)}'.`);
		}
		return value;
	}

	private readTaskRetries(attributes: Record<string, FrontmatterValue>, filePath: string): number {
		const value = attributes['retries'];
		if (value === undefined) {
			return 0;
		}
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			throw new ArtifactTypeError(`Task '${filePath}' has invalid retries '${String(value)}'.`);
		}
		return value;
	}

	private readTaskDependsOn(
		attributes: Record<string, FrontmatterValue>,
		filePath: string
	): string[] {
		const value = attributes['dependsOn'];
		if (value === undefined) {
			return [];
		}

		const entries = Array.isArray(value) ? value : [value];
		const dependencies = entries.map((entry) => {
			if (typeof entry !== 'string') {
				throw new ArtifactTypeError(
					`Task '${filePath}' dependsOn entries must be strings, received '${String(entry)}'.`
				);
			}

			return entry.trim();
		});

		return dependencies.filter((entry) => entry.length > 0);
	}

	private readOptionalStringAttribute(
		attributes: Record<string, FrontmatterValue>,
		key: string,
		filePath: string
	): string | undefined {
		const value = attributes[key];
		if (value === undefined) {
			return undefined;
		}
		if (typeof value !== 'string') {
			throw new ArtifactTypeError(`Artifact '${filePath}' expected '${key}' to be a string.`);
		}
		return value.trim().length > 0 ? value.trim() : undefined;
	}

	private readOptionalNumberAttribute(
		attributes: Record<string, FrontmatterValue>,
		key: string,
		filePath: string
	): number | undefined {
		const value = attributes[key];
		if (value === undefined) {
			return undefined;
		}
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			throw new ArtifactTypeError(`Artifact '${filePath}' expected '${key}' to be a number.`);
		}
		return value;
	}

	private readMissionTypeAttribute(
		attributes: Record<string, FrontmatterValue>,
		key: string,
		filePath: string
	): MissionType | undefined {
		const value = attributes[key];
		if (value === undefined) {
			return undefined;
		}
		if (
			value !== 'feature' &&
			value !== 'fix' &&
			value !== 'docs' &&
			value !== 'refactor' &&
			value !== 'task'
		) {
			throw new ArtifactTypeError(`Artifact '${filePath}' has invalid mission type '${String(value)}'.`);
		}
		return value;
	}

	private extractBriefBody(body: string): string {
		const lines = body.trim().split(/\r?\n/u);
		if (lines[0]?.trim().startsWith('# BRIEF:')) {
			lines.shift();
		}

		while (lines[0] !== undefined && lines[0].trim().length === 0) {
			lines.shift();
		}

		if (lines[0]?.trim().startsWith('Issue:')) {
			lines.shift();
		}

		while (lines[0] !== undefined && lines[0].trim().length === 0) {
			lines.shift();
		}

		return lines.join('\n').trim();
	}

	private renderDocument(attributes: Record<string, FrontmatterValue>, body: string): string {
		if (Object.keys(attributes).length === 0) {
			return `${body.trimEnd()}\n`;
		}
		return renderFrontmatterDocument(attributes, body);
	}

	private parseTaskBody(body: string, fileName: string): { subject: string; instruction: string } {
		const lines = body.trim().split(/\r?\n/u);
		let subject: string | undefined;
		if (lines[0]?.trim().startsWith('#')) {
			subject = lines.shift()?.replace(/^#+\s*/u, '').trim();
		}

		for (const rawLine of body.split(/\r?\n/u)) {
			const line = rawLine.trim();
			if (!line) {
				continue;
			}

			if (!subject) {
				subject = line.startsWith('#') ? line.replace(/^#+\s*/u, '').trim() : line;
			}
			break;
		}

		while (lines[0] !== undefined && lines[0].trim().length === 0) {
			lines.shift();
		}

		if (!subject || subject.length === 0) {
			subject = path
				.basename(fileName, '.md')
				.replace(/^\d+[-_]?/u, '')
				.split(/[-_]+/u)
				.filter(Boolean)
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join(' ');
		}

		const instruction = lines.join('\n').trim();
		if (!subject) {
			throw new ArtifactFormatError(`Task '${fileName}' is missing a subject.`);
		}

		return {
			subject,
			instruction
		};
	}

	private parseTaskSequence(fileName: string, fallback: number): number {
		const match = /^(\d+)/u.exec(fileName);
		return match ? Number(match[1]) : fallback;
	}

	private resolveTaskDependencies(tasks: MissionTaskState[]): MissionTaskState[] {
		return tasks.map((task, index) => {
			const dependsOn =
				task.dependsOn.length > 0
					? this.resolveExplicitTaskDependencies(task, tasks)
					: this.resolveDefaultTaskDependencies(index, tasks);
			const blockedBy = dependsOn.filter((dependencyTaskId) => {
				const dependency = tasks.find((candidate) => candidate.taskId === dependencyTaskId);
				return dependency?.status !== 'done';
			});

			return {
				...task,
				dependsOn,
				blockedBy
			};
		});
	}

	private resolveDefaultTaskDependencies(index: number, tasks: MissionTaskState[]): string[] {
		const previousTask = index > 0 ? tasks[index - 1] : undefined;
		return previousTask ? [previousTask.taskId] : [];
	}

	private resolveExplicitTaskDependencies(
		task: MissionTaskState,
		tasks: MissionTaskState[]
	): string[] {
		return [
			...new Set(task.dependsOn.map((dependency) => this.resolveTaskDependencyReference(task, dependency, tasks)))
		];
	}

	private resolveTaskDependencyReference(
		task: MissionTaskState,
		dependency: string,
		tasks: MissionTaskState[]
	): string {
		const trimmedDependency = dependency.trim();
		const matches = tasks.filter((candidate) => {
			const fileStem = path.basename(candidate.fileName, '.md');
			return (
				candidate.taskId === trimmedDependency ||
				candidate.fileName === trimmedDependency ||
				fileStem === trimmedDependency ||
				candidate.taskId === `${task.stage}/${trimmedDependency}`
			);
		});

		if (matches.length === 0) {
			throw new ArtifactFormatError(
				`Task '${task.relativePath}' dependsOn '${trimmedDependency}', but no task in stage '${task.stage}' matches that reference.`
			);
		}

		if (matches.length > 1) {
			throw new ArtifactFormatError(
				`Task '${task.relativePath}' dependsOn '${trimmedDependency}', but that reference is ambiguous.`
			);
		}

		const dependencyTask = matches[0];
		if (!dependencyTask || dependencyTask.taskId === task.taskId) {
			throw new ArtifactFormatError(`Task '${task.relativePath}' cannot depend on itself.`);
		}

		return dependencyTask.taskId;
	}

	private compareTaskFiles(left: string, right: string): number {
		const leftSequence = this.parseTaskSequence(left, Number.MAX_SAFE_INTEGER);
		const rightSequence = this.parseTaskSequence(right, Number.MAX_SAFE_INTEGER);
		if (leftSequence !== rightSequence) {
			return leftSequence - rightSequence;
		}
		return left.localeCompare(right);
	}

	private slugify(value: string | undefined, maxLength: number): string {
		return (value ?? '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, maxLength);
	}

	private runGit(args: string[], cwd = this.repoRoot): string {
		const result = spawnSync('git', args, {
			cwd,
			encoding: 'utf8'
		});

		return result.status === 0 ? result.stdout.trim() : '';
	}

	private assertGit(args: string[], cwd = this.repoRoot): string {
		const result = spawnSync('git', args, {
			cwd,
			encoding: 'utf8'
		});

		if (result.status !== 0) {
			const stderr = result.stderr.trim();
			throw new Error(stderr || `git ${args.join(' ')} failed.`);
		}

		return result.stdout.trim();
	}

	private isMissingFileError(error: unknown): boolean {
		return error instanceof Error && 'code' in error && error.code === 'ENOENT';
	}
}