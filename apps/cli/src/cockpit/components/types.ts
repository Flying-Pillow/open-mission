export type FocusArea = 'header' | 'flow' | 'stages' | 'tasks' | 'sessions' | 'command';

export type SelectItem = {
	id: string;
	label: string;
	description: string;
	disabled?: boolean;
};

export type CommandItem = SelectItem & {
	command: string;
};