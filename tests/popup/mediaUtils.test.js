import test from 'node:test';
import assert from 'node:assert/strict';

const utilsPromise = import('../../src/popup/mediaUtils.js');

const movieBase = {
  title: 'Example Title',
  mediaType: 'movie',
  releaseYear: '2020',
  source: 'detector'
};

test('dedupeMedia prefers richer Overseerr metadata', async () => {
  const { dedupeMedia } = await utilsPromise;
  const list = [
    { ...movieBase, overview: '', poster: '', rating: null },
    { ...movieBase, source: 'overseerr', tmdbId: 123, poster: 'poster.jpg', rating: 7.5 }
  ];
  const deduped = dedupeMedia(list);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].tmdbId, 123);
  assert.equal(deduped[0].poster, 'poster.jpg');
});

test('prepareStatusReadyList toggles loading based on capability', async () => {
  const { prepareStatusReadyList } = await utilsPromise;
  const list = [
    { ...movieBase, tmdbId: 99, availabilityStatus: null, requestStatus: null },
    { title: 'Untracked', mediaType: 'podcast' }
  ];
  const ready = prepareStatusReadyList(list, true);
  assert.equal(ready[0].showStatus, true);
  assert.equal(ready[0].statusLoading, true);
  assert.equal(ready[0].availabilityStatus, null);
  assert.equal(ready[1].showStatus, undefined);
});

test('prepareRatingsReadyList respects existing data and media type', async () => {
  const { prepareRatingsReadyList } = await utilsPromise;
  const list = [
    { ...movieBase, tmdbId: 42, ratings: null },
    { title: 'Audio Show', mediaType: 'podcast', ratings: { rt: { criticsScore: 90 } } }
  ];
  const ready = prepareRatingsReadyList(list, true);
  assert.equal(ready[0].showRatings, true);
  assert.equal(ready[0].ratingsLoading, true);
  assert.equal(ready[1].showRatings, false);
});

test('buildRequestActionState surfaces status labels before request button', async () => {
  const { buildRequestActionState } = await utilsPromise;
  const availability = buildRequestActionState(
    { availabilityStatus: 3 },
    { canSubmitRequest: true }
  );
  assert.equal(availability.type, 'status');
  assert.equal(typeof availability.label, 'string');

  const request = buildRequestActionState(
    { requestStatus: 2 },
    { canSubmitRequest: true }
  );
  assert.equal(request.type, 'status');

  const fallback = buildRequestActionState(
    { mediaType: 'movie' },
    { canSubmitRequest: false }
  );
  assert.equal(fallback.type, 'button');
  assert.equal(fallback.disabled, true);
});
