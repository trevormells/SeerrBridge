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
 * Union representing media entries rendered in the popup lists.
 * @typedef {DetectedMediaCandidate & {
 *   tmdbId: number|null,
 *   overview?: string,
 *   rating?: number|null,
 *   availabilityStatus?: number|null,
 *   requestStatus?: number|null
 * }} EnrichedMediaItem
 */

/**
 * Settings stored in chrome.storage and shared between popup/options.
 * @typedef {Object} PopupSettings
 * @property {string} overseerrUrl
 * @property {boolean} prefer4k
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
