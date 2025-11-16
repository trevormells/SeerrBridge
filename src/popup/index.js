import {
  AVAILABILITY_STATUS_LABELS,
  DESCRIPTION_LENGTH_LIMITS,
  DETECTION_LIMITS,
  REQUEST_STATUS_LABELS
} from '../lib/config.js';
import { callBackground } from '../lib/runtime.js';
import { sanitizeDescriptionLength, sanitizeDetectionLimit } from '../lib/sanitizers.js';
import { loadSettings, saveSettings } from '../lib/settings.js';
import { normalizeBaseUrl } from '../lib/url.js';
import {
  extractTitleAndYear,
  extractYearFromString,
  normalizeText as normalize
} from '../lib/text.js';

/**
 * @typedef {import('../lib/types.js').DetectionResponse} DetectionResponse
 * @typedef {import('../lib/types.js').DetectedMediaCandidate} DetectedMediaCandidate
 * @typedef {import('../lib/types.js').EnrichedMediaItem} EnrichedMediaItem
 * @typedef {import('../lib/types.js').PopupState} PopupState
 */

/** @type {PopupState} */
const state = {
  settings: {
    overseerrUrl: '',
    prefer4k: false,
    showWeakDetections: false,
    maxDetections: DETECTION_LIMITS.default,
    descriptionLength: DESCRIPTION_LENGTH_LIMITS.defaultPopup
  },
  detected: [],
  weakDetections: [],
  searchResults: [],
  overseerrSessionReady: false,
  overseerrSessionError: ''
};

const statusRequestTokens = {
  detected: 0,
  weak: 0,
  search: 0
};

const elements = {
  statusBar: document.querySelector('.status'),
  statusText: document.getElementById('status-text'),
  refreshButton: document.getElementById('refresh-detections'),
  detectedList: document.getElementById('detected-list'),
  detectedEmpty: document.getElementById('detected-empty'),
  weakSection: document.getElementById('weak-detections-section'),
  weakList: document.getElementById('weak-detections-list'),
  weakEmpty: document.getElementById('weak-detections-empty'),
  searchForm: document.getElementById('search-form'),
  searchInput: document.getElementById('search-input'),
  searchResults: document.getElementById('search-results'),
  searchEmpty: document.getElementById('search-empty'),
  openOptions: document.getElementById('open-options'),
  openHelp: document.getElementById('open-help'),
  mainView: document.getElementById('view-main'),
  settingsView: document.getElementById('view-settings'),
  helpView: document.getElementById('view-help'),
  closeSettings: document.getElementById('close-settings'),
  closeHelp: document.getElementById('close-help'),
  settingsForm: document.getElementById('inline-settings-form'),
  settingsStatus: document.getElementById('inline-settings-status'),
  testOverseerr: document.getElementById('inline-test-overseerr')
};

const STATUS_LIST_CONFIG = {
  detected: {
    getList: () => state.detected,
    setList: (next) => {
      state.detected = next;
      renderMediaList(state.detected, elements.detectedList, elements.detectedEmpty);
    }
  },
  weak: {
    getList: () => state.weakDetections,
    setList: (next) => {
      state.weakDetections = next;
      renderMediaList(state.weakDetections, elements.weakList, elements.weakEmpty);
    }
  },
  search: {
    getList: () => state.searchResults,
    setList: (next) => {
      state.searchResults = next;
      renderMediaList(state.searchResults, elements.searchResults, elements.searchEmpty);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  bootstrap();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') {
    return;
  }

  let mutated = false;
  let needsSessionRefresh = false;
  Object.keys(changes).forEach((key) => {
    if (key in state.settings) {
      if (key === 'maxDetections') {
        state.settings[key] = sanitizeDetectionLimit(
          changes[key].newValue,
          DETECTION_LIMITS.default
        );
      } else if (key === 'descriptionLength') {
        state.settings[key] = sanitizeDescriptionLength(
          changes[key].newValue,
          DESCRIPTION_LENGTH_LIMITS.defaultPopup
        );
      } else {
        state.settings[key] = changes[key].newValue;
      }
      mutated = true;
      if (key === 'overseerrUrl') {
        state.overseerrSessionReady = false;
        state.overseerrSessionError = '';
        needsSessionRefresh = true;
      }
    }
  });

  if (mutated) {
    reflectSettingsState();
    populateSettingsForm();
    updateWeakDetectionsVisibility();
    rerenderMediaLists();
    if (needsSessionRefresh) {
      refreshOverseerrSessionStatus({ forceRefresh: true });
    }
  }
});
async function bootstrap() {
  const stored = await loadSettings();
  state.settings = { ...state.settings, ...stored };
  state.settings.maxDetections = sanitizeDetectionLimit(
    state.settings.maxDetections,
    DETECTION_LIMITS.default
  );
  state.settings.descriptionLength = sanitizeDescriptionLength(
    state.settings.descriptionLength,
    DESCRIPTION_LENGTH_LIMITS.defaultPopup
  );
  reflectSettingsState();
  populateSettingsForm();
  updateWeakDetectionsVisibility();
  await refreshOverseerrSessionStatus();
  await refreshDetectedMedia();
}

