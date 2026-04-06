import * as vscode from 'vscode';

const DEFAULT_MAX_LOG_LINES = 500;

export type MissionLogWriter = {
    appendLine(value: string): void;
};

export type MissionLogModel = {
    title: string;
    summary: string;
    lines: string[];
};

export class MissionLogChannel implements vscode.Disposable, MissionLogWriter {
    private readonly outputChannel: vscode.OutputChannel;
    private readonly didChangeEmitter = new vscode.EventEmitter<MissionLogModel>();
    private readonly lines: string[] = [];

    public constructor(
        name: string,
        private readonly maxLines = DEFAULT_MAX_LOG_LINES
    ) {
        this.outputChannel = vscode.window.createOutputChannel(name);
    }

    public readonly onDidChange = this.didChangeEmitter.event;

    public appendLine(value: string): void {
        this.outputChannel.appendLine(value);
        const normalizedLines = normalizeLogLines(value);
        if (normalizedLines.length === 0) {
            return;
        }

        this.lines.push(...normalizedLines);
        if (this.lines.length > this.maxLines) {
            this.lines.splice(0, this.lines.length - this.maxLines);
        }
        this.didChangeEmitter.fire(this.getModel());
    }

    public getModel(): MissionLogModel {
        const lineCount = this.lines.length;
        return {
            title: 'Mission Log',
            summary:
                lineCount > 0
                    ? `${String(lineCount)} buffered log lines mirrored from the Mission output channel.`
                    : 'Mission daemon and extension logs will appear here.',
            lines: [...this.lines]
        };
    }

    public show(preserveFocus?: boolean): void {
        this.outputChannel.show(preserveFocus);
    }

    public dispose(): void {
        this.didChangeEmitter.dispose();
        this.outputChannel.dispose();
    }
}

function normalizeLogLines(value: string): string[] {
    return value
        .split(/\r?\n/gu)
        .filter((line) => line.length > 0);
}