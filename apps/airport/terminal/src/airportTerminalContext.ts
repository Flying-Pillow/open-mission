export type AirportTerminalContext = {
	controlRoot: string;
	workingDirectory: string;
	args: string[];
	json: boolean;
};

export type AirportTerminalHandler = (context: AirportTerminalContext) => Promise<void>;