import { afterEach, describe, expect, it } from 'vitest';
import { buildBriefingRoomCommand } from './bootstrapBriefingRoomPane.js';

const originalMissionEditorCommand = process.env['MISSION_EDITOR_COMMAND'];
const originalTerminalEditorCommand = process.env['MISSION_TERMINAL_EDITOR_COMMAND'];

afterEach(() => {
	if (originalMissionEditorCommand === undefined) {
		delete process.env['MISSION_EDITOR_COMMAND'];
	} else {
		process.env['MISSION_EDITOR_COMMAND'] = originalMissionEditorCommand;
	}
	if (originalTerminalEditorCommand === undefined) {
		delete process.env['MISSION_TERMINAL_EDITOR_COMMAND'];
	} else {
		process.env['MISSION_TERMINAL_EDITOR_COMMAND'] = originalTerminalEditorCommand;
	}
});

describe('buildBriefingRoomCommand', () => {
	it('appends the artifact path to explicit editor commands', () => {
		process.env['MISSION_EDITOR_COMMAND'] = 'code -r';

		expect(buildBriefingRoomCommand('/repo', '/repo/docs/brief.md')).toBe("code -r '/repo/docs/brief.md'");
	});

	it('supports explicit editor commands with a path placeholder', () => {
		process.env['MISSION_TERMINAL_EDITOR_COMMAND'] = 'nvim {path} +10';

		expect(buildBriefingRoomCommand('/repo', "/repo/docs/agent's-note.md")).toBe(
			"nvim '/repo/docs/agent'\\''s-note.md' +10"
		);
	});
});