import { describe, expect, it } from 'vitest';
import { PlainTerminalScreen } from './TerminalScreen.js';

describe('PlainTerminalScreen', () => {
    it('appends chunks and snapshots the terminal screen', () => {
        const screen = new PlainTerminalScreen({ cols: 120, rows: 32, maxBufferSize: 20 });

        screen.write('hello');
        screen.write('\r\nworld');

        expect(screen.snapshot()).toEqual({
            screen: 'hello\r\nworld',
            truncated: false
        });
    });

    it('truncates scrollback when the buffer limit is exceeded', () => {
        const screen = new PlainTerminalScreen({ cols: 120, rows: 32, maxBufferSize: 8 });

        screen.write('abcdef');
        screen.write('ghijkl');

        expect(screen.snapshot()).toEqual({
            screen: 'efghijkl',
            truncated: true
        });
    });

    it('serializes and restores completed terminal output state', () => {
        const original = new PlainTerminalScreen({ cols: 80, rows: 24, maxBufferSize: 10 });
        original.write('0123456789');
        original.write('abc');

        const restored = new PlainTerminalScreen({ cols: 120, rows: 32, maxBufferSize: 10 });
        restored.restore(original.serialize());

        expect(restored.snapshot()).toEqual({
            screen: '3456789abc',
            truncated: true
        });
    });

    it('keeps plain screen content stable across resizes', () => {
        const screen = new PlainTerminalScreen({ cols: 80, rows: 24, maxBufferSize: 20 });
        screen.write('ready');

        expect(screen.resize(140, 48)).toEqual({
            screen: 'ready',
            truncated: false
        });
    });
});