function bindEvents() {
  elements.refreshButton?.addEventListener('click', () => refreshDetectedMedia());
  elements.openOptions?.addEventListener('click', () => {
    populateSettingsForm();
    setInlineSettingsStatus('');
    showView('settings');
  });
  elements.closeSettings?.addEventListener('click', () => {
    showView('main');
    setInlineSettingsStatus('');
  });
  elements.openHelp?.addEventListener('click', () => {
    showView('help');
  });
  elements.closeHelp?.addEventListener('click', () => {
    showView('main');
  });
  elements.settingsForm?.addEventListener('submit', (event) => handleInlineSettingsSubmit(event));
  elements.testOverseerr?.addEventListener('click', () => handleInlineTestOverseerr());
  elements.searchForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    performManualSearch(elements.searchInput.value.trim());
  });
}

function showView(target = 'main') {
  const views = {
    main: elements.mainView,
    settings: elements.settingsView,
    help: elements.helpView
  };
  Object.values(views).forEach((view) => {
    if (view) {
      view.classList.add('hidden');
    }
  });
  if (views[target]) {
    views[target].classList.remove('hidden');
  } else if (views.main) {
    views.main.classList.remove('hidden');
  }
}

function populateSettingsForm() {
  if (!elements.settingsForm) {
    return;
  }
  const form = elements.settingsForm;
  form.overseerrUrl.value = state.settings.overseerrUrl || '';
  form.prefer4k.checked = Boolean(state.settings.prefer4k);
  form.showWeakDetections.checked = Boolean(state.settings.showWeakDetections);
  form.maxDetections.value = sanitizeDetectionLimit(
    state.settings.maxDetections ?? DETECTION_LIMITS.default,
    DETECTION_LIMITS.default
  );
  form.descriptionLength.value = sanitizeDescriptionLength(
    state.settings.descriptionLength ?? DESCRIPTION_LENGTH_LIMITS.defaultPopup,
    DESCRIPTION_LENGTH_LIMITS.defaultPopup
  );
}

async function handleInlineSettingsSubmit(event) {
  event.preventDefault();
  const payload = readInlineSettingsForm();
  setInlineSettingsStatus('Saving settings…');
  await saveSettings(payload);
  state.settings = { ...state.settings, ...payload };
  reflectSettingsState();
  populateSettingsForm();
  updateWeakDetectionsVisibility();
  await refreshOverseerrSessionStatus({ forceRefresh: true });
  setInlineSettingsStatus('Settings saved.');
}

