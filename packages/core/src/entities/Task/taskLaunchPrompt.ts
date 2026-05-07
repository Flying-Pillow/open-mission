import type { MissionTaskState } from '../Mission/MissionSchema.js';

export function buildTaskLaunchPrompt(task: MissionTaskState, missionDir: string): string {
	const instruction = task.instruction.trim();
	const artifactName = task.fileName.trim();
	const lines = [
		`You are working on task '${task.sequence} ${task.subject}'.`,
		`Stay strictly within this mission workspace: ${missionDir}`,
		'Do not read, modify, or create files outside that folder boundary.',
		`Perform the task exactly as specified in <${artifactName}>.`,
		`Here are your instructions: @${task.filePath}`,
		'That task file is authoritative.'
	];
	appendTaskContextArtifactReferences(lines, task.context);

	if (instruction.length > 0) {
		lines.push('', 'Task summary:', instruction);
	}

	return lines.join('\n');
}

export function appendTaskContextArtifactReferences(
	lines: string[],
	context: MissionTaskState['context']
): void {
	const orderedContext = [...(context ?? [])].sort((left, right) => left.selectionPosition - right.selectionPosition);
	if (orderedContext.length === 0) {
		return;
	}

	lines.push('', 'Context artifacts:');
	for (const artifact of orderedContext) {
		lines.push(`- ${artifact.name}: @${artifact.path}`);
	}
}