export type EntryContext = {
	controlRoot: string;
	workingDirectory: string;
	args: string[];
	json: boolean;
};

export type MissionEntryHandler = (context: EntryContext) => Promise<void>;