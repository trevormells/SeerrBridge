import test from 'node:test';
import assert from 'node:assert/strict';

import {
  executeOverseerrRequest,
  OverseerrAuthError,
  OVERSEERR_AUTH_MODES
} from '../../src/lib/overseerr.js';

test('executeOverseerrRequest falls back to the API key when cookies fail', async () => {
  const calls = [];
  const responses = [
    new Response(null, { status: 401 }),
    new Response('{}', { status: 200 })
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return responses.shift();
  };

  try {
    const result = await executeOverseerrRequest(
      'https://demo.invalid',
      '/api/v1/test',
      {},
      {
        authStrategy: {
          mode: OVERSEERR_AUTH_MODES.COOKIES_WITH_API_KEY_FALLBACK,
          apiKey: 'abc123'
        }
      }
    );

    assert.equal(calls.length, 2);
    assert.equal(calls[0].init.credentials, 'include');
    assert.equal(calls[1].init.credentials, 'omit');
    assert.equal(calls[1].init.headers.get('X-Api-Key'), 'abc123');
    assert.equal(result.authMode, OVERSEERR_AUTH_MODES.API_KEY);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('executeOverseerrRequest surfaces API key errors when keys are rejected', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 401 });

  try {
    await assert.rejects(
      () =>
        executeOverseerrRequest(
          'https://demo.invalid',
          '/api/v1/test',
          {},
          {
            authStrategy: { mode: OVERSEERR_AUTH_MODES.API_KEY, apiKey: 'bad-key' }
          }
        ),
      (error) => error instanceof OverseerrAuthError && /API key/i.test(error.message)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
