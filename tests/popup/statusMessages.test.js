import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBatchedEnrichmentStatus } from '../../src/lib/detectionStatus.js';

test('buildBatchedEnrichmentStatus describes batches and pluralizes counts', () => {
  const message = buildBatchedEnrichmentStatus({
    totalCandidates: 3,
    limit: 5,
    batchSize: 4
  });

  assert.equal(
    message,
    'Decorating 3 detections via Overseerr (4 lookups at a time)…'
  );
});

test('buildBatchedEnrichmentStatus highlights detection limit overflow', () => {
  const message = buildBatchedEnrichmentStatus({
    totalCandidates: 12,
    limit: 5,
    batchSize: 2
  });

  assert.equal(
    message,
    'Decorating 5 detections via Overseerr (2 lookups at a time)… Showing the first 5. Increase Max detections in Settings to include 7 more titles.'
  );
});

test('buildBatchedEnrichmentStatus returns empty string when nothing to decorate', () => {
  assert.equal(
    buildBatchedEnrichmentStatus({ totalCandidates: 0, limit: 5, batchSize: 3 }),
    ''
  );
  assert.equal(buildBatchedEnrichmentStatus({ totalCandidates: 5, limit: 0 }), '');
});
