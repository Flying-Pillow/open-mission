export type CommandContext = {
	repoRoot: string;
	launchCwd: string;
	args: string[];
	json: boolean;
};

export type CommandHandler = (context: CommandContext) => Promise<void>;