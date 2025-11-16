#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const skipDirs = new Set(['node_modules', '.git', 'dist']);
const jsFiles = [];
const testsDir = path.join(root, 'tests');
const testFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) {
      continue;
    }

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      jsFiles.push(full);
    }
  }
}

function collectTests(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) {
      continue;
    }

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTests(full);
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      testFiles.push(full);
    }
  }
}

walk(root);
if (fs.existsSync(testsDir)) {
  collectTests(testsDir);
}

if (jsFiles.length === 0) {
  console.log('No JavaScript files to check.');
  process.exit(0);
}

let failed = false;

for (const file of jsFiles) {
  const relative = path.relative(root, file);
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'pipe' });

  if (result.status !== 0) {
    failed = true;
    console.error(`Syntax check failed for ${relative}`);
    process.stderr.write(result.stderr);
  } else {
    console.log(`✔ ${relative}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log('All JavaScript files passed syntax checks.');

if (testFiles.length) {
  console.log('Running unit tests...');
  const testResult = spawnSync(process.execPath, ['--test', ...testFiles], {
    stdio: 'inherit'
  });

  if (testResult.status !== 0) {
    process.exit(testResult.status || 1);
  }
}
