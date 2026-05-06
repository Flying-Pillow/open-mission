import type { spawn as spawnPty } from 'node-pty';
import type { TerminalScreenFactory } from './TerminalScreen.js';

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

export type TerminalRegistryOptions = {
    spawnImpl: typeof spawnPty;
    logLine?: (line: string) => void;
    processController?: TerminalProcessController;
    terminationGraceMs?: number;
    terminationPollIntervalMs?: number;
    screenFactory?: TerminalScreenFactory;
};

export function cloneTerminalSessionOwner(owner: TerminalSessionOwner): TerminalSessionOwner {
    return { ...owner };
}
