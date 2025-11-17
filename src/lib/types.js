/**
 * @typedef {'movie' | 'tv'} MediaType
 */

/**
 * Structured candidate emitted by the content script detector.
 * @typedef {Object} DetectedMediaCandidate
 * @property {string} title
 * @property {string} [subtitle]
 * @property {string} [poster]
 * @property {string|number|null} [releaseYear]
 * @property {MediaType} [mediaType]
 * @property {string} [source]
 */

/**
 * Message payload returned from the detector to the popup.
 * @typedef {Object} DetectionResponse
 * @property {DetectedMediaCandidate[]} items
 * @property {DetectedMediaCandidate[]} weak_detections
 */

/**
 * Represents third-party ratings captured by Overseerr.
 * @typedef {Object} MediaRatingsEntry
 * @property {string} [title]
 * @property {number|string} [year]
 * @property {string} [url]
 * @property {number} [criticsScore]
 * @property {string} [criticsRating]
 * @property {number} [audienceScore]
 * @property {string} [audienceRating]
 */

/**
 * Combined ratings payload keyed by provider.
 * @typedef {Object} MediaRatings
 * @property {MediaRatingsEntry|null} [rt]
 * @property {MediaRatingsEntry|null} [imdb]
 */

/**
 * Union representing media entries rendered in the popup lists.
 * @typedef {DetectedMediaCandidate & {
 *   tmdbId: number|null,
 *   overview?: string,
 *   rating?: number|null,
 *   ratings?: MediaRatings|null,
 *   ratingsLoading?: boolean,
 *   ratingsError?: string,
 *   showRatings?: boolean,
 *   availabilityStatus?: number|null,
 *   requestStatus?: number|null
 * }} EnrichedMediaItem
 */

/**
 * Settings stored in chrome.storage and shared between popup/options.
 * @typedef {Object} PopupSettings
 * @property {string} overseerrUrl
 * @property {boolean} prefer4k
 * @property {string} [overseerrApiKey]
 * @property {string} [overseerrAuthMethod]
 * @property {boolean} showWeakDetections
 * @property {number} maxDetections
 * @property {number} descriptionLength
 */

/**
 * Runtime state managed by the popup UI.
 * @typedef {Object} PopupState
 * @property {PopupSettings} settings
 * @property {EnrichedMediaItem[]} detected
 * @property {EnrichedMediaItem[]} weakDetections
 * @property {EnrichedMediaItem[]} searchResults
 * @property {boolean} overseerrSessionReady
 * @property {string} overseerrSessionError
 */

/**
 * Payload for requesting Overseerr searches via the background worker.
 * @typedef {Object} OverseerrSearchPayload
 * @property {string} query
 * @property {number} [page]
 * @property {number} [year]
 */

/**
 * Payload for submitting Overseerr requests through the background worker.
 * @typedef {Object} OverseerrRequestPayload
 * @property {number} tmdbId
 * @property {MediaType} mediaType
 */

/**
 * Payload for status lookups.
 * @typedef {Object} OverseerrStatusPayload
 * @property {number} tmdbId
 * @property {MediaType} mediaType
 */

/**
 * Payload for requesting Overseerr ratings metadata.
 * @typedef {Object} OverseerrRatingsPayload
 * @property {number} tmdbId
 * @property {MediaType} mediaType
 */

/**
 * Payload for session checks triggered from popup/options.
 * @typedef {Object} CheckOverseerrSessionPayload
 * @property {string} [overseerrUrl]
 * @property {boolean} [promptLogin]
 * @property {boolean} [forceRefresh]
 */

/**
 * Payload for verifying Overseerr server metadata.
 * @typedef {Object} CheckOverseerrStatusPayload
 * @property {string} [overseerrUrl]
 */

export {};
