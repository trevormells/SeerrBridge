/**
 * Builds a status message describing how many detections are being enriched.
 * @param {{ totalCandidates?: number, limit?: number, batchSize?: number }} params
 * @returns {string}
 */
export function buildBatchedEnrichmentStatus(params = {}) {
  const totalCandidatesValue = Number(params.totalCandidates);
  const limitValue = Number(params.limit);
  const batchSizeValue = Number(params.batchSize);
  const totalCandidates = Number.isFinite(totalCandidatesValue)
    ? totalCandidatesValue
    : 0;
  const limit = Number.isFinite(limitValue) ? limitValue : 0;
  const batchSize = Number.isFinite(batchSizeValue) ? batchSizeValue : 0;

  if (totalCandidates <= 0 || limit <= 0) {
    return '';
  }

  const processedCount = Math.min(totalCandidates, limit);
  const lookupBatchSize = Math.max(1, Math.trunc(batchSize) || 1);
  const detectionLabel = processedCount === 1 ? '1 detection' : `${processedCount} detections`;
  const lookupLabel = lookupBatchSize === 1 ? '1 lookup' : `${lookupBatchSize} lookups`;

  let message = `Decorating ${detectionLabel} via Overseerr (${lookupLabel} at a time)…`;

  if (totalCandidates > limit) {
    const remaining = totalCandidates - limit;
    const remainderLabel =
      remaining === 1 ? '1 more title' : `${remaining} more titles`;
    message += ` Showing the first ${limit}. Increase Max detections in Settings to include ${remainderLabel}.`;
  }

  return message;
}
