const STORAGE_KEYS = ['overseerrUrl', 'prefer4k'];
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000;
const sessionCache = new Map();
const pendingLoginTabs = new Map();

class OverseerrAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OverseerrAuthError';
    this.code = 'AUTH_REQUIRED';
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) {
    return;
  }

  const handlers = {
    OVERSEERR_SEARCH: handleOverseerrSearch,
    SEND_OVERSEERR_REQUEST: handleOverseerrRequest,
    FETCH_OVERSEERR_MEDIA_STATUS: handleOverseerrMediaStatus,
    CHECK_OVERSEERR_SESSION: handleCheckOverseerrSession
  };

  const handler = handlers[message.type];
  if (!handler) {
    return;
  }

  handler(message.payload || {})
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      const payload = { ok: false, error: error.message || 'Unknown error' };
      if (error instanceof OverseerrAuthError) {
        payload.code = error.code;
      }
      sendResponse(payload);
    });

  return true;
});

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
    { openLoginTabOnFailure: false }
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
    { openLoginTabOnFailure: true }
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
    { openLoginTabOnFailure: false }
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
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(STORAGE_KEYS, (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(result || {});
      }
    });
  });
}

function buildOverseerrUrl(base, path) {
  const sanitized = sanitizeBaseUrl(base);
  return `${sanitized}${path}`;
}

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

function sanitizeBaseUrl(base) {
  if (!base) {
    throw new Error('Overseerr URL missing. Update the options page and try again.');
  }

  let candidate = base.trim();
  if (!candidate) {
    throw new Error('Overseerr URL missing. Update the options page and try again.');
  }

  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (error) {
    throw new Error(
      'Your Overseerr URL is invalid. Include http(s) and a valid host before requesting.'
    );
  }

  const cleanPath =
    parsed.pathname && parsed.pathname !== '/'
      ? parsed.pathname.replace(/\/+$/, '')
      : '';

  return `${parsed.origin}${cleanPath}`;
}

function logOverseerrFailure(details) {
  const snippet =
    typeof details.responseBody === 'string'
      ? details.responseBody.slice(0, 500)
      : details.responseBody;

  console.error('Overseerr request failed', {
    endpoint: details.url,
    status: details.status,
    statusText: details.statusText,
    requestBody: {
      mediaType: details.body?.mediaType,
      mediaId: details.body?.mediaId,
      is4k: details.body?.is4k,
      seasons: details.body?.seasons
    },
    responseBody: snippet
  });
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
    { openLoginTabOnFailure: options.openLoginTabOnFailure }
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

async function executeOverseerrRequest(
  baseUrl,
  endpoint,
  init = {},
  options = {}
) {
  const url = buildOverseerrUrl(baseUrl, endpoint);
  const requestInit = {
    credentials: 'include',
    ...init
  };

  let response;
  try {
    response = await fetch(url, requestInit);
  } catch (error) {
    throw new Error('Unable to reach Overseerr. Check your URL and try again.');
  }

  if (response.status === 401) {
    sessionCache.delete(sanitizeBaseUrl(baseUrl));
    if (options.openLoginTabOnFailure) {
      await openOverseerrLoginTab(baseUrl);
    }
    throw new OverseerrAuthError('Log into Overseerr in the opened tab, then retry.');
  }

  return { response, url };
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

if (chrome?.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    for (const [base, trackedId] of pendingLoginTabs.entries()) {
      if (trackedId === tabId) {
        pendingLoginTabs.delete(base);
        break;
      }
    }
  });
}
