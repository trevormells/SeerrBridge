/**
 * Best-effort normalization for user-supplied Overseerr URLs.
 * Returns an empty string when the input cannot be interpreted.
 * @param {string} [value='']
 * @returns {string}
 */
export function normalizeBaseUrl(value = '') {
  if (!value) {
    return '';
  }

  let candidate = value.trim();
  if (!candidate) {
    return '';
  }

  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    const path =
      parsed.pathname && parsed.pathname !== '/'
        ? parsed.pathname.replace(/\/+$/, '')
        : '';
    return `${parsed.origin}${path}`;
  } catch (error) {
    return candidate.replace(/\/+$/, '');
  }
}

/**
 * Strict Overseerr URL sanitizer that throws when the input is unusable.
 * @param {string} base
 * @returns {string}
 */
export function sanitizeBaseUrl(base) {
  const normalized = normalizeBaseUrl(base);
  if (!normalized) {
    throw new Error('Overseerr URL missing. Update the options page and try again.');
  }

  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error(
      'Your Overseerr URL is invalid. Include http(s) and a valid host before requesting.'
    );
  }

  try {
    // eslint-disable-next-line no-new
    new URL(normalized);
    return normalized;
  } catch (error) {
    throw new Error(
      'Your Overseerr URL is invalid. Include http(s) and a valid host before requesting.'
    );
  }
}

/**
 * Builds a fully-qualified Overseerr endpoint from the configured base URL.
 * @param {string} base
 * @param {string} path
 * @returns {string}
 */
export function buildOverseerrUrl(base, path) {
  return `${sanitizeBaseUrl(base)}${path}`;
}
