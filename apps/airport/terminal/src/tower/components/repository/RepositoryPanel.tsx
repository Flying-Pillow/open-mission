/** @jsxImportSource @opentui/solid */

import { SelectPanel } from '../SelectPanel.js';
import type { SelectItem, TowerKeyEvent } from '../types.js';

type RepositoryPanelProps = {
	items: SelectItem[];
	selectedItemId: string | undefined;
	focused: boolean;
	onMoveSelection: (delta: number) => void;
	onActivateSelection: (itemId: string | undefined) => void;
	onItemChange: (itemId: string) => void;
	onFocusCommand?: () => void;
};

export function RepositoryPanel(props: RepositoryPanelProps) {
	return (
		<SelectPanel
			title="REPOSITORY SELECTION"
			items={props.items}
			selectedItemId={props.selectedItemId}
			focused={props.focused}
			emptyLabel="No missions or GitHub issues are available right now."
			helperText="Choose an active mission, pick an open issue that is not already active, or start a new mission."
			onKeyDown={(event) => {
				handleRepositorySelectionKeyDown(event, props);
			}}
			onItemChange={(itemId) => {
				props.onItemChange(itemId);
			}}
			onItemSelect={(itemId) => {
				props.onItemChange(itemId);
				props.onActivateSelection(itemId);
			}}
		/>
	);
}

function handleRepositorySelectionKeyDown(
	event: TowerKeyEvent,
	props: RepositoryPanelProps
): void {
	if (event.name === 'up') {
		event.preventDefault();
		event.stopPropagation();
		props.onMoveSelection(-1);
		return;
	}
	if (event.name === 'down') {
		event.preventDefault();
		event.stopPropagation();
		props.onMoveSelection(1);
		return;
	}
	if (event.name === 'enter' || event.name === 'return') {
		event.preventDefault();
		event.stopPropagation();
		props.onActivateSelection(props.selectedItemId);
		return;
	}
	if (event.name === 'right') {
		event.preventDefault();
		event.stopPropagation();
		props.onFocusCommand?.();
	}
}
