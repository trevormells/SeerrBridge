/**
 * Shared configuration constants referenced by multiple extension surfaces.
 */

/**
 * Limits applied to detector results to avoid overwhelming the popup UI.
 * @type {{default: number, min: number, max: number}}
 */
export const DETECTION_LIMITS = Object.freeze({
  default: 10,
  min: 1,
  max: 100
});

/**
 * Bounds for description text rendered in the popup/options surfaces.
 * @type {{defaultPopup: number, defaultOptions: number, min: number, max: number}}
 */
export const DESCRIPTION_LENGTH_LIMITS = Object.freeze({
  defaultPopup: 30,
  defaultOptions: 60,
  min: 10,
  max: 500
});

/**
 * Phrases frequently appended to YouTube titles that should be ignored when parsing.
 * These are documented to keep the detector and popup heuristics aligned.
 * @type {string[]}
 */
export const NOISE_PHRASES = Object.freeze([
  'official trailer',
  'trailer',
  'teaser',
  'teaser trailer',
  'final trailer',
  'clip',
  'movie clip',
  'behind the scenes',
  'bts',
  'interview',
  'featurette',
  'hd',
  '4k',
  '2024 new movie',
  'english subtitles'
]);

/**
 * Human friendly labels for Overseerr availability statuses indexed by numeric code.
 * @type {Record<number, string>}
 */
export const AVAILABILITY_STATUS_LABELS = Object.freeze({
  1: 'Unknown',
  2: 'Pending',
  3: 'Processing',
  4: 'Partially available',
  5: 'Available',
  6: 'Deleted'
});

/**
 * Human friendly labels for Overseerr request state codes.
 * @type {Record<number, string>}
 */
export const REQUEST_STATUS_LABELS = Object.freeze({
  1: 'Pending approval',
  2: 'Approved',
  3: 'Declined'
});
