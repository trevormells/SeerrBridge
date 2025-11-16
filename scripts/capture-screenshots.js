#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');

if (!fs.existsSync(pkgPath)) {
  console.error('package.json is required to derive the screenshot artifact path.');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const releaseArtifacts = path.join(root, 'release', 'artifacts');
const versionDir = path.join(releaseArtifacts, pkg.version);
const screenshotsDir = path.join(versionDir, 'screenshots');

fs.mkdirSync(releaseArtifacts, { recursive: true });
fs.mkdirSync(versionDir, { recursive: true });
fs.rmSync(screenshotsDir, { recursive: true, force: true });
fs.mkdirSync(screenshotsDir, { recursive: true });

const pages = [
  {
    slug: 'hello',
    file: 'hello.html',
    title: 'Hello page',
    viewport: { width: 1280, height: 720 }
  },
  {
    slug: 'options',
    file: 'options.html',
    title: 'Options page',
    viewport: { width: 1280, height: 900 }
  }
];

const browserCandidates = [
  process.env.CHROME_BIN,
  process.env.SCREENSHOT_BROWSER,
  'google-chrome',
  'google-chrome-stable',
  'chromium-browser',
  'chromium'
].filter(Boolean);

function resolveBinary(cmd) {
  if (cmd.includes('/') || cmd.includes('\\')) {
    return fs.existsSync(cmd);
  }

  const detector = process.platform === 'win32' ? 'where' : 'which';
  const probe = spawnSync(detector, [cmd], { stdio: 'ignore' });
  return probe.status === 0;
}

const browserBinary = browserCandidates.find(resolveBinary);

if (!browserBinary) {
  console.error('Unable to find a Chromium-based browser for screenshots.');
  console.error('Set CHROME_BIN or SCREENSHOT_BROWSER to the path of a headless-capable browser.');
  process.exit(1);
}

const metadata = [];

for (const pageConfig of pages) {
  const filePath = path.join(root, pageConfig.file);
  if (!fs.existsSync(filePath)) {
    console.error(`Missing page: ${pageConfig.file}`);
    process.exit(1);
  }

  const screenshotPath = path.join(screenshotsDir, `${pageConfig.slug}.png`);
  const fileUrl = pathToFileURL(filePath);
  const viewport = pageConfig.viewport ?? { width: 1280, height: 720 };
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--window-size=${viewport.width},${viewport.height}`,
    `--screenshot=${screenshotPath}`,
    '--virtual-time-budget=8000',
    fileUrl.href
  ];

  console.log(`Capturing ${pageConfig.title} via ${browserBinary}…`);
  const result = spawnSync(browserBinary, args, { stdio: 'inherit' });

  if (result.status !== 0) {
    console.error(`Screenshot capture failed for ${pageConfig.file}`);
    process.exit(result.status ?? 1);
  }

  metadata.push({
    slug: pageConfig.slug,
    title: pageConfig.title,
    source: pageConfig.file,
    viewport,
    screenshot: path.relative(root, screenshotPath)
  });
}

const metadataPath = path.join(screenshotsDir, 'metadata.json');
const manifest = {
  version: pkg.version,
  generatedAt: new Date().toISOString(),
  browser: browserBinary,
  pages: metadata
};

fs.writeFileSync(metadataPath, JSON.stringify(manifest, null, 2));
console.log(`Stored screenshot metadata at ${path.relative(root, metadataPath)}`);
console.log(`Screenshots saved to ${path.relative(root, screenshotsDir)}`);