async function handleInlineTestOverseerr() {
  const { overseerrUrl } = readInlineSettingsForm();
  if (!overseerrUrl) {
    setInlineSettingsStatus('Add your Overseerr URL first.', 'warning');
    return;
  }

  setInlineSettingsStatus('Checking Overseerr session…');
  try {
    await callBackground('CHECK_OVERSEERR_SESSION', {
      overseerrUrl,
      promptLogin: true,
      forceRefresh: true
    });
    setInlineSettingsStatus('Overseerr session detected.');
    if (overseerrUrl === state.settings.overseerrUrl) {
      state.overseerrSessionReady = true;
      state.overseerrSessionError = '';
      reflectSettingsState();
    }
  } catch (error) {
    if (error.code === 'AUTH_REQUIRED') {
      setInlineSettingsStatus('Log into Overseerr in the opened tab, then retry.', 'warning');
      if (overseerrUrl === state.settings.overseerrUrl) {
        state.overseerrSessionReady = false;
        state.overseerrSessionError =
          error.message || 'Log into Overseerr in the opened tab, then retry.';
        reflectSettingsState();
      }
      return;
    }
    setInlineSettingsStatus(`Unable to reach Overseerr: ${error.message}`, 'error');
    if (overseerrUrl === state.settings.overseerrUrl) {
      state.overseerrSessionReady = false;
      state.overseerrSessionError = error.message || 'Unable to reach Overseerr.';
      reflectSettingsState();
    }
  }
}

function setInlineSettingsStatus(message = '', tone = 'info') {
  if (!elements.settingsStatus) {
    return;
  }
  elements.settingsStatus.textContent = message;
  elements.settingsStatus.dataset.tone = tone;
}

function readInlineSettingsForm() {
  if (!elements.settingsForm) {
    return {
      overseerrUrl: state.settings.overseerrUrl || '',
      prefer4k: Boolean(state.settings.prefer4k),
      showWeakDetections: Boolean(state.settings.showWeakDetections),
      maxDetections: state.settings.maxDetections,
      descriptionLength: state.settings.descriptionLength
    };
  }
  const form = elements.settingsForm;
  return {
    overseerrUrl: normalizeBaseUrl(form.overseerrUrl.value),
    prefer4k: Boolean(form.prefer4k.checked),
    showWeakDetections: Boolean(form.showWeakDetections.checked),
    maxDetections: sanitizeDetectionLimit(form.maxDetections.value, DETECTION_LIMITS.default),
    descriptionLength: sanitizeDescriptionLength(
      form.descriptionLength.value,
      DESCRIPTION_LENGTH_LIMITS.defaultPopup
    )
  };
}

async function refreshOverseerrSessionStatus(options = {}) {
  if (!state.settings.overseerrUrl) {
    state.overseerrSessionReady = false;
    state.overseerrSessionError = '';
    reflectSettingsState();
    return false;
  }

  try {
    await callBackground('CHECK_OVERSEERR_SESSION', {
      overseerrUrl: state.settings.overseerrUrl,
      promptLogin: Boolean(options.promptLogin),
      forceRefresh: Boolean(options.forceRefresh)
    });
    state.overseerrSessionReady = true;
    state.overseerrSessionError = '';
    reflectSettingsState();
    return true;
  } catch (error) {
    state.overseerrSessionReady = false;
    state.overseerrSessionError =
      error.code === 'AUTH_REQUIRED'
        ? 'Log into Overseerr in the opened tab, then retry.'
        : error.message || 'Unable to reach Overseerr.';
    reflectSettingsState();
    return false;
  }
}

function handleOverseerrAuthFailure(error) {
  if (!error || error.code !== 'AUTH_REQUIRED') {
    return false;
  }
  state.overseerrSessionReady = false;
  state.overseerrSessionError =
    error.message || 'Log into Overseerr in the opened tab, then retry.';
  reflectSettingsState();
  return true;
}

async function ensureOverseerrSession(options = {}) {
  if (!state.settings.overseerrUrl) {
    return false;
  }
  if (state.overseerrSessionReady && !options.forceRefresh) {
    return true;
  }
  return refreshOverseerrSessionStatus(options);
}

