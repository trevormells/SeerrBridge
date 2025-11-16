import { CORE_SETTINGS_KEYS, loadSettings } from '../lib/settings.js';
import {
  executeOverseerrRequest,
  OverseerrAuthError,
  logOverseerrFailure,
  fetchOverseerrStatus
} from '../lib/overseerr.js';
import { buildOverseerrUrl, sanitizeBaseUrl } from '../lib/url.js';

/**
 * @typedef {import('../lib/types.js').OverseerrRequestPayload} OverseerrRequestPayload
 * @typedef {import('../lib/types.js').OverseerrSearchPayload} OverseerrSearchPayload
 * @typedef {import('../lib/types.js').OverseerrStatusPayload} OverseerrStatusPayload
 * @typedef {import('../lib/types.js').CheckOverseerrSessionPayload} CheckOverseerrSessionPayload
 * @typedef {import('../lib/types.js').CheckOverseerrStatusPayload} CheckOverseerrStatusPayload
 * @typedef {import('../lib/types.js').OverseerrRatingsPayload} OverseerrRatingsPayload
 */

const STORAGE_KEYS = CORE_SETTINGS_KEYS;
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000;
const sessionCache = new Map();
const pendingLoginTabs = new Map();

const runtimeHandlers = {
  OVERSEERR_SEARCH: handleOverseerrSearch,
  SEND_OVERSEERR_REQUEST: handleOverseerrRequest,
  FETCH_OVERSEERR_MEDIA_STATUS: handleOverseerrMediaStatus,
  FETCH_OVERSEERR_RATINGS: handleOverseerrRatings,
  CHECK_OVERSEERR_SESSION: handleCheckOverseerrSession,
  CHECK_OVERSEERR_STATUS: handleCheckOverseerrStatus
};

export function createRuntimeMessageListener(handlers = runtimeHandlers) {
  return (message, sender, sendResponse) => {
    if (!message?.type) {
      return;
    }

    const handler = handlers[message.type];
    if (!handler) {
      return;
    }

    Promise.resolve()
      .then(() => handler(message.payload || {}))
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => {
        console.error('Background handler failed', {
          type: message.type,
          error
        });

        const payload = { ok: false, error: error?.message || 'Unknown error' };
        if (error instanceof OverseerrAuthError) {
          payload.code = error.code;
        }
        sendResponse(payload);
      });

    return true;
  };
}

export const runtimeMessageListener = createRuntimeMessageListener();

const hasChrome = typeof chrome !== 'undefined';
if (hasChrome && chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(runtimeMessageListener);
}

/**
 * Handles popup search requests by proxying to the Overseerr API.
 * @param {OverseerrSearchPayload} param0
 */
async function handleOverseerrSearch({ query, page = 1, year }) {
  if (!query) {
    throw new Error('Search query required.');
  }

  const settings = await getSettings();
  if (!settings.overseerrUrl) {
    throw new Error('Add your Overseerr URL in the extension options.');
  }

  const sanitizedBase = sanitizeBaseUrl(settings.overseerrUrl);
  let searchText = query;
  if (Number.isFinite(year)) {
    const yearValue = Number.parseInt(year, 10);
    if (!Number.isNaN(yearValue)) {
      searchText = `${searchText} year:${yearValue}`;
    }
  }
  const encodedQuery = encodeURIComponent(searchText);
  const params = new URLSearchParams({
    page: `${Math.max(1, Number.parseInt(page, 10) || 1)}`
  });

  const endpointWithQuery = `/api/v1/search?query=${encodedQuery}&${params.toString()}`;
  const { response, url } = await executeOverseerrRequest(
    sanitizedBase,
    endpointWithQuery,
    {},
    { onAuthFailure: createAuthFailureHandler(sanitizedBase, false) }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error('Overseerr search failed', {
      endpoint: url,
      status: response.status,
      statusText: response.statusText,
      responseBody: typeof text === 'string' ? text.slice(0, 500) : text
    });
    throw new Error(`Overseerr search error: ${response.status}`);
  }

  const payload = await response.json().catch(() => ({}));
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const filtered = results.filter((item) => item?.mediaType === 'movie' || item?.mediaType === 'tv');
  return {
    results: filtered.length ? [filtered[0]] : []
  };
}

/**
 * Issues Overseerr requests for matched media on behalf of the popup.
 * @param {OverseerrRequestPayload} param0
 */
