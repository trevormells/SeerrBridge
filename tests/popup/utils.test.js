import test from 'node:test';
import assert from 'node:assert/strict';

function createStubElement() {
  return {
    classList: {
      add: () => {},
      remove: () => {},
      toggle: () => {}
    },
    dataset: {},
    appendChild: () => {},
    addEventListener: () => {},
    setAttribute: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    innerHTML: '',
    textContent: '',
    title: ''
  };
}

const documentStub = {
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener: () => {},
  createElement: () => createStubElement(),
  body: createStubElement(),
  title: ''
};

globalThis.document = documentStub;

globalThis.window = { open: () => {} };

const chromeStub = {
  runtime: {
    onMessage: { addListener: () => {} },
    sendMessage: () => {},
    lastError: null
  },
  storage: {
    sync: {
      get: (_keys, callback) => callback({}),
      set: (_payload, callback) => callback && callback()
    },
    onChanged: { addListener: () => {} }
  },
  tabs: {
    create: () => {},
    update: () => {}
  }
};

globalThis.chrome = chromeStub;

globalThis.__SEERRBRIDGE_POPUP_TEST_HOOK__ = (api) => {
  globalThis.__POPUP_TEST_API__ = api;
};

await import('../../src/popup/index.js');

delete globalThis.__SEERRBRIDGE_POPUP_TEST_HOOK__;

const {
  selectBestOverseerrMatch,
  dedupeMedia,
  buildRatingEntries,
  formatPercentScore,
  formatDecimalScore
} = globalThis.__POPUP_TEST_API__;

test('selectBestOverseerrMatch prioritizes the preferred media type when available', () => {
  const results = [
    { id: 1, mediaType: 'movie' },
    { id: 2, mediaType: 'tv' }
  ];
  const match = selectBestOverseerrMatch(results, 'tv');
  assert.equal(match?.id, 2);
});

test('dedupeMedia keeps the richer Overseerr-backed entry', () => {
  const entries = dedupeMedia([
    {
      title: 'Example Movie',
      releaseYear: '2020',
      mediaType: 'movie',
      tmdbId: null,
      rating: null,
      overview: '',
      poster: '',
      source: 'detector'
    },
    {
      title: 'Example Movie',
      releaseYear: '2020',
      mediaType: 'movie',
      tmdbId: 42,
      rating: 7.5,
      overview: 'Synopsis',
      poster: '/poster.jpg',
      source: 'overseerr'
    }
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].tmdbId, 42);
  assert.equal(entries[0].source, 'overseerr');
});

test('buildRatingEntries formats Rotten Tomatoes and IMDb payloads', () => {
  const entries = buildRatingEntries({
    rt: {
      criticsScore: 81.3,
      criticsRating: 'Certified Fresh',
      audienceScore: 89.6,
      audienceRating: 'Upright'
    },
    imdb: {
      criticsScore: 7.62
    }
  });

  assert.equal(entries.length, 3);
  assert.equal(entries[0].display, formatPercentScore(81.3));
  assert.equal(entries[1].display, formatPercentScore(89.6));
  assert.equal(entries[2].display, `${formatDecimalScore(7.62)}/10`);
});
