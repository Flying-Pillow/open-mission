import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultRepositorySettings } from '../../schemas/RepositorySettings.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDirectory, '../../..');
const sourceDirectory = path.join(packageRoot, 'src', 'workflow', 'mission', 'templates');
const destinationDirectory = path.join(packageRoot, 'build', 'workflow', 'mission', 'templates');
const workflowDefinitionPath = path.join(packageRoot, 'build', 'workflow', 'mission', 'workflow.json');

await mkdir(destinationDirectory, { recursive: true });
await cp(sourceDirectory, destinationDirectory, {
	recursive: true,
	filter(sourcePath) {
		return sourcePath.endsWith('.md') || !path.extname(sourcePath);
	}
});
await mkdir(path.dirname(workflowDefinitionPath), { recursive: true });
await writeFile(workflowDefinitionPath, `${JSON.stringify(createDefaultRepositorySettings(), null, 2)}\n`, 'utf8');