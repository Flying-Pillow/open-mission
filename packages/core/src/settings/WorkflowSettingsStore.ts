import * as fs from 'node:fs/promises';
import {
	getDefaultMissionDaemonSettingsWithOverrides,
	getMissionDaemonSettingsPath,
	type MissionDaemonSettings,
	writeMissionDaemonSettings
} from '../lib/daemonConfig.js';
import { DEFAULT_WORKFLOW_VERSION, createDefaultWorkflowSettings } from '../workflow/engine/defaultWorkflow.js';
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
	assertValidWorkflowSettings,
	normalizeWorkflowSettings
} from './validation.js';
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
	settings?: MissionDaemonSettings;
	workflowInitialized: boolean;
};

export class WorkflowSettingsStore {
	private readonly settingsPath: string;

	public constructor(private readonly controlRoot: string) {
		this.settingsPath = getMissionDaemonSettingsPath(controlRoot, { resolveWorkspaceRoot: false });
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

		const nextSettings = this.createInitializedSettings(state.settings);
		await this.persistSettings(nextSettings, state.revision.token);
		return this.get();
	}

	public async update(request: WorkflowSettingsUpdateRequest): Promise<WorkflowSettingsUpdateResult> {
		validateWorkflowSettingsPatch(request.patch);
		const state = await this.readFileState();
		this.assertRevisionMatches(request.expectedRevision, state.revision.token);

		const currentWorkflow = normalizeWorkflowSettings(state.settings?.workflow ?? createDefaultWorkflowSettings());
		const patchedWorkflow = applyWorkflowSettingsPatch(currentWorkflow, request.patch);
		const normalizedWorkflow = normalizeWorkflowSettings(patchedWorkflow);
		assertValidWorkflowSettings(normalizedWorkflow);

		const nextSettings = {
			...getDefaultMissionDaemonSettingsWithOverrides(state.settings ?? {}),
			workflow: normalizedWorkflow
		} satisfies MissionDaemonSettings;

		await this.persistSettings(nextSettings, request.expectedRevision);
		const result = await this.get();
		return {
			...result,
			changedPaths: request.patch.map((operation) => operation.path),
			context: request.context
		};
	}

	private async persistSettings(
		nextSettings: MissionDaemonSettings,
		expectedRevision: string
	): Promise<void> {
		const latestRevision = await readWorkflowSettingsRevision(this.settingsPath);
		this.assertRevisionMatches(expectedRevision, latestRevision.token);
		await writeMissionDaemonSettings(nextSettings, this.controlRoot, {
			resolveWorkspaceRoot: false
		});
	}

	private createInitializedSettings(currentSettings?: MissionDaemonSettings): MissionDaemonSettings {
		const baseSettings = getDefaultMissionDaemonSettingsWithOverrides(currentSettings ?? {});
		return {
			...baseSettings,
			workflow: createDefaultWorkflowSettings()
		};
	}

	private toGetResult(state: WorkflowSettingsFileState): WorkflowSettingsGetResult {
		const workflow = normalizeWorkflowSettings(state.settings?.workflow ?? createDefaultWorkflowSettings());
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
		if (!revision.exists) {
			return {
				settingsPath: this.settingsPath,
				revision,
				workflowInitialized: false
			};
		}

		let rawContent: string;
		try {
			rawContent = await fs.readFile(this.settingsPath, 'utf8');
		} catch (error) {
			throw this.toFileError(error);
		}

		const trimmed = rawContent.trim();
		if (trimmed.length === 0) {
			return {
				settingsPath: this.settingsPath,
				revision,
				workflowInitialized: false
			};
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch (error) {
			throw this.toFileError(error);
		}

		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new WorkflowSettingsError(
				'SETTINGS_FILE_INVALID',
				`Workflow settings file '${this.settingsPath}' must contain a JSON object.`
			);
		}

		const settings = parsed as MissionDaemonSettings;
		return {
			settingsPath: this.settingsPath,
			revision,
			settings,
			workflowInitialized: settings.workflow !== undefined
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