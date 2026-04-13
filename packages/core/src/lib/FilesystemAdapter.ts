import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
	parseFrontmatterDocument,
	renderFrontmatterDocument,
	type FrontmatterValue
} from './frontmatter.js';
import { getMissionCatalogPath, getMissionWorktreesPath } from './repoConfig.js';
import { readMissionDaemonSettings } from './daemonConfig.js';
import {
	MISSION_RUNTIME_FILE_NAME,
	type MissionBrief,
	type MissionDescriptor,
	type MissionArtifactKey,
	type MissionSelector,
	type MissionStageId,
	type MissionTaskAgent,
	type MissionTaskState,
	type MissionType
} from '../types.js';
import { renderMissionBriefBody } from '../templates/mission/index.js';
import {
	getMissionArtifactDefinition,
	getMissionStageDefinition
} from '../workflow/manifest.js';
import {
	createMissionRuntimeRecord,
	type MissionWorkflowConfigurationSnapshot,
	type MissionRuntimeRecord,
	MISSION_WORKFLOW_RUNTIME_SCHEMA_VERSION
} from '../workflow/engine/index.js';
import { DEFAULT_AGENT_RUNNER_ID, normalizeLegacyAgentRunnerId } from './agentRuntimes.js';

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
	artifact: MissionArtifactKey;
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
};

export type ResolvedMission = {
	missionDir: string;
	descriptor: MissionDescriptor;
};

export class FilesystemAdapter {
	public constructor(private readonly workspaceRoot: string) { }

	public getWorkspaceRoot(): string {
		return this.workspaceRoot;
	}

	public getMissionsPath(): string {
		const missionWorkspaceRoot = readMissionDaemonSettings(this.workspaceRoot)?.missionWorkspaceRoot;
		return getMissionWorktreesPath(
			this.workspaceRoot,
			missionWorkspaceRoot ? { missionWorkspaceRoot } : {}
		);
	}

	public getTrackedMissionsPath(checkoutRoot = this.workspaceRoot): string {
		return getMissionCatalogPath(checkoutRoot);
	}

	public getTrackedMissionDir(missionId: string, checkoutRoot = this.workspaceRoot): string {
		return path.join(this.getTrackedMissionsPath(checkoutRoot), missionId);
	}

	public getMissionWorktreePath(missionId: string): string {
		return path.join(this.getMissionsPath(), missionId);
	}

	public getMissionDir(missionId: string): string {
		return this.getTrackedMissionDir(missionId, this.getMissionWorktreePath(missionId));
	}

	public getMissionWorkspacePath(missionDir: string): string {
		return path.resolve(missionDir, '..', '..', '..');
	}

	public getMissionStagePath(missionDir: string, stage: MissionStageId): string {
		return path.join(missionDir, getMissionStageDefinition(stage).stageFolder);
	}

	public getTasksPath(missionDir: string): string {
		return missionDir;
	}

	public getStageTasksPath(missionDir: string, stage: MissionStageId): string {
		return path.join(this.getMissionStagePath(missionDir, stage), 'tasks');
	}

