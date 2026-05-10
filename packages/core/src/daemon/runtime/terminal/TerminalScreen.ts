export type TerminalScreenSnapshot = {
    screen: string;
    truncated: boolean;
};

export type TerminalScreenSerializedState = TerminalScreenSnapshot;

export interface TerminalScreen {
    write(chunk: string): TerminalScreenSnapshot;
    resize(cols: number, rows: number): TerminalScreenSnapshot;
    snapshot(): TerminalScreenSnapshot;
    serialize(): TerminalScreenSerializedState;
    restore(state: TerminalScreenSerializedState): void;
}

export type TerminalScreenFactory = (input: {
    cols: number;
    rows: number;
    maxBufferSize: number;
}) => TerminalScreen;

export class PlainTerminalScreen implements TerminalScreen {
    private buffer = '';
    private isTruncated = false;

    public constructor(
        private readonly options: {
            cols: number;
            rows: number;
            maxBufferSize: number;
        }
    ) { }

    public write(chunk: string): TerminalScreenSnapshot {
        if (!chunk) {
            return this.snapshot();
        }

        if (chunk.length >= this.options.maxBufferSize) {
            this.buffer = chunk.slice(chunk.length - this.options.maxBufferSize);
            this.isTruncated = true;
            return this.snapshot();
        }

        const nextLength = this.buffer.length + chunk.length;
        if (nextLength <= this.options.maxBufferSize) {
            this.buffer += chunk;
            return this.snapshot();
        }

        const overflow = nextLength - this.options.maxBufferSize;
        this.buffer = `${this.buffer.slice(overflow)}${chunk}`;
        this.isTruncated = true;
        return this.snapshot();
    }

    public resize(_cols: number, _rows: number): TerminalScreenSnapshot {
        return this.snapshot();
    }

    public snapshot(): TerminalScreenSnapshot {
        return {
            screen: this.buffer,
            truncated: this.isTruncated
        };
    }

    public serialize(): TerminalScreenSerializedState {
        return this.snapshot();
    }

    public restore(state: TerminalScreenSerializedState): void {
        this.buffer = state.screen;
        this.isTruncated = state.truncated;
    }
}

export function createPlainTerminalScreen(input: {
    cols: number;
    rows: number;
    maxBufferSize: number;
}): TerminalScreen {
    return new PlainTerminalScreen(input);
}
