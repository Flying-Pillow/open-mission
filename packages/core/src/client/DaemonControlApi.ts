import type {
	ControlActionList,
	ControlActionDescribe,
	ControlIssuesList,
	ControlDocumentRead,
	ControlDocumentResponse,
	ControlDocumentWrite,
	ControlSettingsUpdate,
	ControlWorkflowSettingsInitialize,
	ControlWorkflowSettingsInitializeResponse,
	ControlWorkflowSettingsUpdate,
	ControlActionExecute,
	ControlWorkflowSettingsUpdateResponse
} from '../daemon/protocol/contracts.js';
import type { WorkflowSettingsGetResult } from '../settings/types.js';
import type {
	GitHubIssueDetail,
	GitHubVisibleRepository,
	OperatorActionDescriptor,
	OperatorActionListSnapshot,
	OperatorActionExecutionStep,
	OperatorActionFlowDescriptor,
	OperatorActionQueryContext,
	TrackedIssueSummary,
	OperatorStatus
} from '../types.js';
import { DaemonClient } from './DaemonClient.js';
import type { Repository } from '../entities/Repository/Repository.js';
import type {
	ControlStatus,
	ControlGitHubIssueDetail,
	ControlGitHubRepositoriesClone,
	ControlRepositoriesAdd
} from '../daemon/protocol/contracts.js';

export class DaemonControlApi {
	public constructor(private readonly client: DaemonClient) { }

	public async getStatus(options: ControlStatus = {}): Promise<OperatorStatus> {
		const params = options.includeMissions === false ? { includeMissions: false } : undefined;
		return this.client.request<OperatorStatus>('control.status', params);
	}

	public async listAvailableActions(context?: OperatorActionQueryContext): Promise<OperatorActionDescriptor[]> {
		const snapshot = await this.listAvailableActionsSnapshot(context);
		return snapshot.actions;
	}

	public async listAvailableActionsSnapshot(context?: OperatorActionQueryContext): Promise<OperatorActionListSnapshot> {
		const params: ControlActionList = context ? { context } : {};
		return this.client.request<OperatorActionListSnapshot>('control.action.list', params);
	}

	public async listOpenIssues(limit = 50): Promise<TrackedIssueSummary[]> {
		const params: ControlIssuesList = { limit };
		return this.client.request<TrackedIssueSummary[]>('control.issues.list', params);
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

	public async listRegisteredRepositories(): Promise<Repository[]> {
		return this.client.request<Repository[]>('control.repositories.list');
	}

	public async listVisibleGitHubRepositories(): Promise<GitHubVisibleRepository[]> {
		return this.client.request<GitHubVisibleRepository[]>('control.github.repositories.list');
	}

	public async cloneGitHubRepository(
		githubRepository: string,
		destinationPath: string
	): Promise<Repository> {
		const params: ControlGitHubRepositoriesClone = { githubRepository, destinationPath };
		return this.client.request<Repository>('control.github.repositories.clone', params);
	}

	public async getGitHubIssueDetail(issueNumber: number): Promise<GitHubIssueDetail> {
		const params: ControlGitHubIssueDetail = { issueNumber };
		return this.client.request<GitHubIssueDetail>('control.github.issue.detail', params);
	}

	public async addRepository(repositoryPath: string): Promise<Repository> {
		const params: ControlRepositoriesAdd = { repositoryPath };
		return this.client.request<Repository>('control.repositories.add', params);
	}
}