	public getCurrentBranch(startPath = this.workspaceRoot): string {
		return this.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], startPath);
	}

	public getDefaultBranch(startPath = this.workspaceRoot): string {
		const remoteHead = this.runGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], startPath);
		if (remoteHead) {
			const branch = remoteHead.split('/').filter(Boolean).pop();
			if (branch) {
				return branch;
			}
		}

		const currentBranch = this.getCurrentBranch(startPath);
		return currentBranch && currentBranch !== 'HEAD' ? currentBranch : 'main';
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

	public deriveRepositoryBootstrapBranchName(): string {
		const repositoryName = path.basename(this.workspaceRoot);
		const slug = this.slugify(repositoryName, 32);
		const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
		return slug.length > 0
			? `mission/bootstrap-${timestamp}-${slug}`
			: `mission/bootstrap-${timestamp}`;
	}

	public async materializeMissionWorktree(
		worktreePath: string,
		branchRef: string,
		baseRef = this.getDefaultBranch()
	): Promise<string> {
		const normalizedBranch = branchRef.trim();
		const normalizedBaseRef = baseRef.trim();
		if (!normalizedBranch) {
			throw new Error('Mission branch cannot be empty.');
		}
		if (!normalizedBaseRef) {
			throw new Error('Mission base branch cannot be empty.');
		}

		const existingMissionPath = await fs.lstat(worktreePath).then(
			(stats) => stats.isDirectory(),
			() => false
		);
		if (existingMissionPath) {
			throw new Error(`Mission worktree path '${worktreePath}' already exists.`);
		}

		await fs.mkdir(path.dirname(worktreePath), { recursive: true });

		const branchExists = this.runGit(['rev-parse', '--verify', `refs/heads/${normalizedBranch}`]);
		const remoteBranchExists = this.runGit(['rev-parse', '--verify', `refs/remotes/origin/${normalizedBranch}`]);
		try {
			if (branchExists) {
				this.assertGit(['worktree', 'add', worktreePath, normalizedBranch]);
			} else if (remoteBranchExists) {
				this.assertGit(['worktree', 'add', '-b', normalizedBranch, worktreePath, `origin/${normalizedBranch}`]);
			} else {
				this.assertGit(['worktree', 'add', '-b', normalizedBranch, worktreePath, normalizedBaseRef]);
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

		const nextBranch = this.getCurrentBranch(worktreePath);
		if (nextBranch !== normalizedBranch) {
			throw new Error(`Failed to materialize mission worktree for branch '${normalizedBranch}'.`);
		}

		return normalizedBranch;
	}

	public async materializeLinkedWorktree(
		worktreePath: string,
		branchRef: string,
		baseRef = this.getDefaultBranch()
	): Promise<string> {
		const normalizedBranch = branchRef.trim();
		const normalizedBaseRef = baseRef.trim();
		if (!normalizedBranch) {
			throw new Error('Mission branch cannot be empty.');
		}
		if (!normalizedBaseRef) {
			throw new Error('Mission base branch cannot be empty.');
		}

		const existingWorktree = await fs.lstat(worktreePath).then(
			(stats) => stats.isDirectory(),
			() => false
		);
		if (existingWorktree) {
			throw new Error(`Linked worktree path '${worktreePath}' already exists.`);
		}

		await fs.mkdir(path.dirname(worktreePath), { recursive: true });
		const branchExists = this.runGit(['rev-parse', '--verify', `refs/heads/${normalizedBranch}`]);
		try {
			if (branchExists) {
				this.assertGit(['worktree', 'add', worktreePath, normalizedBranch]);
			} else {
				this.assertGit(['worktree', 'add', '-b', normalizedBranch, worktreePath, normalizedBaseRef]);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes('already checked out')) {
				throw new Error(
					`Mission branch '${normalizedBranch}' is already checked out in another worktree. Switch that worktree away before using it again.`
				);
			}
			throw error;
		}

		const nextBranch = this.getCurrentBranch(worktreePath);
		if (nextBranch !== normalizedBranch) {
			throw new Error(`Failed to materialize linked worktree for branch '${normalizedBranch}'.`);
		}

		return normalizedBranch;
	}

	public async removeLinkedWorktree(worktreePath: string): Promise<void> {
		const exists = await fs.lstat(worktreePath).then(
			(stats) => stats.isDirectory() || stats.isSymbolicLink(),
			() => false
		);
		if (!exists) {
			return;
		}

		this.assertGit(['worktree', 'remove', '--force', worktreePath]);
	}

	public stagePaths(
		pathsToStage: string[],
		cwd = this.workspaceRoot,
		options: { force?: boolean } = {}
	): void {
		if (pathsToStage.length === 0) {
			return;
		}
		this.assertGit([
			'add',
			...(options.force ? ['-f'] : []),
			'--',
			...pathsToStage
		], cwd);
	}

	public commit(message: string, cwd = this.workspaceRoot): void {
		this.assertGit(['commit', '-m', message], cwd);
	}

	public pushBranch(branchRef: string, cwd = this.workspaceRoot): void {
		this.assertGit(['push', '--set-upstream', 'origin', branchRef], cwd);
	}

	public isWorktreeClean(cwd = this.workspaceRoot): boolean {
		return this.runGit(['status', '--porcelain'], cwd) === '';
	}

	public pullDefaultBranch(branchRef = this.getDefaultBranch(), cwd = this.workspaceRoot): void {
		this.assertGit(['pull', '--ff-only', 'origin', branchRef], cwd);
	}

	public createMissionId(brief: MissionBrief): string {
		const slug = this.slugify(brief.title, 48);
		if (brief.issueId !== undefined) {
			return slug.length > 0 ? `${String(brief.issueId)}-${slug}` : String(brief.issueId);
		}

		const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
		return slug.length > 0 ? `draft-${timestamp}-${slug}` : `draft-${timestamp}`;
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
		return this.listMissionDirectories(
			missionEntries
				.filter((entry) => entry.isDirectory())
				.map((entry) => this.getTrackedMissionDir(entry.name, path.join(this.getMissionsPath(), entry.name)))
		);
	}

	public async listTrackedMissions(checkoutRoot = this.workspaceRoot): Promise<ResolvedMission[]> {
		const missionEntries = await fs.readdir(this.getTrackedMissionsPath(checkoutRoot), { withFileTypes: true }).catch(() => []);
		return this.listMissionDirectories(
			missionEntries
				.filter((entry) => entry.isDirectory())
				.map((entry) => path.join(this.getTrackedMissionsPath(checkoutRoot), entry.name))
		);
	}

	public async resolveTrackedMission(selector: MissionSelector = {}): Promise<ResolvedMission | undefined> {
		const missions = await this.listTrackedMissions();
		return this.resolveMissionFromCandidates(missions, selector);
	}

	public async resolveKnownMission(selector: MissionSelector = {}): Promise<ResolvedMission | undefined> {
		const trackedMission = await this.resolveTrackedMission(selector);
		if (trackedMission) {
			return trackedMission;
		}
		return this.resolveMission(selector);
	}

	private async listMissionDirectories(missionDirs: string[]): Promise<ResolvedMission[]> {
		const missions: ResolvedMission[] = [];

		for (const missionDir of missionDirs) {
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
		return this.resolveMissionFromCandidates(missions, selector);
	}

	private resolveMissionFromCandidates(
		missions: ResolvedMission[],
		selector: MissionSelector = {}
	): ResolvedMission | undefined {
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
			this.readOptionalStringAttribute(brief.attributes, 'title', brief.filePath)
			?? this.extractBriefTitle(brief.body)
			?? path.basename(missionDir);
		const type = this.readMissionTypeAttribute(brief.attributes, 'type', brief.filePath) ?? 'task';
		const labels = this.readOptionalStringArrayAttribute(brief.attributes, 'labels', brief.filePath);
		const metadata = this.readOptionalStringRecordAttribute(brief.attributes, 'metadata', brief.filePath);
		const branchRef =
			this.readOptionalStringAttribute(brief.attributes, 'branchRef', brief.filePath) ??
			this.getCurrentBranch(this.getMissionWorkspacePath(missionDir)) ??
			'HEAD';
		const createdAt =
			this.readOptionalStringAttribute(brief.attributes, 'createdAt', brief.filePath) ??
			new Date().toISOString();
		const deliveredAt = this.readOptionalStringAttribute(brief.attributes, 'deliveredAt', brief.filePath);
		const url = this.readOptionalStringAttribute(brief.attributes, 'url', brief.filePath);

		return {
			missionId: path.basename(missionDir),
			missionDir,
			brief: {
				title,
				body: this.extractBriefBody(brief.body),
				type,
				...(issueId !== undefined ? { issueId } : {}),
				...(labels ? { labels } : {}),
				...(metadata ? { metadata } : {}),
				...(url ? { url } : {})
			},
			branchRef,
			createdAt,
			...(deliveredAt ? { deliveredAt } : {})
		};
	}

	public async writeMissionDescriptor(missionDir: string, descriptor: MissionDescriptor): Promise<void> {
		await this.writeArtifactRecord(missionDir, 'brief', {
			attributes: {
				...(descriptor.brief.issueId !== undefined ? { issueId: descriptor.brief.issueId } : {}),
				title: descriptor.brief.title,
				type: descriptor.brief.type,
				...(descriptor.brief.labels && descriptor.brief.labels.length > 0 ? { labels: descriptor.brief.labels } : {}),
				...(descriptor.brief.metadata ? { metadata: descriptor.brief.metadata } : {}),
				branchRef: descriptor.branchRef,
				createdAt: descriptor.createdAt,
				updatedAt: descriptor.createdAt,
				...(descriptor.deliveredAt ? { deliveredAt: descriptor.deliveredAt } : {}),
				...(descriptor.brief.url ? { url: descriptor.brief.url } : {})
			},
			body: await renderMissionBriefBody({
				brief: descriptor.brief,
				branchRef: descriptor.branchRef
			})
		});
	}

	public getMissionRuntimeRecordPath(missionDir: string): string {
		return path.join(missionDir, MISSION_RUNTIME_FILE_NAME);
	}

	public async readMissionRuntimeRecord(
		missionDir: string
	): Promise<MissionRuntimeRecord | undefined> {
		const filePath = this.getMissionRuntimeRecordPath(missionDir);
		try {
			const content = await fs.readFile(filePath, 'utf8');
			return this.parseMissionRuntimeRecord(JSON.parse(content) as unknown, filePath);
		} catch (error) {
			if (this.isMissingFileError(error)) {
				return undefined;
			}
			if (error instanceof SyntaxError) {
				throw new ArtifactFormatError(`Mission runtime record '${filePath}' is not valid JSON.`);
			}
			throw error;
		}
	}

	public async writeMissionRuntimeRecord(
		missionDir: string,
		record: MissionRuntimeRecord
	): Promise<void> {
		const filePath = this.getMissionRuntimeRecordPath(missionDir);
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		const temporaryPath = `${filePath}.${process.pid.toString(36)}.${Date.now().toString(36)}.tmp`;
		await fs.writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
		await fs.rename(temporaryPath, filePath);
	}

	public async initializeMissionRuntimeRecord(input: {
		missionDir: string;
		missionId: string;
		configuration: MissionWorkflowConfigurationSnapshot;
		createdAt?: string;
	}): Promise<MissionRuntimeRecord> {
		const record = createMissionRuntimeRecord({
			missionId: input.missionId,
			configuration: input.configuration,
			...(input.createdAt ? { createdAt: input.createdAt } : {})
		});
		await this.writeMissionRuntimeRecord(input.missionDir, record);
		return record;
	}

	public async artifactExists(missionDir: string, artifact: MissionArtifactKey): Promise<boolean> {
		try {
			await fs.stat(this.getArtifactPath(missionDir, artifact));
			return true;
		} catch {
			return false;
		}
	}

	public async readArtifactRecord(
		missionDir: string,
		artifact: MissionArtifactKey
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
		artifact: MissionArtifactKey,
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
		fileName: string
	): Promise<MissionTaskState | undefined> {
		try {
			const tasks = await this.listTaskStates(missionDir, stage);
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
		stage: MissionStageId
	): Promise<MissionTaskState[]> {
		const stagePath = this.getStageTasksPath(missionDir, stage);
		const fileNames = await this.listTaskFileNames(missionDir, stage);

		const tasks = await Promise.all(
			fileNames.map((fileName, index) =>
				this.readTaskStateInternal(
					missionDir,
					stage,
					path.join(stagePath, fileName),
					fileName,
					index + 1
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
			this.renderTaskDocument(record.subject, record.instruction, {
				...(record.dependsOn ? { dependsOn: record.dependsOn } : {}),
				agent: record.agent
			}),
			'utf8'
		);
	}

	private getArtifactPath(missionDir: string, artifact: MissionArtifactKey): string {
		const definition = getMissionArtifactDefinition(artifact);
		return definition.stageId
			? path.join(this.getMissionStagePath(missionDir, definition.stageId), definition.fileName)
			: path.join(missionDir, definition.fileName);
	}

	private getTaskPath(missionDir: string, stage: MissionStageId, fileName: string): string {
		return path.join(this.getStageTasksPath(missionDir, stage), fileName);
	}

	private parseMissionRuntimeRecord(
		rawDocument: unknown,
		filePath: string
	): MissionRuntimeRecord {
		if (!rawDocument || typeof rawDocument !== 'object' || Array.isArray(rawDocument)) {
			throw new ArtifactFormatError(`Mission runtime record '${filePath}' must be a JSON object.`);
		}

		const candidateDocument = rawDocument as {
			schemaVersion?: unknown;
			missionId?: unknown;
			configuration?: unknown;
			runtime?: unknown;
			eventLog?: unknown;
		};

		if (candidateDocument.schemaVersion !== MISSION_WORKFLOW_RUNTIME_SCHEMA_VERSION) {
			throw new ArtifactTypeError(
				`Mission runtime record '${filePath}' has unsupported schema version '${String(candidateDocument.schemaVersion)}'.`
			);
		}
		if (typeof candidateDocument.missionId !== 'string' || candidateDocument.missionId.trim().length === 0) {
			throw new ArtifactTypeError(`Mission runtime record '${filePath}' is missing missionId.`);
		}
		if (!candidateDocument.configuration || typeof candidateDocument.configuration !== 'object' || Array.isArray(candidateDocument.configuration)) {
			throw new ArtifactTypeError(`Mission runtime record '${filePath}' is missing configuration.`);
		}
		if (!candidateDocument.runtime || typeof candidateDocument.runtime !== 'object' || Array.isArray(candidateDocument.runtime)) {
			throw new ArtifactTypeError(`Mission runtime record '${filePath}' is missing runtime.`);
		}
		if (!Array.isArray(candidateDocument.eventLog)) {
			throw new ArtifactTypeError(`Mission runtime record '${filePath}' must contain an eventLog array.`);
		}

		return candidateDocument as MissionRuntimeRecord;
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

	private renderTaskDocument(
		subject: string,
		instruction: string,
		options: {
			dependsOn?: string[];
			agent?: MissionTaskAgent;
		} = {}
	): string {
		const body = [
			`# ${subject}`,
			'',
			instruction,
			'',
			'Use the product artifacts in this mission folder as the canonical context boundary.',
			''
		].join('\n');
		const attributes: Record<string, FrontmatterValue> = {};
		if (options.dependsOn && options.dependsOn.length > 0) {
			attributes['dependsOn'] = options.dependsOn;
		}
		if (options.agent) {
			attributes['agent'] = options.agent;
		}

		if (Object.keys(attributes).length > 0) {
			return this.renderDocument(attributes, body);
		}

		return body;
	}

	private async readTaskStateInternal(
		missionDir: string,
		stage: MissionStageId,
		filePath: string,
		fileName: string,
		sequenceFallback: number
	): Promise<MissionTaskState> {
		const content = await fs.readFile(filePath, 'utf8');
		const document = parseFrontmatterDocument(content);
		const body = document.body;
		const sequence = this.parseTaskSequence(fileName, sequenceFallback);
		const parsedTaskBody = this.parseTaskBody(body, fileName);
		const taskId = this.createTaskId(stage, fileName);
		const agent =
			normalizeLegacyAgentRunnerId(this.readOptionalStringAttribute(document.attributes, 'agent', filePath))
			?? DEFAULT_AGENT_RUNNER_ID;

		return {
			taskId,
			stage,
			sequence,
			subject: parsedTaskBody.subject,
			instruction: parsedTaskBody.instruction,
			body,
			dependsOn: this.readTaskDependsOn(document.attributes, filePath),
			blockedBy: [],
			status: 'pending',
			agent,
			retries: 0,
			fileName,
			filePath,
			relativePath: path.relative(missionDir, filePath).split(path.sep).join('/')
		};
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

	private readOptionalStringArrayAttribute(
		attributes: Record<string, FrontmatterValue>,
		key: string,
		filePath: string
	): string[] | undefined {
		const value = attributes[key];
		if (value === undefined) {
			return undefined;
		}

		const entries = Array.isArray(value) ? value : [value];
		const normalized = entries.map((entry) => {
			if (typeof entry !== 'string') {
				throw new ArtifactTypeError(`Artifact '${filePath}' expected '${key}' to contain only strings.`);
			}

			return entry.trim();
		}).filter((entry) => entry.length > 0);

		return normalized.length > 0 ? normalized : undefined;
	}

	private readOptionalStringRecordAttribute(
		attributes: Record<string, FrontmatterValue>,
		key: string,
		filePath: string
	): Record<string, string> | undefined {
		const value = attributes[key];
		if (value === undefined) {
			return undefined;
		}
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new ArtifactTypeError(`Artifact '${filePath}' expected '${key}' to be an object of strings.`);
		}

		const normalizedEntries = Object.entries(value).map(([entryKey, entryValue]) => {
			if (typeof entryValue !== 'string') {
				throw new ArtifactTypeError(`Artifact '${filePath}' expected '${key}.${entryKey}' to be a string.`);
			}
			return [entryKey, entryValue.trim()] as const;
		}).filter(([, entryValue]) => entryValue.length > 0);

		return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : undefined;
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

	private extractBriefTitle(body: string): string | undefined {
		const firstNonEmptyLine = body.split(/\r?\n/u).find((line) => line.trim().length > 0);
		if (!firstNonEmptyLine?.trim().startsWith('#')) {
			return undefined;
		}

		const heading = firstNonEmptyLine.replace(/^#+\s*/u, '').trim();
		if (heading.length === 0) {
			return undefined;
		}

		return heading.replace(/^BRIEF:\s*/u, '').trim() || undefined;
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
				return dependency?.status !== 'completed';
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

	private runGit(args: string[], cwd = this.workspaceRoot): string {
		const result = spawnSync('git', args, {
			cwd,
			encoding: 'utf8'
		});

		return result.status === 0 ? result.stdout.trim() : '';
	}

	private assertGit(args: string[], cwd = this.workspaceRoot): string {
		const result = spawnSync('git', args, {
			cwd,
			encoding: 'utf8'
		});

		if (result.status !== 0) {
			const stderr = result.stderr.trim();
			const stdout = result.stdout.trim();
			const detail = [stdout, stderr].filter(Boolean).join('\n');
			throw new Error(detail || `git ${args.join(' ')} failed.`);
		}

		return result.stdout.trim();
	}

	private isMissingFileError(error: unknown): boolean {
		return error instanceof Error && 'code' in error && error.code === 'ENOENT';
	}
}