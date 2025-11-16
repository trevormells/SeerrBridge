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
