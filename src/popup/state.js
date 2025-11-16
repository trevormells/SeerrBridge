import { DESCRIPTION_LENGTH_LIMITS, DETECTION_LIMITS } from '../lib/config.js';

export const state = {
  settings: {
    overseerrUrl: '',
    prefer4k: false,
    showWeakDetections: false,
    maxDetections: DETECTION_LIMITS.default,
    descriptionLength: DESCRIPTION_LENGTH_LIMITS.defaultPopup
  },
  detected: [],
  weakDetections: [],
  searchResults: [],
  overseerrSessionReady: false,
  overseerrSessionError: ''
};

export const setupState = {
  visible: false,
  running: false
};

export const statusRequestTokens = {
  detected: 0,
  weak: 0,
  search: 0
};

export const ratingsRequestTokens = {
  detected: 0,
  weak: 0,
  search: 0
};
