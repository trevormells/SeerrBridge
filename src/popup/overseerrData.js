import { extractMediaInfoStatuses } from './mediaUtils.js';

export function selectBestOverseerrMatch(results, preferredMediaType) {
  if (!Array.isArray(results) || !results.length) {
    return null;
  }
  if (preferredMediaType === 'movie' || preferredMediaType === 'tv') {
    const exact = results.find((item) => item?.mediaType === preferredMediaType);
    if (exact) {
      return exact;
    }
  }
  return results[0];
}

export function buildPosterUrl(path) {
  return path ? `https://image.tmdb.org/t/p/w200${path}` : '';
}

export function normalizeOverseerrResult(result = {}) {
  const mediaType = result.mediaType === 'tv' ? 'tv' : 'movie';
  const primaryTitle = mediaType === 'tv' ? result.name : result.title;
  const fallbackTitle = mediaType === 'tv' ? result.title : result.name;
  const resolvedTitle = primaryTitle || fallbackTitle || '';
  const releaseDate = mediaType === 'tv' ? result.firstAirDate : result.releaseDate;
  const releaseYear = releaseDate ? new Date(releaseDate).getFullYear() : Number.NaN;
  const statuses = extractMediaInfoStatuses(result.mediaInfo);
  return {
    title: resolvedTitle,
    releaseYear: Number.isNaN(releaseYear) ? '' : String(releaseYear),
    overview: result.overview || '',
    poster: buildPosterUrl(result.posterPath),
    mediaType,
    tmdbId: typeof result.id === 'number' ? result.id : result.tmdbId ?? null,
    rating: typeof result.voteAverage === 'number' ? result.voteAverage : null,
    source: 'overseerr',
    availabilityStatus: statuses.availability,
    requestStatus: statuses.requestStatus
  };
}

export function normalizeCombinedRatings(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const normalized = {};
  const rt = normalizeRatingsEntry(payload.rt);
  if (rt) {
    normalized.rt = rt;
  }
  const imdb = normalizeRatingsEntry(payload.imdb);
  if (imdb) {
    normalized.imdb = imdb;
  }
  return Object.keys(normalized).length ? normalized : null;
}

export function normalizeRatingsEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const normalized = {};
  if (typeof entry.title === 'string' && entry.title.trim()) {
    normalized.title = entry.title.trim();
  }
  const yearValue = Number.parseInt(entry.year, 10);
  if (!Number.isNaN(yearValue)) {
    normalized.year = yearValue;
  }
  if (typeof entry.url === 'string' && entry.url.trim()) {
    normalized.url = entry.url.trim();
  }
  const criticsScore = coerceScore(entry.criticsScore);
  if (criticsScore !== null) {
    normalized.criticsScore = criticsScore;
  }
  const audienceScore = coerceScore(entry.audienceScore);
  if (audienceScore !== null) {
    normalized.audienceScore = audienceScore;
  }
  if (typeof entry.criticsRating === 'string' && entry.criticsRating.trim()) {
    normalized.criticsRating = entry.criticsRating.trim();
  }
  if (typeof entry.audienceRating === 'string' && entry.audienceRating.trim()) {
    normalized.audienceRating = entry.audienceRating.trim();
  }
  return Object.keys(normalized).length ? normalized : null;
}

export function coerceScore(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}
