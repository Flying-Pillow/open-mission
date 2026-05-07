import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

export function resolveGitWorkspaceRoot(startPath = process.cwd()): string | undefined {
	const commonDirectory = runGit(startPath, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
	if (commonDirectory) {
		return path.basename(commonDirectory) === '.git'
			? path.dirname(commonDirectory)
			: commonDirectory;
	}

	return resolveGitCheckoutRoot(startPath);
}

export function resolveGitCheckoutRoot(startPath = process.cwd()): string | undefined {
	return runGit(startPath, ['rev-parse', '--path-format=absolute', '--show-toplevel']);
}

function runGit(startPath: string, args: string[]): string | undefined {
	try {
		const output = execFileSync('git', args, {
			cwd: startPath,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim();
		return output.length > 0 ? output : undefined;
	} catch {
		return undefined;
	}
}