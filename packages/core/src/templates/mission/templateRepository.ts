import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const templateDirectory = path.dirname(fileURLToPath(import.meta.url));

export async function readMissionTemplate(templateRelativePath: string): Promise<string> {
	const templatePath = path.join(templateDirectory, templateRelativePath);
	return fs.readFile(templatePath, 'utf8');
}
