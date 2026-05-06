import type { spawn as spawnPty } from 'node-pty';
import type { IPty } from 'node-pty';

export type TerminalExecutorResult = {
    stdout: string;
    stderr: string;
};

export type TerminalExecutor = (args: string[]) => Promise<TerminalExecutorResult>;

export type TerminalSessionHandle = {
    sessionName: string;
    paneId: string;
    sharedSessionName?: string | undefined;
};

export type TerminalProcessLease = {
    pid: number;
    processGroupId?: number | undefined;
    command: string;
    args: string[];
    workingDirectory: string;
    startedAt: string;
};

export type TerminalSessionOwner =
    | { kind: 'mission'; missionId: string }
    | { kind: 'task'; missionId?: string; taskId: string }
    | { kind: 'agent-session'; missionId?: string; taskId?: string; agentSessionId: string }
    | { kind: 'repository'; repositoryRootPath: string }
    | { kind: 'system'; label?: string };

export type TerminalProcessController = {
    isProcessRunning(processId: number): boolean;
    killProcess(processId: number, signal: NodeJS.Signals): void;
    killProcessGroup(processGroupId: number, signal: NodeJS.Signals): void;
};

export type TerminalOpenSessionRequest = {
    workingDirectory: string;
    command: string;
    args?: string[];
    env?: NodeJS.ProcessEnv;
    sessionPrefix?: string;
    sessionName?: string;
    sharedSessionName?: string;
    owner?: TerminalSessionOwner;
};

export type TerminalSessionSnapshot = {
    sessionName: string;
    paneId: string;
    connected: boolean;
    dead: boolean;
    exitCode: number | null;
    screen: string;
    truncated: boolean;
    chunk?: string;
    sharedSessionName?: string;
    workingDirectory?: string;
    processLease?: TerminalProcessLease;
    owner?: TerminalSessionOwner;
};

export type TerminalSessionUpdate = TerminalSessionSnapshot & {
    chunk: string;
};

export type TerminalSessionState = {
    dead: boolean;
    exitCode: number | null;
};

export type TerminalScreenSnapshot = {
    screen: string;
    truncated: boolean;
};

export type TerminalScreen = {
    write(chunk: string): TerminalScreenSnapshot;
    resize(cols: number, rows: number): TerminalScreenSnapshot;
    snapshot(): TerminalScreenSnapshot;
    serialize(): TerminalScreenSnapshot;
    restore(state: TerminalScreenSnapshot): void;
};

export type TerminalScreenFactory = (input: {
    cols: number;
    rows: number;
    maxBufferSize: number;
}) => TerminalScreen;

export type TerminalRegistryOptions = {
    spawnImpl: typeof spawnPty;
    logLine?: (line: string) => void;
    processController?: TerminalProcessController;
    terminationGraceMs?: number;
    terminationPollIntervalMs?: number;
    screenFactory?: TerminalScreenFactory;
};

export type TerminalOptions = {
    sessionName: string;
    paneId: string;
    pty: IPty;
    workingDirectory: string;
    screen: TerminalScreen;
    cols: number;
    rows: number;
    processLease: TerminalProcessLease;
    owner?: TerminalSessionOwner;
};

export class Terminal {
    public readonly sessionName: string;
    public readonly paneId: string;
    public readonly pty: IPty;
    public readonly workingDirectory: string;
    public readonly screen: TerminalScreen;
    public readonly processLease: TerminalProcessLease;
    public readonly owner?: TerminalSessionOwner;

    private dead = false;
    private exitCode: number | null = null;
    private cols: number;
    private rows: number;

    public constructor(options: TerminalOptions) {
        this.sessionName = options.sessionName;
        this.paneId = options.paneId;
        this.pty = options.pty;
        this.workingDirectory = options.workingDirectory;
        this.screen = options.screen;
        this.cols = options.cols;
        this.rows = options.rows;
        this.processLease = { ...options.processLease };
        if (options.owner) {
            this.owner = cloneTerminalSessionOwner(options.owner);
        }
    }

    public get isDead(): boolean {
        return this.dead;
    }

    public get state(): TerminalSessionState {
        return {
            dead: this.dead,
            exitCode: this.exitCode
        };
    }

    public handle(): TerminalSessionHandle {
        return {
            sessionName: this.sessionName,
            paneId: this.paneId
        };
    }

    public write(chunk: string): TerminalSessionUpdate {
        this.screen.write(chunk);
        return {
            ...this.snapshot(),
            chunk
        };
    }

    public markExited(exitCode: number): TerminalSessionUpdate {
        this.dead = true;
        this.exitCode = exitCode;
        return {
            ...this.snapshot(),
            chunk: ''
        };
    }

    public sendKeys(keys: string): void {
        this.pty.write(keys);
    }

    public resize(cols: number, rows: number): boolean {
        if (this.cols === cols && this.rows === rows) {
            return false;
        }
        this.cols = cols;
        this.rows = rows;
        this.screen.resize(cols, rows);
        this.pty.resize(cols, rows);
        return true;
    }

    public snapshot(): TerminalSessionSnapshot {
        const screen = this.screen.snapshot();
        return {
            sessionName: this.sessionName,
            paneId: this.paneId,
            connected: true,
            dead: this.dead,
            exitCode: this.exitCode,
            screen: screen.screen,
            truncated: screen.truncated,
            workingDirectory: this.workingDirectory,
            processLease: { ...this.processLease },
            ...(this.owner ? { owner: cloneTerminalSessionOwner(this.owner) } : {})
        };
    }
}

export function cloneTerminalSessionOwner(owner: TerminalSessionOwner): TerminalSessionOwner {
    return { ...owner };
}
