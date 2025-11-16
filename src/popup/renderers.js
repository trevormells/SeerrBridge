import { DESCRIPTION_LENGTH_LIMITS } from '../lib/config.js';
import { sanitizeDescriptionLength } from '../lib/sanitizers.js';
import { normalizeText as normalize } from '../lib/text.js';
import { state } from './state.js';
import {
  buildRequestActionState,
  formatAvailabilityStatus,
  formatRequestStatus,
  isOverseerrTrackableMedia,
  truncateDescription
} from './mediaUtils.js';

let rendererContext = {
  setStatus: () => {},
  handleRequest: () => {},
  openOverseerrMedia: () => {},
  openOverseerrSearch: () => {},
  canSubmitRequest: () => false,
  canFetchOverseerrRatings: () => false,
  canCheckOverseerrStatus: () => false
};

export function configureRendererContext(context = {}) {
  rendererContext = { ...rendererContext, ...context };
}

export function renderMediaList(list, container, emptyElement) {
  if (!container || !emptyElement) {
    return;
  }
  container.innerHTML = '';
  if (!list.length) {
    emptyElement.classList.remove('hidden');
    return;
  }

  emptyElement.classList.add('hidden');
  list.forEach((media) => {
    const card = createMediaCard(media);
    container.appendChild(card);
  });
}

function createMediaCard(media) {
  const li = document.createElement('li');
  li.className = 'media-card';

  const poster = document.createElement('img');
  poster.alt = media.title;
  poster.src = media.poster || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

  const info = document.createElement('div');
  info.className = 'media-info';

  const title = document.createElement('h3');
  title.textContent = media.title;

  const meta = document.createElement('p');
  const badges = [`${media.mediaType === 'tv' ? 'TV' : 'Movie'}`];
  if (media.releaseYear) {
    badges.push(media.releaseYear);
  }
  if (typeof media.rating === 'number') {
    badges.push(`Score ${media.rating.toFixed(1)}`);
  }
  meta.innerHTML = badges.map((text) => `<span class="badge">${text}</span>`).join('');

  const overview = document.createElement('p');
  overview.className = 'media-overview';
  const overviewSource = (media.overview || '').trim() || 'No description available yet.';
  const descriptionLimit = sanitizeDescriptionLength(
    state.settings.descriptionLength,
    DESCRIPTION_LENGTH_LIMITS.defaultPopup
  );
  const truncatedOverview = truncateDescription(overviewSource, descriptionLimit);
  overview.textContent = truncatedOverview;
  if (truncatedOverview !== overviewSource) {
    overview.classList.add('is-toggleable');
    overview.dataset.expanded = 'false';
    overview.title = 'Click to expand description';
    overview.addEventListener('click', () => {
      const expanded = overview.dataset.expanded === 'true';
      overview.textContent = expanded ? truncatedOverview : overviewSource;
      overview.dataset.expanded = expanded ? 'false' : 'true';
      overview.classList.toggle('is-expanded', !expanded);
      overview.title = expanded ? 'Click to expand description' : 'Click to collapse description';
    });
  }

  const footer = document.createElement('div');
  footer.className = 'media-footer';

  const requestAction = createMediaRequestAction(media);
  if (requestAction) {
    footer.appendChild(requestAction);
  }

  const hasOverseerrUrl = Boolean(state.settings.overseerrUrl);
  const normalizedTitle = normalize(media.title);

  const overseerrButton = document.createElement('button');
  overseerrButton.type = 'button';
  overseerrButton.className = 'media-overseerr-button';
  if (media.tmdbId) {
    overseerrButton.title = 'Go to Overseerr';
    overseerrButton.setAttribute('aria-label', 'Go to Overseerr');
    overseerrButton.dataset.variant = 'open';
    overseerrButton.disabled = !hasOverseerrUrl;
    overseerrButton.addEventListener('click', () => rendererContext.openOverseerrMedia(media));
  } else {
    overseerrButton.title = 'Search on Overseerr';
    overseerrButton.setAttribute('aria-label', 'Search on Overseerr');
    overseerrButton.dataset.variant = 'search';
    overseerrButton.disabled = !hasOverseerrUrl || !normalizedTitle;
    overseerrButton.addEventListener('click', () => {
      const targetTitle = normalize(media.title);
      if (!targetTitle) {
        rendererContext.setStatus('Add the title before searching Overseerr.', 'warning');
        return;
      }
      rendererContext.openOverseerrSearch(targetTitle);
    });
  }

  info.appendChild(title);
  info.appendChild(meta);
  info.appendChild(overview);
  const ratingsBlock = createRatingsBlock(media);
  if (ratingsBlock) {
    info.appendChild(ratingsBlock);
  }
  const statusBlock = createOverseerrStatusBlock(media);
  if (statusBlock) {
    info.appendChild(statusBlock);
  }
  info.appendChild(footer);

  const posterColumn = document.createElement('div');
  posterColumn.className = 'media-poster-column';
  posterColumn.appendChild(poster);
  posterColumn.appendChild(overseerrButton);

  li.appendChild(posterColumn);
  li.appendChild(info);

  return li;
}