async function handleOverseerrRequest({ tmdbId, mediaType }) {
  if (!tmdbId) {
    throw new Error('Missing TMDB id.');
  }

  const settings = await getSettings();
  if (!settings.overseerrUrl) {
    throw new Error('Add your Overseerr URL in the options page.');
  }

  const sanitizedBase = sanitizeBaseUrl(settings.overseerrUrl);
  await ensureOverseerrSession(sanitizedBase, { openLoginTabOnFailure: true });
  const normalizedType = mediaType === 'tv' ? 'tv' : 'movie';
  const body = {
    mediaType: normalizedType,
    mediaId: tmdbId,
    is4k: Boolean(settings.prefer4k)
  };

  if (normalizedType === 'tv') {
    // Request all seasons by default; Overseerr expects at least one entry for TV.
    body.seasons = [0];
  } else {
    body.seasons = [];
  }

  const { response, url } = await executeOverseerrRequest(
    sanitizedBase,
    '/api/v1/request',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    },
    {
      onAuthFailure: createAuthFailureHandler(sanitizedBase, true)
    }
  );

  if (!response.ok) {
    const text = await response.text();
    logOverseerrFailure({
      url,
      status: response.status,
      statusText: response.statusText,
      body,
      responseBody: text
    });
    throw new Error(
      `Overseerr error: ${response.status} ${
        text || response.statusText || 'Unknown error'
      }`
    );
  }

  const data = await response.json().catch(() => ({}));
  return { request: data };
}

/**
 * Fetches Overseerr availability/request statuses for a specific TMDB id.
 * @param {OverseerrStatusPayload} param0
 */
async function handleOverseerrMediaStatus({ tmdbId, mediaType }) {
  if (!tmdbId) {
    throw new Error('Missing TMDB id.');
  }

  const settings = await getSettings();
  if (!settings.overseerrUrl) {
    throw new Error('Add your Overseerr URL in the options page.');
  }

  const normalizedType = mediaType === 'tv' ? 'tv' : 'movie';
  const endpoint =
    normalizedType === 'tv'
      ? `/api/v1/tv/${encodeURIComponent(tmdbId)}`
      : `/api/v1/movie/${encodeURIComponent(tmdbId)}`;
  const sanitizedBase = sanitizeBaseUrl(settings.overseerrUrl);
  const { response, url } = await executeOverseerrRequest(
    sanitizedBase,
    endpoint,
    {},
    { onAuthFailure: createAuthFailureHandler(sanitizedBase, false) }
  );

  if (response.status === 404) {
    return { availability: null, requestStatus: null };
  }

  if (!response.ok) {
    const text = await response.text();
    console.error('Overseerr status lookup failed', {
      endpoint: url,
      status: response.status,
      statusText: response.statusText,
      responseBody: typeof text === 'string' ? text.slice(0, 500) : text
    });
    throw new Error(`Overseerr status error: ${response.status}`);
  }

  const payload = await response.json().catch(() => ({}));
  return deriveMediaInfoStatuses(payload?.mediaInfo);
}

/**
 * Fetches combined ratings metadata from Overseerr for a TMDB id.
 * @param {OverseerrRatingsPayload} param0
 */
async function handleOverseerrRatings({ tmdbId, mediaType }) {
  if (!tmdbId) {
    throw new Error('Missing TMDB id.');
  }

  const settings = await getSettings();
  if (!settings.overseerrUrl) {
    throw new Error('Add your Overseerr URL in the options page.');
  }

  const normalizedType = mediaType === 'tv' ? 'tv' : 'movie';
  const endpoint =
    normalizedType === 'tv'
      ? `/api/v1/tv/${encodeURIComponent(tmdbId)}/ratingscombined`
      : `/api/v1/movie/${encodeURIComponent(tmdbId)}/ratingscombined`;
  const sanitizedBase = sanitizeBaseUrl(settings.overseerrUrl);
  const { response, url } = await executeOverseerrRequest(
    sanitizedBase,
    endpoint,
    {},
    { onAuthFailure: createAuthFailureHandler(sanitizedBase, false) }
  );

  if (response.status === 404) {
    return { ratings: null };
  }

  if (!response.ok) {
    const text = await response.text();
    console.error('Overseerr ratings lookup failed', {
      endpoint: url,
      status: response.status,
      statusText: response.statusText,
      responseBody: typeof text === 'string' ? text.slice(0, 500) : text
    });
    throw new Error(`Overseerr ratings error: ${response.status}`);
  }

  const payload = await response.json().catch(() => ({}));
  return { ratings: payload };
}

