import type {
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
	MissionActionDescriptor,
	MissionActionExecutionStep,
	MissionStatus,
	TrackedIssueSummary
} from '../types.js';
import { DaemonClient } from './DaemonClient.js';

export class DaemonControlApi {
	public constructor(private readonly client: DaemonClient) { }

	public async getStatus(): Promise<MissionStatus> {
		return this.client.request<MissionStatus>('control.status');
	}

	public async listAvailableActions(): Promise<MissionActionDescriptor[]> {
		return (await this.getStatus()).availableActions ?? [];
	}

	public async executeAction(
		actionId: string,
		steps: MissionActionExecutionStep[] = []
	): Promise<MissionStatus> {
		const params: ControlActionExecute = {
			actionId,
			...(steps.length > 0 ? { steps } : {})
		};
		return this.client.request<MissionStatus>('control.action.execute', params);
	}

	public async updateSetting(
		field: ControlSettingsUpdate['field'],
		value: string
	): Promise<MissionStatus> {
		return this.client.request<MissionStatus>('control.settings.update', { field, value });
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
}