async function refreshDetectedMedia() {
  setStatus('Scanning the active tab…');
  elements.refreshButton.disabled = true;

  let activeTab = null;
  try {
    await ensureOverseerrSession();
    activeTab = await getActiveTab();
    if (!activeTab?.id) {
      const noTabError = new Error('No active tab detected.');
      noTabError.code = 'TAB_UNAVAILABLE';
      throw noTabError;
    }

    const response = await sendMessageToTab(activeTab.id, { type: 'DETECT_MEDIA' });
    const candidates = response?.items || [];
    const weakCandidates = response?.weak_detections || [];
    state.detected = dedupeMedia(await decorateCandidates(candidates));
    state.weakDetections = dedupeMedia(await decorateCandidates(weakCandidates));
    promoteResolvedWeakDetections();
    const canCheckStatus = canCheckOverseerrStatus();
    state.detected = prepareStatusReadyList(state.detected, canCheckStatus);
    state.weakDetections = prepareStatusReadyList(state.weakDetections, canCheckStatus);
    renderMediaList(state.detected, elements.detectedList, elements.detectedEmpty);
    renderMediaList(
      state.weakDetections,
      elements.weakList,
      elements.weakEmpty
    );
    if (canCheckStatus) {
      const detectedToken = ++statusRequestTokens.detected;
      const weakToken = ++statusRequestTokens.weak;
      fetchStatusesForList('detected', detectedToken);
      fetchStatusesForList('weak', weakToken);
    }

    const weakToggleOn = shouldShowWeakDetections();
    if (!candidates.length && !weakCandidates.length) {
      setStatus('No obvious titles on this page. Try a manual search.', 'warning');
    } else if (!candidates.length && weakCandidates.length) {
      const message = weakToggleOn
        ? 'Only low-confidence matches detected. Review weak matches.'
        : 'Only low-confidence matches detected. Enable weak detections in Settings to review them.';
      setStatus(message, 'warning');
    } else {
      setStatus('Detection complete.');
    }
  } catch (error) {
    console.error('refreshDetectedMedia failed', {
      error,
      tab: activeTab
        ? {
            id: activeTab.id,
            url: activeTab.url,
            discarded: activeTab.discarded
          }
        : null
    });
    const friendlyMessage =
      formatDetectionError(error, activeTab) || error?.message || 'Detection failed.';
    setStatus(friendlyMessage, 'error');
  } finally {
    elements.refreshButton.disabled = false;
  }
}

/**
 * Enriches detector candidates with Overseerr data when available.
 * @param {DetectedMediaCandidate[]} candidates
 * @returns {Promise<EnrichedMediaItem[]>}
 */
async function decorateCandidates(candidates) {
  if (!candidates.length) {
    return [];
  }

  const enriched = [];
  const limit = sanitizeDetectionLimit(state.settings.maxDetections, DETECTION_LIMITS.default);
  let canUseMetadata = canUseOverseerrSearch();

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const normalizedCandidateTitle = normalize(candidate.title || '');
    const { coreTitle, year: parsedCandidateYear } = extractTitleAndYear(candidate.title || '');
    const effectiveQuery = coreTitle || normalizedCandidateTitle || candidate.title || '';
    const base = {
      title: candidate.title,
      releaseYear: candidate.releaseYear || '',
      overview: candidate.subtitle || '',
      poster: candidate.poster || '',
      mediaType: candidate.mediaType || 'movie',
      source: candidate.source || 'detector',
      tmdbId: null,
      rating: null
    };

    if (canUseMetadata && i < limit && effectiveQuery) {
      try {
        const searchPayload = {
          query: effectiveQuery,
          page: 1
        };
        const preferredYear = candidate.releaseYear || parsedCandidateYear;
        const numericYear = parseInt(preferredYear, 10);
        if (!Number.isNaN(numericYear)) {
          searchPayload.year = numericYear;
        }
        const search = await callBackground('OVERSEERR_SEARCH', searchPayload);
        const match = selectBestOverseerrMatch(search?.results, candidate.mediaType);
        if (match) {
          const normalizedMatch = normalizeOverseerrResult(match);
          enriched.push({
            ...base,
            title: normalizedMatch.title || base.title,
            releaseYear: normalizedMatch.releaseYear || base.releaseYear,
            overview: normalizedMatch.overview || base.overview,
            poster: normalizedMatch.poster || base.poster,
            tmdbId: normalizedMatch.tmdbId,
            rating: normalizedMatch.rating,
            mediaType: normalizedMatch.mediaType || base.mediaType,
            source: normalizedMatch.source,
            availabilityStatus:
              normalizedMatch.availabilityStatus ?? base.availabilityStatus ?? null,
            requestStatus: normalizedMatch.requestStatus ?? base.requestStatus ?? null
          });
          continue;
        }
      } catch (error) {
        console.warn('Overseerr lookup failed', error);
        if (handleOverseerrAuthFailure(error)) {
          canUseMetadata = false;
        }
      }
    }

    enriched.push(base);
  }

  return enriched;
}