function deriveMediaInfoStatuses(mediaInfo) {
  const availability =
    typeof mediaInfo?.status === 'number' ? mediaInfo.status : null;

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

function getSettings() {
  return loadSettings(STORAGE_KEYS);
}

/**
 * Validates the Overseerr URL by hitting the public status endpoint.
 * @param {CheckOverseerrStatusPayload} param0
 */
async function handleCheckOverseerrStatus({ overseerrUrl } = {}) {
  const base =
    overseerrUrl && overseerrUrl.trim()
      ? sanitizeBaseUrl(overseerrUrl)
      : sanitizeBaseUrl((await getSettings()).overseerrUrl || '');
  if (!base) {
    throw new Error('Add your Overseerr URL in the options page.');
  }

  const status = await fetchOverseerrStatus(base);
  return {
    baseUrl: base,
    version: status.version,
    commitTag: status.commitTag,
    updateAvailable: status.updateAvailable,
    commitsBehind: status.commitsBehind,
    restartRequired: status.restartRequired
  };
}

/**
 * Verifies the user's Overseerr session, optionally prompting for login.
 * @param {CheckOverseerrSessionPayload} param0
 */
async function handleCheckOverseerrSession({
  overseerrUrl,
  promptLogin = false,
  forceRefresh = false
} = {}) {
  const base =
    overseerrUrl && overseerrUrl.trim()
      ? sanitizeBaseUrl(overseerrUrl)
      : sanitizeBaseUrl((await getSettings()).overseerrUrl || '');
  if (!base) {
    throw new Error('Add your Overseerr URL in the options page.');
  }

  await ensureOverseerrSession(base, {
    openLoginTabOnFailure: promptLogin,
    forceRefresh
  });
  return { authenticated: true };
}

async function ensureOverseerrSession(baseUrl, options = {}) {
  const sanitized = sanitizeBaseUrl(baseUrl);
  const cached = sessionCache.get(sanitized);
  if (cached && cached.expiresAt > Date.now() && !options.forceRefresh) {
    return true;
  }

  const { response, url } = await executeOverseerrRequest(
    sanitized,
    '/api/v1/auth/me',
    {},
    {
      onAuthFailure: createAuthFailureHandler(sanitized, Boolean(options.openLoginTabOnFailure))
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error('Overseerr auth check failed', {
      endpoint: url,
      status: response.status,
      statusText: response.statusText,
      responseBody: typeof text === 'string' ? text.slice(0, 500) : text
    });
    throw new Error(`Overseerr status error: ${response.status}`);
  }

  const payload = await response.json().catch(() => ({}));
  if (!payload || typeof payload.id !== 'number') {
    throw new OverseerrAuthError('Log into Overseerr in the opened tab, then retry.');
  }

  if (typeof payload.userType === 'string' && payload.userType.toUpperCase() === 'GUEST') {
    throw new OverseerrAuthError('Log into Overseerr with an account that can make requests.');
  }

  sessionCache.set(sanitized, {
    expiresAt: Date.now() + SESSION_CACHE_TTL_MS
  });
  pendingLoginTabs.delete(sanitized);
  return true;
}
async function openOverseerrLoginTab(baseUrl) {
  if (!chrome?.tabs?.create) {
    return;
  }
  const sanitized = sanitizeBaseUrl(baseUrl);
  const loginUrl = buildOverseerrUrl(sanitized, '/login');
  const existingTabId = pendingLoginTabs.get(sanitized);

  if (existingTabId && Number.isInteger(existingTabId)) {
    try {
      await updateTab(existingTabId, { active: true });
      return;
    } catch (error) {
      pendingLoginTabs.delete(sanitized);
    }
  }

  try {
    const tab = await createTab({ url: loginUrl, active: true });
    if (tab?.id) {
      pendingLoginTabs.set(sanitized, tab.id);
    }
  } catch (error) {
    console.error('Unable to open Overseerr login tab', error);
  }
}

function createAuthFailureHandler(baseUrl, shouldOpenLoginTab) {
  return async () => {
    sessionCache.delete(baseUrl);
    if (shouldOpenLoginTab) {
      await openOverseerrLoginTab(baseUrl);
    }
  };
}

function createTab(options) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(options, (tab) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(tab);
      }
    });
  });
}

function updateTab(tabId, options) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, options, (tab) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(tab);
      }
    });
  });
}

if (hasChrome && chrome?.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    for (const [base, trackedId] of pendingLoginTabs.entries()) {
      if (trackedId === tabId) {
        pendingLoginTabs.delete(base);
        break;
      }
    }
  });
}
