import { DESCRIPTION_LENGTH_LIMITS, DETECTION_LIMITS } from './config.js';

/**
 * Normalizes the configured detection limit from user inputs or storage.
 * @param {number|string|undefined|null} value
 * @param {number} [fallback=DETECTION_LIMITS.default]
 * @returns {number}
 */
export function sanitizeDetectionLimit(value, fallback = DETECTION_LIMITS.default) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (parsed < DETECTION_LIMITS.min) {
    return DETECTION_LIMITS.min;
  }

  return Math.min(parsed, DETECTION_LIMITS.max);
}

/**
 * Normalizes the description length slider/input to safe bounds for UI rendering.
 * @param {number|string|undefined|null} value
 * @param {number} [fallback=DESCRIPTION_LENGTH_LIMITS.defaultPopup]
 * @returns {number}
 */
export function sanitizeDescriptionLength(
  value,
  fallback = DESCRIPTION_LENGTH_LIMITS.defaultPopup
) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (parsed < DESCRIPTION_LENGTH_LIMITS.min) {
    return DESCRIPTION_LENGTH_LIMITS.min;
  }

  return Math.min(parsed, DESCRIPTION_LENGTH_LIMITS.max);
}
