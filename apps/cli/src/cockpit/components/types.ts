export type FocusArea = 'header' | 'flow' | 'tree' | 'sessions' | 'command';

export type SelectItem = {
	id: string;
	label: string;
	description: string;
	disabled?: boolean;
};

export type CommandItem = SelectItem & {
	command: string;
};