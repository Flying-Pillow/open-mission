import {
	getWorkflowSettingsDocumentPath,
	readWorkflowSettingsDocument,
	resolveWorkflowSettingsDocument,
	writeWorkflowSettingsDocument
} from '../lib/daemonConfig.js';
import type { RepositoryWorkflowSettingsDocument as WorkflowSettingsDocument } from '../entities/Repository/RepositorySettingsDocument.js';
import {
	DEFAULT_WORKFLOW_VERSION,
	assertValidWorkflowSettings,
	createDefaultWorkflowSettings,
	normalizeWorkflowSettings
} from '../workflow/mission/workflow.js';
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
	document: WorkflowSettingsDocument | undefined;
	workflowInitialized: boolean;
};

export class WorkflowSettingsStore {
	private readonly settingsPath: string;

	public constructor(private readonly controlRoot: string) {
		this.settingsPath = getWorkflowSettingsDocumentPath(controlRoot, { resolveWorkspaceRoot: false });
	}

	public async get(): Promise<WorkflowSettingsGetResult> {
		const state = await this.readFileState();
		return this.toGetResult(state);
	}

	public async initialize(
		request: WorkflowSettingsInitializeRequest = {}
	): Promise<WorkflowSettingsInitializeResult> {
		const state = await this.readFileState();
		if (state.workflowInitialized && request.force !== true) {
			return this.toGetResult(state);
		}

		if (request.force === true && request.confirmReinitialize !== true) {
			throw new WorkflowSettingsError(
				'SETTINGS_CONFIRMATION_REQUIRED',
				'Workflow settings reinitialization requires confirmReinitialize=true.'
			);
		}

		const nextDocument = this.createInitializedDocument(state.document);
		await this.persistSettings(nextDocument, state.revision.token, request.force === true);
		return this.get();
	}

	public async update(request: WorkflowSettingsUpdateRequest): Promise<WorkflowSettingsUpdateResult> {
		validateWorkflowSettingsPatch(request.patch);
		const state = await this.readFileState();
		this.assertRevisionMatches(request.expectedRevision, state.revision.token);

		const currentWorkflow = normalizeWorkflowSettings(state.document?.workflow ?? createDefaultWorkflowSettings());
		const patchedWorkflow = applyWorkflowSettingsPatch(currentWorkflow, request.patch);
		const normalizedWorkflow = normalizeWorkflowSettings(patchedWorkflow);
		assertValidWorkflowSettings(normalizedWorkflow);

		const nextDocument = resolveWorkflowSettingsDocument({
			...(state.document ?? {}),
			workflow: normalizedWorkflow
		});

		await this.persistSettings(nextDocument, request.expectedRevision, false);
		const result = await this.get();
		return {
			...result,
			changedPaths: request.patch.map((operation) => operation.path),
			context: request.context
		};
	}

	private async persistSettings(
		nextDocument: WorkflowSettingsDocument,
		expectedRevision: string,
		overwritePreset: boolean
	): Promise<void> {
		const latestRevision = await readWorkflowSettingsRevision(this.settingsPath);
		this.assertRevisionMatches(expectedRevision, latestRevision.token);
		if (overwritePreset || !latestRevision.exists) {
			await scaffoldMissionWorkflowPreset(this.controlRoot, { overwrite: overwritePreset });
		}
		await writeWorkflowSettingsDocument(nextDocument, this.controlRoot, {
			resolveWorkspaceRoot: false
		});
		await writeMissionWorkflowDefinition(this.controlRoot, nextDocument.workflow);
	}

	private createInitializedDocument(currentDocument?: WorkflowSettingsDocument): WorkflowSettingsDocument {
		return resolveWorkflowSettingsDocument({
			...(currentDocument ?? {}),
			workflow: normalizeWorkflowSettings(
				currentDocument?.workflow ?? readMissionWorkflowDefinition(this.controlRoot) ?? createDefaultWorkflowSettings()
			)
		});
	}

	private toGetResult(state: WorkflowSettingsFileState): WorkflowSettingsGetResult {
		const workflow = normalizeWorkflowSettings(state.document?.workflow ?? createDefaultWorkflowSettings());
		assertValidWorkflowSettings(workflow);
		const warnings: string[] = [];
		if (!state.workflowInitialized) {
			warnings.push('Repository workflow settings are not initialized on disk; defaults are being used.');
		}

		return {
			workflow,
			revision: state.revision.token,
			metadata: this.createMetadata(state),
			...(warnings.length > 0 ? { warnings } : {})
		};
	}

	private createMetadata(state: WorkflowSettingsFileState): WorkflowSettingsMetadata {
		return {
			workflowVersion: DEFAULT_WORKFLOW_VERSION,
			sourcePath: state.settingsPath,
			lastUpdatedAt: state.revision.lastUpdatedAt,
			initialized: state.workflowInitialized
		};
	}

	private async readFileState(): Promise<WorkflowSettingsFileState> {
		const revision = await readWorkflowSettingsRevision(this.settingsPath);

		let document: WorkflowSettingsDocument | undefined;
		try {
			document = readWorkflowSettingsDocument(this.controlRoot, {
				resolveWorkspaceRoot: false
			});
		} catch (error) {
			if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
				throw this.toFileError(error);
			}
		}

		if (!revision.exists) {
			return {
				settingsPath: this.settingsPath,
				revision,
				document,
				workflowInitialized: false
			};
		}
		return {
			settingsPath: this.settingsPath,
			revision,
			document,
			workflowInitialized: document !== undefined
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