import type { AgentSessionRecord } from '../../daemon/protocol/contracts.js';

export type AgentSessionData = {
	sessionId: string;
	runnerId: string;
	transportId?: string;
	runnerLabel: string;
	lifecycleState: AgentSessionRecord['lifecycleState'];
	terminalSessionName?: string;
	terminalPaneId?: string;
	terminalHandle?: {
		sessionName: string;
		paneId: string;
	};
	taskId?: string;
	assignmentLabel?: string;
	workingDirectory?: string;
	currentTurnTitle?: string;
	createdAt: string;
	lastUpdatedAt: string;
	failureMessage?: string;
};

export function toAgentSession(record: AgentSessionRecord): AgentSessionData {
	return {
		sessionId: record.sessionId,
		runnerId: record.runnerId,
		...(record.transportId ? { transportId: record.transportId } : {}),
		runnerLabel: record.runnerLabel,
		lifecycleState: record.lifecycleState,
		...(record.terminalSessionName ? { terminalSessionName: record.terminalSessionName } : {}),
		...(record.terminalPaneId ? { terminalPaneId: record.terminalPaneId } : {}),
		...(record.terminalSessionName && record.terminalPaneId
			? {
				terminalHandle: {
					sessionName: record.terminalSessionName,
					paneId: record.terminalPaneId
				}
			}
			: {}),
		...(record.taskId ? { taskId: record.taskId } : {}),
		...(record.assignmentLabel ? { assignmentLabel: record.assignmentLabel } : {}),
		...(record.workingDirectory ? { workingDirectory: record.workingDirectory } : {}),
		...(record.currentTurnTitle ? { currentTurnTitle: record.currentTurnTitle } : {}),
		createdAt: record.createdAt,
		lastUpdatedAt: record.lastUpdatedAt,
		...(record.failureMessage ? { failureMessage: record.failureMessage } : {})
	};
}