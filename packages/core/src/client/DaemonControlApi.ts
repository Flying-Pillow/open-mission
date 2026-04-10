import type {
	ControlActionList,
	ControlActionDescribe,
	ControlDocumentRead,
	ControlDocumentResponse,
	ControlDocumentWrite,
	ControlIssuesList,
	ControlSettingsUpdate,
	ControlWorkflowSettingsInitialize,
	ControlWorkflowSettingsInitializeResponse,
	ControlWorkflowSettingsUpdate,
	ControlActionExecute,
	ControlWorkflowSettingsUpdateResponse
} from '../daemon/contracts.js';
import type { WorkflowSettingsGetResult } from '../settings/types.js';
import type {
	OperatorActionDescriptor,
	OperatorActionExecutionStep,
	OperatorActionFlowDescriptor,
	OperatorActionQueryContext,
	MissionRepositoryCandidate,
	OperatorStatus,
	TrackedIssueSummary
} from '../types.js';
import { DaemonClient } from './DaemonClient.js';
import type { ControlRepositoriesAdd } from '../daemon/contracts.js';

export class DaemonControlApi {
	public constructor(private readonly client: DaemonClient) { }

	public async getStatus(): Promise<OperatorStatus> {
		return this.client.request<OperatorStatus>('control.status');
	}

	public async listAvailableActions(context?: OperatorActionQueryContext): Promise<OperatorActionDescriptor[]> {
		const params: ControlActionList = context ? { context } : {};
		return this.client.request<OperatorActionDescriptor[]>('control.action.list', params);
	}

	public async executeAction(
		actionId: string,
		steps: OperatorActionExecutionStep[] = []
	): Promise<OperatorStatus> {
		const params: ControlActionExecute = {
			actionId,
			...(steps.length > 0 ? { steps } : {})
		};
		return this.client.request<OperatorStatus>('control.action.execute', params);
	}

	public async describeActionFlow(
		actionId: string,
		steps: OperatorActionExecutionStep[] = []
	): Promise<OperatorActionFlowDescriptor> {
		const params: ControlActionDescribe = {
			actionId,
			...(steps.length > 0 ? { steps } : {})
		};
		return this.client.request<OperatorActionFlowDescriptor>('control.action.describe', params);
	}

	public async updateSetting(
		field: ControlSettingsUpdate['field'],
		value: string
	): Promise<OperatorStatus> {
		return this.client.request<OperatorStatus>('control.settings.update', { field, value });
	}

	public async readDocument(filePath: string): Promise<ControlDocumentResponse> {
		const params: ControlDocumentRead = { filePath };
		return this.client.request<ControlDocumentResponse>('control.document.read', params);
	}

	public async writeDocument(filePath: string, content: string): Promise<ControlDocumentResponse> {
		const params: ControlDocumentWrite = { filePath, content };
		return this.client.request<ControlDocumentResponse>('control.document.write', params);
	}

	public async getWorkflowSettings(): Promise<WorkflowSettingsGetResult> {
		return this.client.request<WorkflowSettingsGetResult>('control.workflow.settings.get');
	}

	public async initializeWorkflowSettings(
		params: ControlWorkflowSettingsInitialize = {}
	): Promise<ControlWorkflowSettingsInitializeResponse> {
		return this.client.request<ControlWorkflowSettingsInitializeResponse>(
			'control.workflow.settings.initialize',
			params
		);
	}

	public async updateWorkflowSettings(
		params: ControlWorkflowSettingsUpdate
	): Promise<ControlWorkflowSettingsUpdateResponse> {
		return this.client.request<ControlWorkflowSettingsUpdateResponse>(
			'control.workflow.settings.update',
			params
		);
	}

	public async listOpenIssues(
		limit = 50
	): Promise<TrackedIssueSummary[]> {
		const params: ControlIssuesList = { limit };
		return this.client.request<TrackedIssueSummary[]>('control.issues.list', params);
	}

	public async listRegisteredRepositories(): Promise<MissionRepositoryCandidate[]> {
		return this.client.request<MissionRepositoryCandidate[]>('control.repositories.list');
	}

	public async addRepository(repositoryPath: string): Promise<MissionRepositoryCandidate> {
		const params: ControlRepositoriesAdd = { repositoryPath };
		return this.client.request<MissionRepositoryCandidate>('control.repositories.add', params);
	}
}