async function performManualSearch(query) {
  if (!query) {
    return;
  }

  await ensureOverseerrSession();
  if (!canUseOverseerrSearch()) {
    setStatus('Connect Overseerr in Settings to search.', 'warning');
    return;
  }

  const normalizedQuery = normalize(query);
  const displayQuery = normalizedQuery || query;
  const { coreTitle, year } = extractTitleAndYear(query);
  const searchQuery = coreTitle || displayQuery;
  if (!searchQuery) {
    setStatus('Try adding more of the title before searching.', 'warning');
    return;
  }

  const searchPayload = { query: searchQuery };
  if (typeof year === 'number' && !Number.isNaN(year)) {
    searchPayload.year = year;
  }

  setStatus(`Searching Overseerr for “${displayQuery}”…`);
  try {
    const { results } = await callBackground('OVERSEERR_SEARCH', searchPayload);
    const canCheckStatus = canCheckOverseerrStatus();
    const normalizedResults = (results || [])
      .filter((item) => isOverseerrTrackableMedia(item?.mediaType))
      .map(normalizeOverseerrResult);
    state.searchResults = prepareStatusReadyList(normalizedResults, canCheckStatus);
    renderMediaList(state.searchResults, elements.searchResults, elements.searchEmpty);
    const token = ++statusRequestTokens.search;
    if (canCheckStatus) {
      fetchStatusesForList('search', token);
    }
    if (!results?.length) {
      setStatus('No Overseerr matches. Try another search.', 'warning');
    } else {
      setStatus(`Showing ${results.length} Overseerr result(s).`);
    }
  } catch (error) {
    console.error(error);
    if (handleOverseerrAuthFailure(error)) {
      setStatus('Log into Overseerr to run searches.', 'warning');
    } else {
      setStatus(error.message || 'Overseerr search failed.', 'error');
    }
  }
}

function selectBestOverseerrMatch(results, preferredMediaType) {
  if (!Array.isArray(results) || !results.length) {
    return null;
  }
  if (preferredMediaType === 'movie' || preferredMediaType === 'tv') {
    const exact = results.find(
      (item) => item?.mediaType === preferredMediaType
    );
    if (exact) {
      return exact;
    }
  }
  return results[0];
}

