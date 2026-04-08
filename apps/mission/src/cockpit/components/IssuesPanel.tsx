/** @jsxImportSource @opentui/solid */

import type { TrackedIssueSummary } from '@flying-pillow/mission-core';
import { createMemo } from 'solid-js';
import { SelectPanel } from './SelectPanel.js';
import type { SelectItem } from './types.js';

type IssuesPanelProps = {
	issues: TrackedIssueSummary[];
	selectedIssueNumber: number | undefined;
	focused: boolean;
	emptyLabel: string;
	helperText?: string;
	onIssueChange: (issueNumber: number) => void;
	onIssueSelect: (issueNumber: number) => void;
};

export function IssuesPanel(props: IssuesPanelProps) {
	const items = createMemo<SelectItem[]>(() =>
		props.issues.map((issue) => ({
			id: String(issue.number),
			label: `#${String(issue.number)} ${issue.title}`,
			description: formatIssueDescription(issue)
		}))
	);

	return (
		<SelectPanel
			title="OPEN ISSUES"
			items={items()}
			selectedItemId={props.selectedIssueNumber !== undefined ? String(props.selectedIssueNumber) : undefined}
			focused={props.focused}
			emptyLabel={props.emptyLabel}
			{...(props.helperText ? { helperText: props.helperText } : {})}
			onItemChange={(itemId) => {
				props.onIssueChange(Number(itemId));
			}}
			onItemSelect={(itemId) => {
				props.onIssueSelect(Number(itemId));
			}}
		/>
	);
}

function formatIssueDescription(issue: TrackedIssueSummary): string {
	const labelText = issue.labels.length > 0 ? issue.labels.join(', ') : 'no labels';
	return `${issue.url} | ${labelText}`;
}