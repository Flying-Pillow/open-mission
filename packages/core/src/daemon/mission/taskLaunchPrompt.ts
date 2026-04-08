import type { MissionTaskState } from '../../types.js';

export function buildMissionTaskLaunchPrompt(task: MissionTaskState, missionDir: string): string {
	const instruction = task.instruction.trim();
	const lines = [
		`You are working on task '${task.sequence} ${task.subject}'.`,
		`Stay strictly within this mission workspace: ${missionDir}`,
		'Do not read, modify, or create files outside that folder boundary.',
		`Here are your instructions: @${task.filePath}`,
		'That task file is authoritative.'
	];

	if (instruction.length > 0) {
		lines.push('', 'Task summary:', instruction);
	}

	return lines.join('\n');
}