function renderMediaList(list, container, emptyElement) {
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

function rerenderMediaLists() {
  renderMediaList(state.detected, elements.detectedList, elements.detectedEmpty);
  renderMediaList(
    state.weakDetections,
    elements.weakList,
    elements.weakEmpty
  );
  renderMediaList(
    state.searchResults,
    elements.searchResults,
    elements.searchEmpty
  );
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
    overseerrButton.addEventListener('click', () => openOverseerrMedia(media));
  } else {
    overseerrButton.title = 'Search on Overseerr';
    overseerrButton.setAttribute('aria-label', 'Search on Overseerr');
    overseerrButton.dataset.variant = 'search';
    overseerrButton.disabled = !hasOverseerrUrl || !normalizedTitle;
    overseerrButton.addEventListener('click', () => {
      const targetTitle = normalize(media.title);
      if (!targetTitle) {
        setStatus('Add the title before searching Overseerr.', 'warning');
        return;
      }
      openOverseerrSearch(targetTitle);
    });
  }

  info.appendChild(title);
  info.appendChild(meta);
  info.appendChild(overview);
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
        setStatus('Add the title before searching Overseerr.', 'warning');
        return;
      }
      openOverseerrSearch(targetTitle);
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

  const actionState = buildRequestActionState(media);
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
  button.addEventListener('click', () => handleRequest(media, button));
  return button;
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

  if (!canCheckOverseerrStatus()) {
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

async function fetchStatusesForList(listName, token) {
  const config = STATUS_LIST_CONFIG[listName];
  if (!config) {
    return;
  }

  const targets = config
    .getList()
    .filter(
      (item) =>
        isOverseerrTrackableMedia(item?.mediaType) &&
        item.tmdbId &&
        item.statusLoading
    )
    .map((item) => ({ tmdbId: item.tmdbId, mediaType: item.mediaType }));

  if (!targets.length) {
    return;
  }

  for (const media of targets) {
    if (token !== statusRequestTokens[listName]) {
      return;
    }
    try {
      const response = await callBackground('FETCH_OVERSEERR_MEDIA_STATUS', {
        tmdbId: media.tmdbId,
        mediaType: media.mediaType
      });
      if (token !== statusRequestTokens[listName]) {
        return;
      }
      applyStatusPatch(listName, media.tmdbId, {
        statusLoading: false,
        availabilityStatus:
          typeof response?.availability === 'number' ? response.availability : null,
        requestStatus:
          typeof response?.requestStatus === 'number' ? response.requestStatus : null,
        statusError: ''
      });
    } catch (error) {
      if (token !== statusRequestTokens[listName]) {
        return;
      }
      applyStatusPatch(listName, media.tmdbId, {
        statusLoading: false,
        statusError: error.message || 'Status lookup failed.'
      });
      if (error.code === 'AUTH_REQUIRED') {
        state.overseerrSessionReady = false;
        state.overseerrSessionError =
          error.message || 'Log into Overseerr in the opened tab, then retry.';
        reflectSettingsState();
        return;
      }
    }
  }
}

function applyStatusPatch(listName, tmdbId, patch) {
  const config = STATUS_LIST_CONFIG[listName];
  if (!config) {
    return;
  }

  let mutated = false;
  const next = config.getList().map((item) => {
    if (item.tmdbId !== tmdbId) {
      return item;
    }
    mutated = true;
    return { ...item, ...patch };
  });

  if (mutated) {
    config.setList(next);
  }
}

async function handleRequest(media, button) {
  if (!media.tmdbId) {
    setStatus('Select a search result before requesting.', 'warning');
    return;
  }

  if (!state.settings.overseerrUrl) {
    setStatus('Add your Overseerr URL in Settings.', 'warning');
    return;
  }

  if (!state.overseerrSessionReady) {
    const ready = await refreshOverseerrSessionStatus({
      promptLogin: true,
      forceRefresh: true
    });
    if (!ready) {
      return;
    }
  }

  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = 'Requesting…';

  try {
    await callBackground('SEND_OVERSEERR_REQUEST', {
      tmdbId: media.tmdbId,
      mediaType: media.mediaType
    });
    button.textContent = 'Requested';
    setStatus(`Request sent for ${media.title}.`);
  } catch (error) {
    console.error(error);
    button.disabled = false;
    button.textContent = originalLabel;
    if (!handleOverseerrAuthFailure(error)) {
      setStatus(error.message || 'Request failed.', 'error');
    }
  }
}

function openOverseerrMedia(media) {
  if (!media?.tmdbId) {
    setStatus('Match this title via Overseerr search before opening Overseerr.', 'warning');
    return;
  }
  const baseUrl = getOverseerrBaseUrl();
  if (!baseUrl) {
    return;
  }
  const section = media.mediaType === 'tv' ? 'tv' : 'movie';
  openExternalUrl(`${baseUrl}/${section}/${media.tmdbId}`);
}

function openOverseerrSearch(title) {
  const baseUrl = getOverseerrBaseUrl();
  if (!baseUrl) {
    return;
  }
  const query = encodeURIComponent(title);
  openExternalUrl(`${baseUrl}/search?query=${query}`);
}

function getOverseerrBaseUrl() {
  const base = (state.settings.overseerrUrl || '').trim();
  if (!base) {
    setStatus('Add your Overseerr URL in Settings to open it directly.', 'warning');
    return '';
  }
  return base.replace(/\/+$/, '');
}

function openExternalUrl(url) {
  if (!url) {
    return;
  }
  if (chrome?.tabs?.create) {
    chrome.tabs.create({ url });
    return;
  }
  window.open(url, '_blank', 'noopener');
}

function normalizeOverseerrResult(result = {}) {
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

function canUseOverseerrSearch() {
  return Boolean(state.settings.overseerrUrl && state.overseerrSessionReady);
}

function canCheckOverseerrStatus() {
  return canUseOverseerrSearch();
}

function reflectSettingsState() {
  if (!state.settings.overseerrUrl) {
    setStatus('Add your Overseerr URL in Settings to enable search and requests.', 'warning');
    return;
  }

  if (!state.overseerrSessionReady) {
    setStatus(
      state.overseerrSessionError || 'Log into Overseerr to enable search and requests.',
      'warning'
    );
    return;
  }

  setStatus('Ready to detect, search, and request media.');
}

function updateWeakDetectionsVisibility() {
  if (!elements.weakSection) {
    return;
  }
  if (shouldShowWeakDetections()) {
    elements.weakSection.classList.remove('hidden');
  } else {
    elements.weakSection.classList.add('hidden');
  }
}

function buildPosterUrl(path) {
  return path ? `https://image.tmdb.org/t/p/w200${path}` : '';
}

function setStatus(message, tone = 'info') {
  elements.statusText.textContent = message;
  if (elements.statusBar) {
    elements.statusBar.dataset.tone = tone;
  }
}

function formatDetectionError(error, tab = null) {
  if (!error) {
    return '';
  }

  if (error.code === 'TAB_UNAVAILABLE') {
    return 'No active tab detected. Focus the page you want to scan, then press Rescan.';
  }

  if (error.code === 'CONTENT_SCRIPT_UNAVAILABLE') {
    if (isRestrictedTabUrl(tab?.url)) {
      return 'Chrome blocks scanning on this page (browser UI or Web Store). Switch to a regular site and try again.';
    }
    return 'The scanner was not running on this tab. Reload the page, then press Rescan.';
  }

  if (error.code === 'SCRIPT_INJECTION_FAILED') {
    if (isRestrictedTabUrl(tab?.url)) {
      return 'Chrome prevented SeerrBridge from loading on this page. Browser pages, PDFs, and the Web Store cannot be scanned.';
    }
    return error.message || 'Chrome blocked the detector from loading on this page.';
  }

  return '';
}

function isRestrictedTabUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  const normalized = url.toLowerCase();
  return (
    normalized.startsWith('chrome://') ||
    normalized.startsWith('edge://') ||
    normalized.startsWith('about:') ||
    normalized.startsWith('view-source:') ||
    normalized.startsWith('devtools://') ||
    normalized.startsWith('chrome-extension://') ||
    normalized.startsWith('moz-extension://') ||
    normalized.startsWith('https://chrome.google.com/webstore')
  );
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0]);
    });
  });
}

