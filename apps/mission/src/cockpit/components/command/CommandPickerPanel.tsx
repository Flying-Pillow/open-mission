/** @jsxImportSource @opentui/solid */

import { SelectPanel } from '../SelectPanel.js';
import { isPrintableCommandFilterKey } from './commandDomain.js';
import type { CommandItem } from '../types.js';

type CommandPickerPanelProps = {
	items: CommandItem[];
	selectedItemId: string | undefined;
	focused: boolean;
	query: string;
	emptyLabel: string;
	helperText: string;
	onHighlight: (itemId: string) => void;
	onSelect: (itemId: string) => void;
	onClose: () => void;
	onAppendFilter: (value: string) => void;
	onPopFilter: () => void;
};

export function CommandPickerPanel(props: CommandPickerPanelProps) {
	return (
		<SelectPanel
			title="COMMANDS"
			items={props.items}
			selectedItemId={props.selectedItemId}
			focused={props.focused}
			showFooterBadges={false}
			emptyLabel={props.emptyLabel}
			helperText={props.helperText}
			filterValue={props.query === '/' ? '' : props.query.replace(/^\//u, '')}
			onKeyDown={(event) => {
				if (event.name === 'enter' || event.name === 'return') {
					event.preventDefault();
					event.stopPropagation();
					const selectedItemId = props.selectedItemId ?? props.items[0]?.id;
					if (selectedItemId) {
						props.onSelect(selectedItemId);
					}
					return;
				}
				if (event.name === 'escape') {
					event.preventDefault();
					event.stopPropagation();
					props.onClose();
					return;
				}
				if (event.name === 'backspace') {
					event.preventDefault();
					event.stopPropagation();
					props.onPopFilter();
					return;
				}
				if (event.sequence === '/') {
					event.preventDefault();
					event.stopPropagation();
					return;
				}
				if (typeof event.sequence === 'string' && isPrintableCommandFilterKey(event.sequence)) {
					const nextFilter = event.sequence;
					event.preventDefault();
					event.stopPropagation();
					props.onAppendFilter(nextFilter);
				}
			}}
			onItemChange={props.onHighlight}
			onItemSelect={props.onSelect}
		/>
	);
}