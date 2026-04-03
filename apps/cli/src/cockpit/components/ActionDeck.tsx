/** @jsxImportSource @opentui/solid */

import type { CommandItem, FocusArea } from './types.js';
import { SelectPanel } from './SelectPanel.js';

type ActionDeckProps = {
	focusArea: FocusArea;
	commandItems: CommandItem[];
	selectedAction?: CommandItem;
	onActionChange: (actionId: string) => void;
	onActionSelect: (actionId: string) => void;
};

export function ActionDeck(props: ActionDeckProps) {
	return (
		<SelectPanel
			title="ACTION DECK"
			focused={props.focusArea === 'flow'}
			items={props.commandItems}
			selectedItemId={props.selectedAction?.id}
			emptyLabel="No action available"
			helperText="Use Up/Down to move between panels. Enter runs the selected action."
			style={{ width: '34%', minWidth: 34 }}
			onItemChange={props.onActionChange}
			onItemSelect={props.onActionSelect}
		/>
	);
}