import { NOISE_PHRASES } from './config.js';

function escapeRegExp(text = '') {
  return String(text ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalizes strings for reliable comparisons and fuzzy matching.
 * @param {string} [str='']
 * @returns {string}
 */
export function normalizeText(str = '') {
  return String(str ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Removes noisy tokens commonly appended to video titles before searching Overseerr.
 * @param {string} [value='']
 * @returns {string}
 */
export function stripNoise(value = '') {
  let text = normalizeText(String(value ?? '').toLowerCase());
  NOISE_PHRASES.forEach((phrase) => {
    const re = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'gi');
    text = text.replace(re, '');
  });
  text = text.replace(/[\|\-–—]+/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Extracts sanitized Overseerr search inputs from noisy titles.
 * @param {string} [value='']
 * @returns {{coreTitle: string, year: number|null}}
 */
export function extractTitleAndYear(value = '') {
  const stripped = stripNoise(value);

  const yearMatch = stripped.match(/\((\d{4})\)/);
  let year = null;
  let core = stripped;
  if (yearMatch) {
    year = Number.parseInt(yearMatch[1], 10);
    core = stripped.slice(0, yearMatch.index).trim();
  }

  const sepIndex = core.search(/[\|\-–—:]/);
  if (sepIndex > 0) {
    core = core.slice(0, sepIndex).trim();
  }

  return { coreTitle: core, year };
}

/**
 * Pulls a four digit year from arbitrary text for grouping/heuristics.
 * @param {string|number} value
 * @returns {string}
 */
export function extractYearFromString(value) {
  if (!value) {
    return '';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}`;
  }
  const match = String(value).match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : '';
}
