import type { WorkflowDefinition } from '../workflow/engine/types.js';
import type { RepositorySettingsType } from '../entities/Repository/RepositorySchema.js';

export type WorkflowSettingsRevisionToken = string;

export type WorkflowSettingsErrorCode =
	| 'SETTINGS_PATCH_INVALID'
	| 'SETTINGS_VALIDATION_FAILED'
	| 'SETTINGS_CONFLICT'
	| 'SETTINGS_FILE_INVALID'
	| 'SETTINGS_NOT_INITIALIZED'
	| 'SETTINGS_CONFIRMATION_REQUIRED';

export type WorkflowSettingsValidationError = {
	code: string;
	path: string;
	message: string;
};

export type JsonPatchOperation = {
	op: 'add' | 'remove' | 'replace';
	path: string;
	value?: unknown;
};

export type WorkflowSettingsMetadata = {
	workflowVersion: string;
	sourcePath: string;
	lastUpdatedAt: string;
	initialized: boolean;
};

export type WorkflowSettingsGetResult = {
	workflow: WorkflowDefinition;
	revision: WorkflowSettingsRevisionToken;
	metadata: WorkflowSettingsMetadata;
	warnings?: string[];
};

export type WorkflowSettingsInitializeRequest = {
	settings?: RepositorySettingsType;
	force?: boolean;
	confirmReinitialize?: boolean;
};

export type WorkflowSettingsInitializeResult = WorkflowSettingsGetResult;

export type WorkflowSettingsUpdateContext = {
	requestedBySurface: string;
	requestedBy: string;
	reason?: string;
};

export type WorkflowSettingsUpdateRequest = {
	patch: JsonPatchOperation[];
	expectedRevision: WorkflowSettingsRevisionToken;
	context: WorkflowSettingsUpdateContext;
};

export type WorkflowSettingsUpdateResult = WorkflowSettingsGetResult & {
	changedPaths: string[];
	context: WorkflowSettingsUpdateContext;
};

export class WorkflowSettingsError extends Error {
	public readonly code: WorkflowSettingsErrorCode;
	public readonly validationErrors?: WorkflowSettingsValidationError[];

	public constructor(
		code: WorkflowSettingsErrorCode,
		message: string,
		options: { validationErrors?: WorkflowSettingsValidationError[] } = {}
	) {
		super(message);
		this.name = 'WorkflowSettingsError';
		this.code = code;
		if (options.validationErrors) {
			this.validationErrors = options.validationErrors;
		}
	}
}
