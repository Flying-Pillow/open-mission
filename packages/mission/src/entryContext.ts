export type EntryContext = {
	repositoryRootPath: string;
	workingDirectory: string;
	args: string[];
	json: boolean;
};

export type MissionEntryHandler = (context: EntryContext) => Promise<void>;