#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const releaseDir = path.join(root, 'release');
const artifactRoot = path.join(releaseDir, 'artifacts');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256File(filePath) {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function runGit(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim();
}

async function main() {
  if (!fs.existsSync(releaseDir)) {
    console.error('Missing release/ directory. See release/README.md for details.');
    process.exit(1);
  }

  const pkgPath = path.join(root, 'package.json');
  const manifestPath = path.join(root, 'manifest.json');
  const configPath = path.join(releaseDir, 'targets.json');

  if (!fs.existsSync(configPath)) {
    console.error('release/targets.json is required to describe store targets.');
    process.exit(1);
  }

  const pkg = readJson(pkgPath);
  const manifest = readJson(manifestPath);
  const targetsConfig = readJson(configPath);

  if (pkg.version !== manifest.version) {
    console.error('package.json and manifest.json versions are out of sync.');
    console.error('Run "npm run sync:manifest-version" or "npm version" before building release artifacts.');
    process.exit(1);
  }

  if (!targetsConfig.targets || Object.keys(targetsConfig.targets).length === 0) {
    console.error('No release targets defined in release/targets.json.');
    process.exit(1);
  }

  const cliArg = process.argv.find(arg => arg.startsWith('--targets='));
  let requestedTargets = null;
  if (cliArg) {
    requestedTargets = cliArg
      .replace('--targets=', '')
      .split(',')
      .map(name => name.trim())
      .filter(Boolean);
  }

  const targetEntries = Object.entries(targetsConfig.targets)
    .filter(([name]) => !requestedTargets || requestedTargets.includes(name));

  if (requestedTargets && targetEntries.length !== requestedTargets.length) {
    const knownTargets = new Set(targetEntries.map(([name]) => name));
    const missing = requestedTargets.filter(name => !knownTargets.has(name));
    console.error(`Unknown target(s): ${missing.join(', ')}.`);
    process.exit(1);
  }

  fs.mkdirSync(artifactRoot, { recursive: true });
  const versionDir = path.join(artifactRoot, pkg.version);
  fs.mkdirSync(versionDir, { recursive: true });

  const gitSha = runGit('rev-parse', 'HEAD');
  const generatedAt = new Date().toISOString();
  const globalExcludes = new Set(targetsConfig.globalExcludes ?? []);
  globalExcludes.add('release/artifacts/*');

  const builds = [];

  for (const [targetName, targetConfig] of targetEntries) {
    const targetDir = path.join(versionDir, targetName);
    fs.mkdirSync(targetDir, { recursive: true });

    const archiveName = `${targetConfig.archiveName ?? `seerrbridge-${targetName}`}-${pkg.version}.zip`;
    const archivePath = path.join(targetDir, archiveName);

    if (fs.existsSync(archivePath)) {
      fs.unlinkSync(archivePath);
    }

    const excludes = [...globalExcludes, ...(targetConfig.excludes ?? [])];
    const zipArgs = ['-r', archivePath, '.', '-x', ...excludes];
    const zipResult = spawnSync('zip', zipArgs, { cwd: root, stdio: 'inherit' });

    if (zipResult.status !== 0) {
      console.error(`zip command failed while building ${targetName}.`);
      process.exit(zipResult.status ?? 1);
    }

    const checksum = await sha256File(archivePath);
    const displayName = targetConfig.displayName ?? targetName;
    const buildInfo = {
      target: targetName,
      displayName,
      description: targetConfig.description ?? '',
      archive: path.relative(root, archivePath),
      sha256: checksum,
      manifestVersion: manifest.version,
      packageVersion: pkg.version,
      commit: gitSha,
      generatedAt
    };

    const infoPath = path.join(targetDir, 'build-info.json');
    fs.writeFileSync(infoPath, JSON.stringify(buildInfo, null, 2));

    const notesPath = path.join(targetDir, 'STORE_NOTES.md');
    if (!fs.existsSync(notesPath)) {
      const template = `# ${displayName} ${pkg.version} upload checklist\n\n` +
        `- [ ] Review screenshots\n` +
        `- [ ] Update listing description\n` +
        `- [ ] Paste changelog snippet\n` +
        `- [ ] Verify privacy policy link\n`;
      fs.writeFileSync(notesPath, template);
    }

    builds.push({
      ...buildInfo,
      buildInfo: path.relative(root, infoPath),
      notes: path.relative(root, notesPath)
    });

    console.log(`Created ${displayName} archive: ${path.relative(root, archivePath)}`);
  }

  const metadata = {
    version: pkg.version,
    manifestVersion: manifest.version,
    commit: gitSha,
    generatedAt,
    targets: builds
  };

  fs.writeFileSync(path.join(versionDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  console.log(`Stored release metadata at ${path.relative(root, path.join(versionDir, 'metadata.json'))}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
