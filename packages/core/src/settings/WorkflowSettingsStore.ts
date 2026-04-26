import {
	getRepositorySettingsPath,
	readRepositorySettingsDocument,
	resolveRepositorySettingsDocument,
	writeRepositorySettingsDocument
} from '../lib/daemonConfig.js';
import type { RepositorySettings } from '../schemas/RepositorySettings.js';
import {
	DEFAULT_WORKFLOW_VERSION,
	createDefaultWorkflowSettings
} from '../workflow/mission/workflow.js';
import type { WorkflowGlobalSettings } from '../workflow/WorkflowSchema.js';
import {
	assertValidWorkflowSettings,
	normalizeWorkflowSettings
} from './validation.js';
import {
	readMissionWorkflowDefinition,
	scaffoldMissionWorkflowPreset,
	writeMissionWorkflowDefinition
} from '../workflow/mission/preset.js';
import { getMissionWorkflowDefinitionPath } from '../lib/repositoryPaths.js';
import {
	applyWorkflowSettingsPatch,
	validateWorkflowSettingsPatch
} from './jsonPatch.js';
import {
	isWorkflowSettingsRevisionMatch,
	readWorkflowSettingsRevision,
	type WorkflowSettingsFileRevision
} from './revision.js';
import {
	WorkflowSettingsError,
	type WorkflowSettingsGetResult,
	type WorkflowSettingsInitializeRequest,
	type WorkflowSettingsInitializeResult,
	type WorkflowSettingsMetadata,
	type WorkflowSettingsUpdateRequest,
	type WorkflowSettingsUpdateResult
} from './types.js';

type WorkflowSettingsFileState = {
	settingsPath: string;
	revision: WorkflowSettingsFileRevision;
	document: RepositorySettings | undefined;
	workflow: WorkflowGlobalSettings;
	settingsInitialized: boolean;
	workflowInitialized: boolean;
};

export class WorkflowSettingsStore {
	private readonly settingsPath: string;
	private readonly workflowPath: string;

	public constructor(private readonly controlRoot: string) {
		this.settingsPath = getRepositorySettingsPath(controlRoot, { resolveWorkspaceRoot: false });
		this.workflowPath = getMissionWorkflowDefinitionPath(controlRoot);
	}

	public async get(): Promise<WorkflowSettingsGetResult> {
		const state = await this.readFileState();
		return this.toGetResult(state);
	}

	public async initialize(
		request: WorkflowSettingsInitializeRequest = {}
	): Promise<WorkflowSettingsInitializeResult> {
		const state = await this.readFileState();
		if (state.workflowInitialized && state.settingsInitialized && request.force !== true) {
			return this.toGetResult(state);
		}

		if (request.force === true && request.confirmReinitialize !== true) {
			throw new WorkflowSettingsError(
				'SETTINGS_CONFIRMATION_REQUIRED',
				'Workflow settings reinitialization requires confirmReinitialize=true.'
			);
		}

		const nextDocument = this.createInitializedDocument(state.document);
		await this.persistSettings(nextDocument, state.workflow, state.revision.token, request.force === true);
		return this.get();
	}

	public async update(request: WorkflowSettingsUpdateRequest): Promise<WorkflowSettingsUpdateResult> {
		validateWorkflowSettingsPatch(request.patch);
		const state = await this.readFileState();
		this.assertRevisionMatches(request.expectedRevision, state.revision.token);

		const currentWorkflow = state.workflow;
		const patchedWorkflow = applyWorkflowSettingsPatch(currentWorkflow, request.patch);
		const normalizedWorkflow = normalizeWorkflowSettings(patchedWorkflow);
		assertValidWorkflowSettings(normalizedWorkflow);

		const nextDocument = this.createInitializedDocument(state.document);

		await this.persistSettings(nextDocument, normalizedWorkflow, request.expectedRevision, false);
		const result = await this.get();
		return {
			...result,
			changedPaths: request.patch.map((operation) => operation.path),
			context: request.context
		};
	}

	private async persistSettings(
		nextDocument: RepositorySettings,
		workflow: WorkflowGlobalSettings,
		expectedRevision: string,
		overwritePreset: boolean
	): Promise<void> {
		const latestRevision = await readWorkflowSettingsRevision(this.workflowPath);
		this.assertRevisionMatches(expectedRevision, latestRevision.token);
		if (overwritePreset || !latestRevision.exists) {
			await scaffoldMissionWorkflowPreset(this.controlRoot, { overwrite: overwritePreset });
		}
		await writeRepositorySettingsDocument(nextDocument, this.controlRoot, {
			resolveWorkspaceRoot: false
		});
		await writeMissionWorkflowDefinition(this.controlRoot, workflow);
	}

	private createInitializedDocument(currentDocument?: RepositorySettings): RepositorySettings {
		return resolveRepositorySettingsDocument(currentDocument ?? {});
	}

	private toGetResult(state: WorkflowSettingsFileState): WorkflowSettingsGetResult {
		assertValidWorkflowSettings(state.workflow);
		const warnings: string[] = [];
		if (!state.workflowInitialized) {
			warnings.push('Repository workflow settings are not initialized on disk; defaults are being used.');
		}
		if (!state.settingsInitialized) {
			warnings.push('Repository settings are not initialized on disk; defaults are being used.');
		}

		return {
			workflow: state.workflow,
			revision: state.revision.token,
			metadata: this.createMetadata(state),
			...(warnings.length > 0 ? { warnings } : {})
		};
	}

	private createMetadata(state: WorkflowSettingsFileState): WorkflowSettingsMetadata {
		return {
			workflowVersion: DEFAULT_WORKFLOW_VERSION,
			sourcePath: this.workflowPath,
			lastUpdatedAt: state.revision.lastUpdatedAt,
			initialized: state.workflowInitialized
		};
	}

	private async readFileState(): Promise<WorkflowSettingsFileState> {
		const revision = await readWorkflowSettingsRevision(this.workflowPath);

		let document: RepositorySettings | undefined;
		try {
			document = readRepositorySettingsDocument(this.controlRoot, {
				resolveWorkspaceRoot: false
			});
		} catch (error) {
			if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
				throw this.toFileError(error);
			}
		}

		const persistedWorkflow = readMissionWorkflowDefinition(this.controlRoot);
		const workflow = normalizeWorkflowSettings(persistedWorkflow ?? createDefaultWorkflowSettings());

		if (!revision.exists) {
			return {
				settingsPath: this.settingsPath,
				revision,
				document,
				workflow,
				settingsInitialized: document !== undefined,
				workflowInitialized: false
			};
		}
		return {
			settingsPath: this.settingsPath,
			revision,
			document,
			workflow,
			settingsInitialized: document !== undefined,
			workflowInitialized: persistedWorkflow !== undefined
		};
	}

	private assertRevisionMatches(expectedRevision: string, actualRevision: string): void {
		if (!isWorkflowSettingsRevisionMatch(expectedRevision, actualRevision)) {
			throw new WorkflowSettingsError(
				'SETTINGS_CONFLICT',
				'Repository workflow settings changed on disk. Fetch the latest settings before retrying.'
			);
		}
	}

	private toFileError(error: unknown): WorkflowSettingsError {
		if (error instanceof WorkflowSettingsError) {
			return error;
		}

		return new WorkflowSettingsError(
			'SETTINGS_FILE_INVALID',
			error instanceof Error
				? `Workflow settings file '${this.settingsPath}' is invalid: ${error.message}`
				: `Workflow settings file '${this.settingsPath}' is invalid.`
		);
	}
}