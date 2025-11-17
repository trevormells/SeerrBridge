import { buildOverseerrUrl, sanitizeBaseUrl } from './url.js';

export const OVERSEERR_AUTH_MODES = Object.freeze({
  COOKIES: 'cookies',
  API_KEY: 'api-key',
  COOKIES_WITH_API_KEY_FALLBACK: 'cookies-with-api-key-fallback'
});

export class OverseerrAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OverseerrAuthError';
    this.code = 'AUTH_REQUIRED';
  }
}

/**
 * Executes an Overseerr HTTP request with consistent error handling.
 * @param {string} baseUrl
 * @param {string} endpoint
 * @param {RequestInit} [init]
 * @param {{onAuthFailure?: (base: string) => (Promise<void>|void)}} [options]
 * @returns {Promise<{response: Response, url: string}>}
 */
export async function executeOverseerrRequest(baseUrl, endpoint, init = {}, options = {}) {
  const sanitizedBase = sanitizeBaseUrl(baseUrl);
  const url = buildOverseerrUrl(sanitizedBase, endpoint);
  const normalizedAuth = normalizeAuthStrategy(options.authStrategy);

  const fetchWithMode = async (mode) => {
    const requestInit = buildRequestInit(init, mode, normalizedAuth.apiKey);
    try {
      return await fetch(url, requestInit);
    } catch (error) {
      throw new Error('Unable to reach Overseerr. Check your URL and try again.');
    }
  };

  let usedAuthMode = normalizedAuth.mode;
  let response = await fetchWithMode(usedAuthMode);

  if (response.status === 401 && normalizedAuth.allowApiKeyFallback) {
    usedAuthMode = OVERSEERR_AUTH_MODES.API_KEY;
    response = await fetchWithMode(usedAuthMode);
  }

  if (response.status === 401) {
    if (usedAuthMode !== OVERSEERR_AUTH_MODES.API_KEY && typeof options.onAuthFailure === 'function') {
      await options.onAuthFailure(sanitizedBase);
    }

    const message =
      usedAuthMode === OVERSEERR_AUTH_MODES.API_KEY
        ? 'Update your Overseerr API key, then retry.'
        : 'Log into Overseerr in the opened tab, then retry.';
    throw new OverseerrAuthError(message);
  }

  return { response, url, authMode: usedAuthMode };
}

/**
 * Emits a trimmed down request failure payload to aid debugging.
 * @param {{
 *   url: string,
 *   status: number,
 *   statusText: string,
 *   body?: Record<string, any>,
 *   responseBody?: string
 * }} details
 */
export function logOverseerrFailure(details) {
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

/**
 * Retrieves Overseerr server metadata from the public status endpoint.
 * @param {string} baseUrl
 */
export async function fetchOverseerrStatus(baseUrl) {
  const sanitizedBase = sanitizeBaseUrl(baseUrl);
  if (!sanitizedBase) {
    throw new Error('Add your Overseerr URL in the options page.');
  }

  const { response, url } = await executeOverseerrRequest(
    sanitizedBase,
    '/api/v1/status',
    { credentials: 'omit' }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error('Overseerr status check failed', {
      endpoint: url,
      status: response.status,
      statusText: response.statusText,
      responseBody: typeof text === 'string' ? text.slice(0, 500) : text
    });
    throw new Error(`Overseerr status error: ${response.status}`);
  }

  const payload = await response.json().catch(() => ({}));
  const version = typeof payload?.version === 'string' ? payload.version : null;
  if (!version) {
    throw new Error('Unable to determine Overseerr version. Verify the URL and try again.');
  }

  const commitTag = typeof payload?.commitTag === 'string' ? payload.commitTag : null;
  const commitsBehind = Number.isFinite(payload?.commitsBehind)
    ? Number(payload.commitsBehind)
    : null;

  return {
    version,
    commitTag,
    updateAvailable: Boolean(payload?.updateAvailable),
    commitsBehind,
    restartRequired: Boolean(payload?.restartRequired),
    endpoint: url,
    raw: payload
  };
}

function normalizeAuthStrategy(strategy = {}) {
  const providedMode = typeof strategy.mode === 'string' ? strategy.mode : null;
  const trimmedKey = typeof strategy.apiKey === 'string' ? strategy.apiKey.trim() : '';
  const hasKey = Boolean(trimmedKey);

  if (providedMode === OVERSEERR_AUTH_MODES.API_KEY && hasKey) {
    return { mode: OVERSEERR_AUTH_MODES.API_KEY, apiKey: trimmedKey, allowApiKeyFallback: false };
  }

  if (providedMode === OVERSEERR_AUTH_MODES.COOKIES_WITH_API_KEY_FALLBACK && hasKey) {
    return {
      mode: OVERSEERR_AUTH_MODES.COOKIES,
      apiKey: trimmedKey,
      allowApiKeyFallback: true
    };
  }

  return { mode: OVERSEERR_AUTH_MODES.COOKIES, apiKey: hasKey ? trimmedKey : null, allowApiKeyFallback: false };
}

function buildRequestInit(baseInit, authMode, apiKey) {
  const headers = new Headers(baseInit.headers || undefined);
  if (authMode === OVERSEERR_AUTH_MODES.API_KEY && apiKey) {
    headers.set('X-Api-Key', apiKey);
  } else {
    headers.delete('X-Api-Key');
  }

  const requestInit = {
    ...baseInit,
    headers
  };

  if (authMode === OVERSEERR_AUTH_MODES.API_KEY) {
    requestInit.credentials = 'omit';
  } else {
    requestInit.credentials = baseInit.credentials ?? 'include';
  }

  return requestInit;
}
