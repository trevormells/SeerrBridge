#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const archivePath = path.join(distDir, `seerrbridge-${pkg.version}.zip`);

if (fs.existsSync(archivePath)) {
  fs.unlinkSync(archivePath);
}

const excludes = [
  'dist/*',
  'node_modules/*',
  '.git/*',
  '.gitignore',
  'package-lock.json'
];

const zipArgs = ['-r', archivePath, '.', '-x', ...excludes];
const zipResult = spawnSync('zip', zipArgs, { cwd: root, stdio: 'inherit' });

if (zipResult.status !== 0) {
  console.error('zip command failed. Ensure the zip utility is installed and try again.');
  process.exit(zipResult.status ?? 1);
}

console.log(`Created archive: ${path.relative(root, archivePath)}`);
