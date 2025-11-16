import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

const chromeStub = {
  runtime: {
    onMessage: { addListener: () => {} },
    lastError: null
  },
  storage: {
    sync: {
      get: (_keys, callback) => callback({}),
      set: (_values, callback) => callback && callback()
    },
    onChanged: { addListener: () => {} }
  },
  tabs: {
    create: () => {},
    update: () => {},
    onRemoved: { addListener: () => {} }
  }
};

globalThis.chrome = chromeStub;

globalThis.window = { open: () => {} };

const backgroundModule = await import('../../src/background/index.js');

const {
  handleOverseerrMediaStatus,
  handleOverseerrRatings,
  ensureOverseerrSession,
  __setBackgroundTestDependencies,
  __resetBackgroundTestDependencies
} = backgroundModule;

afterEach(() => {
  __resetBackgroundTestDependencies();
});

test('handleOverseerrMediaStatus returns null statuses for 404 responses', async () => {
  __setBackgroundTestDependencies({
    loadSettings: async () => ({ overseerrUrl: 'https://demo.invalid' }),
    sanitizeBaseUrl: (value) => value,
    executeOverseerrRequest: async () => ({
      response: new Response(null, { status: 404 }),
      url: 'https://demo.invalid/api/v1/movie/1'
    })
  });

  const result = await handleOverseerrMediaStatus({ tmdbId: 1, mediaType: 'movie' });
  assert.deepEqual(result, { availability: null, requestStatus: null });
});

test('handleOverseerrMediaStatus logs failures and throws on non-ok responses', async () => {
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args);

  __setBackgroundTestDependencies({
    loadSettings: async () => ({ overseerrUrl: 'https://demo.invalid' }),
    sanitizeBaseUrl: (value) => value,
    executeOverseerrRequest: async () => ({
      response: new Response('boom', { status: 500, statusText: 'Server Error' }),
      url: 'https://demo.invalid/api/v1/movie/1'
    })
  });

  try {
    await assert.rejects(
      () => handleOverseerrMediaStatus({ tmdbId: 1, mediaType: 'movie' }),
      /Overseerr status error: 500/
    );
    assert.ok(
      logs.some(([message]) => message === 'Overseerr status lookup failed'),
      'expected error log entry'
    );
  } finally {
    console.error = originalError;
  }
});

test('handleOverseerrRatings returns empty payload for 404 responses', async () => {
  __setBackgroundTestDependencies({
    loadSettings: async () => ({ overseerrUrl: 'https://demo.invalid' }),
    sanitizeBaseUrl: (value) => value,
    executeOverseerrRequest: async () => ({
      response: new Response(null, { status: 404 }),
      url: 'https://demo.invalid/api/v1/movie/1/ratingscombined'
    })
  });

  const result = await handleOverseerrRatings({ tmdbId: 1, mediaType: 'movie' });
  assert.deepEqual(result, { ratings: null });
});

test('ensureOverseerrSession raises auth errors when the payload lacks a user id', async () => {
  class FakeAuthError extends Error {
    constructor(message) {
      super(message);
      this.code = 'AUTH_REQUIRED';
    }
  }

  __setBackgroundTestDependencies({
    sanitizeBaseUrl: (value) => value,
    executeOverseerrRequest: async () => ({
      response: new Response('{}', { status: 200 }),
      url: 'https://demo.invalid/api/v1/auth/me'
    }),
    OverseerrAuthError: FakeAuthError
  });

  await assert.rejects(
    () => ensureOverseerrSession('https://demo.invalid'),
    (error) => error instanceof FakeAuthError && /Log into Overseerr/.test(error.message)
  );
});