function createMediaRequestAction(media) {
  if (!media) {
    return null;
  }

  if (!media.tmdbId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Search on Overseerr';
    const normalizedTitle = normalize(media.title);
    const hasOverseerrUrl = Boolean(state.settings.overseerrUrl);
    button.disabled = !hasOverseerrUrl || !normalizedTitle;
    button.addEventListener('click', () => {
      const targetTitle = normalize(media.title);
      if (!targetTitle) {
        rendererContext.setStatus('Add the title before searching Overseerr.', 'warning');
        return;
      }
      rendererContext.openOverseerrSearch(targetTitle);
    });
    return button;
  }

  if (!isOverseerrTrackableMedia(media.mediaType)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Unsupported media type';
    button.disabled = true;
    return button;
  }

  const actionState = buildRequestActionState(media, {
    canSubmitRequest: rendererContext.canSubmitRequest()
  });
  if (actionState.type === 'status') {
    const statusLabel = document.createElement('span');
    statusLabel.className = 'request-status-label';
    statusLabel.textContent = actionState.label;
    return statusLabel;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = actionState.label;
  button.disabled = actionState.disabled;
  button.addEventListener('click', () => rendererContext.handleRequest(media, button));
  return button;
}

function createRatingsBlock(media) {
  if (!media?.showRatings) {
    return null;
  }

  const container = document.createElement('div');
  container.className = 'media-ratings';

  if (!rendererContext.canFetchOverseerrRatings()) {
    const message = state.settings.overseerrUrl
      ? 'Log into Overseerr to load ratings.'
      : 'Add your Overseerr URL to load ratings.';
    container.textContent = message;
    container.classList.add('is-muted');
    return container;
  }

  if (!media.tmdbId) {
    container.textContent = 'Match via Overseerr search to load ratings.';
    container.classList.add('is-muted');
    return container;
  }

  if (media.ratingsLoading) {
    container.textContent = 'Loading ratings…';
    return container;
  }

  if (media.ratingsError) {
    container.textContent = media.ratingsError;
    container.classList.add('is-error');
    return container;
  }

  const entries = buildRatingEntries(media.ratings);
  if (!entries.length) {
    container.textContent = 'Ratings unavailable.';
    container.classList.add('is-muted');
    return container;
  }

  entries.forEach((entry) => {
    const chip = document.createElement('div');
    chip.className = 'rating-chip';
    chip.dataset.source = entry.provider;
    if (entry.id) {
      chip.dataset.variant = entry.id;
    }
    if (entry.tooltip) {
      chip.title = entry.tooltip;
      chip.setAttribute('aria-label', entry.tooltip);
    }

    const icon = document.createElement('span');
    icon.className = `rating-chip__icon rating-chip__icon--${entry.icon || entry.provider}`;
    icon.setAttribute('aria-hidden', 'true');
    chip.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'rating-chip__text';
    label.textContent = entry.display;
    chip.appendChild(label);

    container.appendChild(chip);
  });

  return container;
}

function createOverseerrStatusBlock(media) {
  if (!media || !isOverseerrTrackableMedia(media.mediaType)) {
    return null;
  }

  const container = document.createElement('div');
  container.className = 'media-status';

  if (!media.tmdbId) {
    container.textContent = 'Match via Overseerr search to check Overseerr status.';
    return container;
  }

  if (!rendererContext.canCheckOverseerrStatus()) {
    container.textContent = 'Add Overseerr settings to check status.';
    container.classList.add('is-error');
    return container;
  }

  if (media.statusLoading) {
    container.textContent = 'Checking Overseerr status…';
    return container;
  }

  if (media.statusError) {
    container.textContent = media.statusError;
    container.classList.add('is-error');
    return container;
  }

  const availabilityLabel = formatAvailabilityStatus(media.availabilityStatus);
  const requestLabel = formatRequestStatus(media.requestStatus);

  const lines = [];
  if (availabilityLabel) {
    const availabilityLine = document.createElement('span');
    availabilityLine.textContent = `Availability: ${availabilityLabel}`;
    lines.push(availabilityLine);
  }
  if (requestLabel) {
    const requestLine = document.createElement('span');
    requestLine.textContent = `Request: ${requestLabel}`;
    lines.push(requestLine);
  }

  if (!lines.length) {
    const idleLine = document.createElement('span');
    idleLine.textContent = 'No Overseerr activity yet.';
    lines.push(idleLine);
  }

  lines.forEach((line) => container.appendChild(line));
  return container;
}

export function buildRatingEntries(ratings) {
  if (!ratings || typeof ratings !== 'object') {
    return [];
  }
  const entries = [];
  const rtEntry = ratings.rt;
  if (rtEntry) {
    if (typeof rtEntry.criticsScore === 'number') {
      const score = formatPercentScore(rtEntry.criticsScore);
      const tooltip = `Critics ${score}${rtEntry.criticsRating ? ` (${rtEntry.criticsRating})` : ''}`;
      entries.push({
        provider: 'rt',
        icon: 'rt',
        id: 'critics',
        display: score,
        tooltip
      });
    }
    if (typeof rtEntry.audienceScore === 'number') {
      const score = formatPercentScore(rtEntry.audienceScore);
      const tooltip = `Audience ${score}${rtEntry.audienceRating ? ` (${rtEntry.audienceRating})` : ''}`;
      entries.push({
        provider: 'rt',
        icon: 'rt-audience',
        id: 'audience',
        display: score,
        tooltip
      });
    }
  }
  const imdbEntry = ratings.imdb;
  if (imdbEntry && typeof imdbEntry.criticsScore === 'number') {
    const score = `${formatDecimalScore(imdbEntry.criticsScore)}/10`;
    entries.push({
      provider: 'imdb',
      icon: 'imdb',
      id: 'imdb',
      display: score,
      tooltip: `IMDb ${score}`
    });
  }
  return entries;
}

export function formatPercentScore(score) {
  return `${Math.round(score)}%`;
}

export function formatDecimalScore(score) {
  if (Number.isInteger(score)) {
    return `${score}`;
  }
  return score.toFixed(1);
}
