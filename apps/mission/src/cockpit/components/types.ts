export type FocusArea = 'header' | 'flow' | 'tree' | 'command';

export type CockpitKeyEvent = {
	name?: string;
	sequence?: string;
	ctrl?: boolean;
	shift?: boolean;
	preventDefault: () => void;
	stopPropagation: () => void;
};

export type SelectItem = {
	id: string;
	label: string;
	description: string;
	disabled?: boolean;
};

export type CommandItem = SelectItem & {
	command: string;
};