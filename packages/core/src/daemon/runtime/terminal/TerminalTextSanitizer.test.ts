import { describe, expect, it } from 'vitest';
import {
    sanitizeTerminalOutputChunkForSurface,
    sanitizeTerminalScreenForSurface,
    sanitizeTerminalTextForHeuristics
} from './TerminalTextSanitizer.js';

describe('TerminalTextSanitizer', () => {
    it('drops OSC sequences from terminal surface output', () => {
        expect(sanitizeTerminalOutputChunkForSurface('hello\u001b]10;rgb:ff/ff/ff\u0007world')).toBe('helloworld');
    });

    it('drops alternate-screen toggles from terminal surface screens', () => {
        expect(sanitizeTerminalScreenForSurface('\u001b[?1049hhello\u001b[?1049l')).toBe('hello');
    });

    it('drops structural repaint escape sequences from terminal surface output', () => {
        expect(
            sanitizeTerminalOutputChunkForSurface('\u001b[?2026h\u001b[1;1H\u001b[2KHello\u001b[2;1H\u001b[2KWorld\u001b[?2026l')
        ).toBe('HelloWorld');
    });

    it('preserves SGR styling sequences for terminal surface output', () => {
        expect(sanitizeTerminalOutputChunkForSurface('\u001b[31mblocked\u001b[39m')).toBe('\u001b[31mblocked\u001b[39m');
    });

    it('sanitizes ANSI-styled plain text for heuristics', () => {
        expect(sanitizeTerminalTextForHeuristics('\u001b[31mCannot continue: missing token.\u001b[39m')).toBe('Cannot continue: missing token.');
    });

    it('rejects structural terminal control streams for heuristics', () => {
        expect(sanitizeTerminalTextForHeuristics('\u001b[?2026h\u001b[1;1H\u001b[2Kwaiting for input\u001b[?2026l')).toBeNull();
    });
});