/**
 * Sends a message to the content script and resolves the detection payload.
 * @param {number} tabId
 * @param {{type: string}} payload
 * @returns {Promise<DetectionResponse>}
 */
async function sendMessageToTab(tabId, payload) {
  try {
    return await sendRuntimeMessage(tabId, payload);
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw buildContentScriptError(error);
    }

    if (!chrome?.scripting?.executeScript) {
      throw buildContentScriptError(error);
    }

    console.warn('SeerrBridge detector not found in tab. Injecting content script…', {
      tabId
    });
    await injectDetectorContentScript(tabId);
    return sendRuntimeMessageWithRetry(tabId, payload);
  }
}

async function sendRuntimeMessageWithRetry(tabId, payload, attempts = 4, delayMs = 100) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await sendRuntimeMessage(tabId, payload);
    } catch (error) {
      lastError = error;
      if (!isMissingReceiverError(error)) {
        throw buildContentScriptError(error);
      }

      const backoff = delayMs * (attempt + 1);
      await delay(backoff);
    }
  }

  throw buildContentScriptError(lastError);
}

function sendRuntimeMessage(tabId, payload) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(response);
    });
  });
}

function injectDetectorContentScript(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ['src/content/detector.js']
      },
      () => {
        if (chrome.runtime.lastError) {
          const message =
            chrome.runtime.lastError.message ||
            'Chrome blocked the detector from loading on this page.';
          const scriptError = new Error(message);
          scriptError.code = 'SCRIPT_INJECTION_FAILED';
          reject(scriptError);
          return;
        }
        resolve();
      }
    );
  });
}

