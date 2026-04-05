import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDirectory, '..');
const sourceDirectory = path.join(packageRoot, 'src', 'templates', 'mission');
const destinationDirectory = path.join(packageRoot, 'build', 'templates', 'mission');

await mkdir(destinationDirectory, { recursive: true });
await cp(sourceDirectory, destinationDirectory, {
  recursive: true,
  filter(sourcePath) {
    return sourcePath.endsWith('.md') || !path.extname(sourcePath);
  },
});
