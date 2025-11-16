import { buildOverseerrUrl, sanitizeBaseUrl } from './url.js';

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
    if (typeof options.onAuthFailure === 'function') {
      await options.onAuthFailure(sanitizedBase);
    }
    throw new OverseerrAuthError('Log into Overseerr in the opened tab, then retry.');
  }

  return { response, url };
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