function isMissingReceiverError(error) {
  return Boolean(error?.message && error.message.includes('Receiving end does not exist'));
}

function buildContentScriptError(error) {
  if (isMissingReceiverError(error)) {
    const friendlyError = new Error(
      'Unable to reach SeerrBridge on this tab. Reload the page and try “Scan” again.'
    );
    friendlyError.code = 'CONTENT_SCRIPT_UNAVAILABLE';
    friendlyError.debug = error?.message;
    return friendlyError;
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error(error?.message || 'Failed to reach SeerrBridge on this page.');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function promoteResolvedWeakDetections() {
  if (!state.weakDetections.length) {
    return;
  }

  const resolved = [];
  const unresolved = [];

  state.weakDetections.forEach((item) => {
    if (item.tmdbId) {
      resolved.push(item);
    } else {
      unresolved.push(item);
    }
  });

  if (resolved.length) {
    state.detected = dedupeMedia([...state.detected, ...resolved]);
  }

  state.weakDetections = unresolved;
}

function dedupeMedia(list) {
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

function pickPreferredMedia(current, incoming) {
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

function mediaCompletenessScore(media = {}) {
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

function truncateDescription(text, limit) {
  const safeText = `${text || ''}`;
  if (!limit || limit < 1 || safeText.length <= limit) {
    return safeText;
  }
  return `${safeText.slice(0, limit)}...`;
}

function buildRequestActionState(media) {
  const canSubmitRequest = Boolean(state.settings.overseerrUrl && state.overseerrSessionReady);

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
    disabled: !canSubmitRequest
  };
}

function buildAvailabilityStatusLabel(value) {
  if (typeof value !== 'number' || value === 1) {
    return '';
  }
  const availabilityLabel = formatAvailabilityStatus(value);
  return availabilityLabel ? buildStatusLabel('Media', availabilityLabel) : '';
}

function buildRequestStatusLabel(value) {
  if (typeof value !== 'number') {
    return '';
  }
  const requestLabel = formatRequestStatus(value);
  return requestLabel ? buildStatusLabel('Request', requestLabel) : '';
}

function buildStatusLabel(prefix, message) {
  if (!message) {
    return '';
  }
  if (!prefix) {
    return message;
  }
  return `${prefix} ${message.toLowerCase()}`;
}

function extractMediaInfoStatuses(mediaInfo) {
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

function prepareStatusReadyList(list, canCheckStatus) {
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

function formatAvailabilityStatus(value) {
  if (typeof value !== 'number') {
    return '';
  }
  return AVAILABILITY_STATUS_LABELS[value] || '';
}

function formatRequestStatus(value) {
  if (typeof value !== 'number') {
    return '';
  }
  return REQUEST_STATUS_LABELS[value] || '';
}

function isOverseerrTrackableMedia(mediaType) {
  return mediaType === 'movie' || mediaType === 'tv';
}

function shouldShowWeakDetections() {
  return Boolean(state.settings.showWeakDetections);
}
