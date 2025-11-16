import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

class FakeMetaElement {
  constructor(content) {
    this._content = content;
  }

  getAttribute(name) {
    return name === 'content' ? this._content : null;
  }
}

class FakeHeading {
  constructor(text) {
    this.textContent = text;
  }
}

class FakeImdbListItem {
  constructor({ title, metadataItems = [], ranking = '', rating = '', votes = '' }) {
    this._title = title;
    this._metadata = metadataItems;
    this._ranking = ranking;
    this._rating = rating;
    this._votes = votes;
  }

  querySelector(selector) {
    if (selector === 'h3') {
      return this._title ? { textContent: this._title } : null;
    }
    if (selector.includes('title-list-item-ranking')) {
      return this._ranking ? { textContent: this._ranking } : null;
    }
    if (selector.includes('ipc-rating-star--rating')) {
      return this._rating ? { textContent: this._rating } : null;
    }
    if (selector.includes('ipc-rating-star--voteCount')) {
      return this._votes ? { textContent: this._votes } : null;
    }
    return null;
  }

  querySelectorAll(selector) {
    if (selector === '.cli-title-metadata-item') {
      return this._metadata.map((text) => ({ textContent: text }));
    }
    return [];
  }
}

class FakeDocument {
  constructor({ title = '', meta = new Map(), headings = {}, jsonLd = [], imdbItems = [] } = {}) {
    this.title = title;
    this._meta = meta;
    this._headings = headings;
    this._jsonLd = jsonLd;
    this._imdbItems = imdbItems;
  }

  querySelector(selector) {
    if (selector === 'h1') {
      return this._headings.h1 || null;
    }
    if (selector === 'h2') {
      return this._headings.h2 || null;
    }
    const metaMatch = selector.match(/^meta\[([\w-]+)="([^"]+)"\]$/);
    if (metaMatch) {
      const key = `${metaMatch[1]}:${metaMatch[2]}`;
      const content = this._meta.get(key);
      return content ? new FakeMetaElement(content) : null;
    }
    return null;
  }

  querySelectorAll(selector) {
    if (selector === 'script[type="application/ld+json"]') {
      return this._jsonLd.map((text) => ({ textContent: text }));
    }
    if (selector === '.cli-children, [data-testid="title-list-item"]') {
      return this._imdbItems;
    }
    return [];
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const chromeStub = {
  runtime: {
    getURL: (relativePath) => pathToFileURL(path.join(repoRoot, relativePath)).href,
    onMessage: { addListener: () => {} }
  },
  storage: {
    sync: {
      get: (_keys, callback) => callback({})
    }
  }
};
chromeStub.storage.onChanged = { addListener: () => {} };

globalThis.chrome = chromeStub;

globalThis.__SEERRBRIDGE_DETECTOR_TEST_HOOK__ = (api) => {
  globalThis.__DETECTOR_TEST_API__ = api;
};

globalThis.document = new FakeDocument();

globalThis.window = {};

await import('../../src/content/detector.js');

async function resolveDetectorApi(retries = 20) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (globalThis.__DETECTOR_TEST_API__) {
      return globalThis.__DETECTOR_TEST_API__;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return globalThis.__DETECTOR_TEST_API__;
}

let detectorApiPromise;

function getDetectorApi() {
  if (!detectorApiPromise) {
    detectorApiPromise = (async () => {
      const api = await resolveDetectorApi();
      if (!api) {
        throw new Error('Detector test internals unavailable');
      }
      return api;
    })();
  }
  return detectorApiPromise;
}

afterEach(() => {
  globalThis.document = new FakeDocument();
});

test('detectMedia combines DOM signals and separates weak matches', async () => {
  const meta = new Map([
    ['property:og:title', 'Example Movie'],
    ['property:og:type', 'video.movie'],
    ['property:og:description', 'OG description'],
    ['property:og:image', 'https://example.com/poster.jpg'],
    ['name:release_date', '2020-04-20']
  ]);
  const documentStub = new FakeDocument({
    title: 'Example Movie (2020)',
    meta,
    headings: { h1: new FakeHeading('Example Movie (2020)') },
    jsonLd: [
      JSON.stringify({
        '@type': 'Movie',
        name: 'Example Movie',
        image: '/poster.jpg',
        datePublished: '2020-01-01'
      })
    ],
    imdbItems: [
      new FakeImdbListItem({
        title: 'Example Movie',
        metadataItems: ['2020', 'PG-13'],
        ranking: '#1',
        rating: '8.0',
        votes: '(1,000)'
      }),
      new FakeImdbListItem({
        title: 'Top 10 movies to watch',
        metadataItems: ['2020']
      })
    ]
  });

  globalThis.document = documentStub;

  const detectorApi = await getDetectorApi();
  const detections = detectorApi.detectMedia();
  assert.equal(detections.items.length, 1);
  assert.equal(detections.items[0].title, 'Example');
  assert.equal(detections.weak_detections.length, 1);
  assert.match(detections.weak_detections[0].title, /Top 10/);
});

test('detectMedia flags list-like headings as weak detections', async () => {
  const documentStub = new FakeDocument({
    title: 'List of films to watch',
    headings: { h1: new FakeHeading('List of the best movies to watch soon') }
  });

  globalThis.document = documentStub;

  const detectorApi = await getDetectorApi();
  const detections = detectorApi.detectMedia();
  assert.equal(detections.items.length, 0);
  assert.equal(detections.weak_detections.length, 1);
  assert.match(detections.weak_detections[0].title, /best movies/i);
});
