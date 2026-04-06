#!/usr/bin/env node

import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');
const sourceRoot = path.join(appRoot, 'src');
const buildRoot = path.join(appRoot, 'build');

await copyMatchingAssets(sourceRoot);

async function copyMatchingAssets(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      await copyMatchingAssets(sourcePath);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.glb')) {
      continue;
    }

    const relativePath = path.relative(sourceRoot, sourcePath);
    const destinationPath = path.join(buildRoot, relativePath);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await cp(sourcePath, destinationPath);
  }
}
