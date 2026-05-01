import { Repository } from '../entities/Repository/Repository.js';
import {
	createDefaultRepositorySettings,
	type RepositorySettingsType
} from '../entities/Repository/RepositorySchema.js';
import {
	DEFAULT_WORKFLOW_VERSION,
	createDefaultWorkflowSettings
} from '../workflow/mission/workflow.js';
import type { WorkflowDefinition } from '../workflow/WorkflowSchema.js';
import {
	assertValidWorkflowSettings,
	normalizeWorkflowSettings,
	parsePersistedWorkflowSettings
} from './validation.js';
import {
	readMissionWorkflowDefinition,
	scaffoldMissionWorkflowPreset,
	writeMissionWorkflowDefinition
} from '../workflow/mission/preset.js';
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
	document: RepositorySettingsType | undefined;
	workflow: WorkflowDefinition;
	settingsInitialized: boolean;
	workflowInitialized: boolean;
};

export class WorkflowSettingsStore {
	private readonly settingsPath: string;
	private readonly workflowPath: string;

	public constructor(private readonly controlRoot: string) {
		this.settingsPath = Repository.getSettingsDocumentPath(controlRoot, { resolveWorkspaceRoot: false });
		this.workflowPath = Repository.getMissionWorkflowDefinitionPath(controlRoot);
	}

	public async get(): Promise<WorkflowSettingsGetResult> {
		const state = await this.readFileState();
		return this.toGetResult(state);
	}

	public async initialize(
		request: WorkflowSettingsInitializeRequest = {}
	): Promise<WorkflowSettingsInitializeResult> {
		const state = await this.readFileState({ allowUninitialized: true });
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
		const persistedWorkflow = parsePersistedWorkflowSettings(patchedWorkflow);

		const nextDocument = this.createInitializedDocument(state.document);

		await this.persistSettings(nextDocument, persistedWorkflow, request.expectedRevision, false);
		const result = await this.get();
		return {
			...result,
			changedPaths: request.patch.map((operation) => operation.path),
			context: request.context
		};
	}

	private async persistSettings(
		nextDocument: RepositorySettingsType,
		workflow: WorkflowDefinition,
		expectedRevision: string,
		overwritePreset: boolean
	): Promise<void> {
		const latestRevision = await readWorkflowSettingsRevision(this.workflowPath);
		this.assertRevisionMatches(expectedRevision, latestRevision.token);
		if (overwritePreset || !latestRevision.exists) {
			await scaffoldMissionWorkflowPreset(this.controlRoot, { overwrite: overwritePreset });
		}
		await Repository.writeSettingsDocument(nextDocument, this.controlRoot, {
			resolveWorkspaceRoot: false
		});
		await writeMissionWorkflowDefinition(this.controlRoot, workflow);
	}

	private createInitializedDocument(currentDocument?: RepositorySettingsType): RepositorySettingsType {
		if (currentDocument) {
			return Repository.resolveSettingsDocument(currentDocument);
		}
		return Repository.resolveSettingsDocument(createDefaultRepositorySettings());
	}

	private toGetResult(state: WorkflowSettingsFileState): WorkflowSettingsGetResult {
		assertValidWorkflowSettings(state.workflow);
		return {
			workflow: state.workflow,
			revision: state.revision.token,
			metadata: this.createMetadata(state)
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

	private async readFileState(options: { allowUninitialized?: boolean } = {}): Promise<WorkflowSettingsFileState> {
		const revision = await readWorkflowSettingsRevision(this.workflowPath);

		let document: RepositorySettingsType | undefined;
		try {
			document = Repository.readSettingsDocument(this.controlRoot, {
				resolveWorkspaceRoot: false
			});
		} catch (error) {
			if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
				throw this.toFileError(error);
			}
		}

		const persistedWorkflow = readMissionWorkflowDefinition(this.controlRoot);
		if (!document && options.allowUninitialized !== true) {
			throw new WorkflowSettingsError(
				'SETTINGS_NOT_INITIALIZED',
				`Repository settings document '${this.settingsPath}' is required.`
			);
		}
		if (!persistedWorkflow && options.allowUninitialized !== true) {
			throw new WorkflowSettingsError(
				'SETTINGS_NOT_INITIALIZED',
				`Repository workflow definition '${this.workflowPath}' is required.`
			);
		}
		const workflowSource = persistedWorkflow
			? persistedWorkflow
			: createDefaultWorkflowSettings();
		const workflow = persistedWorkflow
			? parsePersistedWorkflowSettings(workflowSource)
			: normalizeWorkflowSettings(workflowSource);

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