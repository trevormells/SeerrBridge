import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveMediaInfoStatuses } from '../../src/lib/mediaStatus.js';

test('returns null statuses when media info is missing data', () => {
  const result = deriveMediaInfoStatuses(undefined);
  assert.deepEqual(result, { availability: null, requestStatus: null });
});

test('returns the latest numeric request status based on createdAt', () => {
  const result = deriveMediaInfoStatuses({
    status: 3,
    requests: [
      { status: 1, createdAt: '2023-09-20T10:00:00Z' },
      { status: 2, createdAt: '2023-09-21T10:00:00Z' }
    ]
  });

  assert.deepEqual(result, { availability: 3, requestStatus: 2 });
});

test('ignores malformed timestamps while still deriving the latest request status', () => {
  const result = deriveMediaInfoStatuses({
    requests: [
      { status: 4, createdAt: 'not-a-date' },
      { status: 5, createdAt: '2024-01-02T00:00:00Z' }
    ]
  });

  assert.deepEqual(result, { availability: null, requestStatus: 5 });
});

test('skips requests without numeric statuses even if they are newest', () => {
  const result = deriveMediaInfoStatuses({
    status: 6,
    requests: [
      { status: 'pending', createdAt: '2024-04-10T08:00:00Z' },
      { status: 7, createdAt: '2024-04-08T08:00:00Z' }
    ]
  });

  assert.deepEqual(result, { availability: 6, requestStatus: 7 });
});
