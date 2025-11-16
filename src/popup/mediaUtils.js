import {
  AVAILABILITY_STATUS_LABELS,
  REQUEST_STATUS_LABELS
} from '../lib/config.js';
import { extractYearFromString, normalizeText as normalize } from '../lib/text.js';

export function dedupeMedia(list = []) {
  const buckets = new Map();

  list.forEach((item) => {
    if (!item) {
      return;
    }
    const normalizedTitle = normalize(item.title);
    if (!normalizedTitle) {
      return;
    }

    const releaseKey = extractYearFromString(item.releaseYear);
    const mediaType = item.mediaType === 'tv' ? 'tv' : 'movie';
    const bucketKey = `${normalizedTitle}-${releaseKey || ''}-${mediaType}`;
    const existing = buckets.get(bucketKey);
    if (!existing) {
      buckets.set(bucketKey, item);
      return;
    }

    buckets.set(bucketKey, pickPreferredMedia(existing, item));
  });

  return Array.from(buckets.values());
}

export function pickPreferredMedia(current, incoming) {
  const currentScore = mediaCompletenessScore(current);
  const incomingScore = mediaCompletenessScore(incoming);
  if (incomingScore > currentScore) {
    return incoming;
  }
  if (
    incomingScore === currentScore &&
    incoming.source === 'overseerr' &&
    current.source !== 'overseerr'
  ) {
    return incoming;
  }
  return current;
}

export function mediaCompletenessScore(media = {}) {
  let score = 0;
  if (media.tmdbId) {
    score += 4;
  }
  if (typeof media.rating === 'number') {
    score += 2;
  }
  if (media.poster) {
    score += 1;
  }
  if (media.overview) {
    score += 1;
  }
  if (media.source && media.source !== 'detector') {
    score += 1;
  }
  return score;
}

export function truncateDescription(text, limit) {
  const safeText = `${text || ''}`;
  if (!limit || limit < 1 || safeText.length <= limit) {
    return safeText;
  }
  return `${safeText.slice(0, limit)}...`;
}

export function buildRequestActionState(media = {}, options = {}) {
  const availabilityLabel = buildAvailabilityStatusLabel(media?.availabilityStatus);
  if (availabilityLabel) {
    return {
      type: 'status',
      label: availabilityLabel
    };
  }

  const requestLabel = buildRequestStatusLabel(media?.requestStatus);
  if (requestLabel) {
    return {
      type: 'status',
      label: requestLabel
    };
  }

  return {
    type: 'button',
    label: 'Request',
    disabled: !options.canSubmitRequest
  };
}

export function buildAvailabilityStatusLabel(value) {
  if (typeof value !== 'number' || value === 1) {
    return '';
  }
  const availabilityLabel = formatAvailabilityStatus(value);
  return availabilityLabel ? buildStatusLabel('Media', availabilityLabel) : '';
}

export function buildRequestStatusLabel(value) {
  if (typeof value !== 'number') {
    return '';
  }
  const requestLabel = formatRequestStatus(value);
  return requestLabel ? buildStatusLabel('Request', requestLabel) : '';
}

export function buildStatusLabel(prefix, message) {
  if (!message) {
    return '';
  }
  if (!prefix) {
    return message;
  }
  return `${prefix} ${message.toLowerCase()}`;
}

export function extractMediaInfoStatuses(mediaInfo) {
  const availability = typeof mediaInfo?.status === 'number' ? mediaInfo.status : null;
  let requestStatus = null;
  if (Array.isArray(mediaInfo?.requests) && mediaInfo.requests.length) {
    const sorted = [...mediaInfo.requests].sort((a, b) => {
      const aTime = new Date(a?.createdAt || 0).getTime();
      const bTime = new Date(b?.createdAt || 0).getTime();
      return bTime - aTime;
    });
    const latest = sorted[0];
    if (latest && typeof latest.status === 'number') {
      requestStatus = latest.status;
    }
  }

  return { availability, requestStatus };
}

export function prepareStatusReadyList(list, canCheckStatus) {
  return list.map((item) => {
    if (!item || !isOverseerrTrackableMedia(item.mediaType)) {
      return item;
    }
    const hasEmbeddedStatus =
      typeof item.availabilityStatus === 'number' || typeof item.requestStatus === 'number';
    const shouldFetch = Boolean(canCheckStatus && item.tmdbId && !hasEmbeddedStatus);
    return {
      ...item,
      showStatus: true,
      statusLoading: shouldFetch,
      availabilityStatus: shouldFetch ? null : item.availabilityStatus ?? null,
      requestStatus: shouldFetch ? null : item.requestStatus ?? null,
      statusError: ''
    };
  });
}

export function prepareRatingsReadyList(list, canFetchRatings) {
  return list.map((item) => {
    if (!item) {
      return item;
    }
    if (!isOverseerrTrackableMedia(item.mediaType)) {
      return { ...item, showRatings: false };
    }
    const hasRatings = hasRatingData(item.ratings);
    const shouldFetch = Boolean(canFetchRatings && item.tmdbId && !hasRatings);
    return {
      ...item,
      showRatings: true,
      ratingsLoading: shouldFetch,
      ratings: hasRatings ? item.ratings : null,
      ratingsError: ''
    };
  });
}

export function hasRatingData(ratings) {
  if (!ratings || typeof ratings !== 'object') {
    return false;
  }
  return Boolean(ratings.rt || ratings.imdb);
}

export function formatAvailabilityStatus(value) {
  if (typeof value !== 'number') {
    return '';
  }
  return AVAILABILITY_STATUS_LABELS[value] || '';
}

export function formatRequestStatus(value) {
  if (typeof value !== 'number') {
    return '';
  }
  return REQUEST_STATUS_LABELS[value] || '';
}

export function isOverseerrTrackableMedia(mediaType) {
  return mediaType === 'movie' || mediaType === 'tv';
}
