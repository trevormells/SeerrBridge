import { DESCRIPTION_LENGTH_LIMITS, DETECTION_LIMITS } from '../lib/config.js';
import { callBackground } from '../lib/runtime.js';
import { sanitizeDescriptionLength, sanitizeDetectionLimit } from '../lib/sanitizers.js';
import { loadSettings, saveSettings } from '../lib/settings.js';
import { normalizeBaseUrl } from '../lib/url.js';
import {
  extractTitleAndYear,
  normalizeText as normalize
} from '../lib/text.js';
import { createSettingsPanel } from '../lib/settingsPanel.js';
import { renderMediaList, configureRendererContext } from './renderers.js';
import {
  dedupeMedia,
  isOverseerrTrackableMedia,
  prepareRatingsReadyList,
  prepareStatusReadyList
} from './mediaUtils.js';
import {
  normalizeCombinedRatings,
  normalizeOverseerrResult,
  selectBestOverseerrMatch
} from './overseerrData.js';
import {
  ratingsRequestTokens,
  setupState,
  state,
  statusRequestTokens
} from './state.js';

/**
 * @typedef {import('../lib/types.js').DetectionResponse} DetectionResponse
 * @typedef {import('../lib/types.js').DetectedMediaCandidate} DetectedMediaCandidate
 * @typedef {import('../lib/types.js').EnrichedMediaItem} EnrichedMediaItem
 * @typedef {import('../lib/types.js').PopupState} PopupState
 */

let activeView = 'main';

let inlineSettingsPanel = null;

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
  setupView: document.getElementById('view-setup'),
  setupUrlCard: document.getElementById('setup-card-url'),
  setupUrlStatus: document.getElementById('setup-url-status'),
  setupUrlMessage: document.getElementById('setup-url-message'),
  setupUrlForm: document.getElementById('setup-url-form'),
  setupUrlInput: document.getElementById('setup-overseerr-url'),
  setupReachabilityCard: document.getElementById('setup-card-reachability'),
  setupReachabilityStatus: document.getElementById('setup-reachability-status'),
  setupReachabilityMessage: document.getElementById('setup-reachability-message'),
  setupSessionCard: document.getElementById('setup-card-session'),
  setupSessionStatus: document.getElementById('setup-session-status'),
  setupSessionMessage: document.getElementById('setup-session-message'),
  setupSessionSteps: document.getElementById('setup-session-steps'),
  setupRetryButton: document.getElementById('setup-retry')
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

configureRendererContext({
  setStatus,
  handleRequest,
  openOverseerrMedia,
  openOverseerrSearch,
  canSubmitRequest: () => Boolean(state.settings.overseerrUrl && state.overseerrSessionReady),
  canFetchOverseerrRatings,
  canCheckOverseerrStatus
});

document.addEventListener('DOMContentLoaded', () => {
  setupInlineSettingsPanel();
  bindEvents();
  bootstrap();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') {
    return;
  }

  let mutated = false;
  let needsSetupRefresh = false;
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
        needsSetupRefresh = true;
      }
    }
  });

  if (mutated) {
    reflectSettingsState();
    syncInlineSettingsPanelValues();
    updateWeakDetectionsVisibility();
    rerenderMediaLists();
    if (needsSetupRefresh) {
      runSetupChecks({ forceRefresh: true }).catch((error) =>
        console.error('Setup check refresh failed', error)
      );
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
  syncInlineSettingsPanelValues();
  updateWeakDetectionsVisibility();
  const ready = await runSetupChecks();
  if (ready) {
    await refreshDetectedMedia();
  }
}

function bindEvents() {
  elements.refreshButton?.addEventListener('click', () => refreshDetectedMedia());
  elements.openOptions?.addEventListener('click', () => {
    syncInlineSettingsPanelValues();
    inlineSettingsPanel?.setStatus('');
    showView('settings');
  });
  elements.closeSettings?.addEventListener('click', () => {
    showView('main');
    inlineSettingsPanel?.setStatus('');
  });
  elements.openHelp?.addEventListener('click', () => {
    showView('help');
  });
  elements.closeHelp?.addEventListener('click', () => {
    showView('main');
  });
  elements.searchForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    performManualSearch(elements.searchInput.value.trim());
  });
  elements.setupUrlForm?.addEventListener('submit', (event) => handleSetupUrlSubmit(event));
  elements.setupRetryButton?.addEventListener('click', () => handleSetupRetry());
}

function showView(target = 'main') {
  activeView = target;
  const views = {
    main: elements.mainView,
    settings: elements.settingsView,
    help: elements.helpView,
    setup: elements.setupView
  };
  Object.values(views).forEach((view) => {
    if (view) {
      view.classList.add('hidden');
    }
  });
  if (setupState.visible && views.setup) {
    views.setup.classList.remove('hidden');
    return;
  }
  const resolved = views[target] || views.main;
  if (resolved) {
    resolved.classList.remove('hidden');
  }
}

function setupInlineSettingsPanel() {
  const container = document.getElementById('inline-settings-panel');
  if (!container) {
    return;
  }
  inlineSettingsPanel = createSettingsPanel({
    root: container,
    idPrefix: 'inline-',
    descriptionLengthDefault: DESCRIPTION_LENGTH_LIMITS.defaultPopup,
    maxDetectionsDefault: DETECTION_LIMITS.default,
    onAfterSave: (context) => handleInlineSettingsSaved(context),
    onTestResult: (result) => handleInlineTestResult(result)
  });
}

function syncInlineSettingsPanelValues() {
  if (inlineSettingsPanel) {
    inlineSettingsPanel.setValues(state.settings);
  }
  updateSetupUrlInput(state.settings.overseerrUrl || '');
}

async function handleInlineSettingsSaved({ values, setStatus }) {
  const previousUrl = state.settings.overseerrUrl || '';
  try {
    state.settings = { ...state.settings, ...values };
    reflectSettingsState();
    syncInlineSettingsPanelValues();
    updateWeakDetectionsVisibility();
    if ((values.overseerrUrl || '') !== previousUrl) {
      const wasVisible = setupState.visible;
      const ready = await runSetupChecks({ forceRefresh: true });
      if (!ready) {
        setStatus(
          'Settings saved. Review the setup checklist to finish connecting.',
          'warning'
        );
        return true;
      }
      if (wasVisible) {
        await refreshDetectedMedia();
      }
    }
    setStatus('Settings saved.');
  } catch (error) {
    setStatus(error?.message || 'Unable to save settings.', 'error');
  }
  return true;
}

function handleInlineTestResult(result) {
  if (!result || !result.values) {
    return;
  }
  const normalizedTestUrl = normalizeBaseUrl(result.values.overseerrUrl || '');
  const normalizedStoredUrl = normalizeBaseUrl(state.settings.overseerrUrl || '');
  if (!normalizedTestUrl || !normalizedStoredUrl || normalizedTestUrl !== normalizedStoredUrl) {
    return;
  }
  if (result.status === 'success') {
    state.overseerrSessionReady = true;
    state.overseerrSessionError = '';
  } else if (result.status === 'auth-required') {
    state.overseerrSessionReady = false;
    state.overseerrSessionError =
      result.error?.message || 'Log into Overseerr in the opened tab, then retry.';
  } else {
    state.overseerrSessionReady = false;
    state.overseerrSessionError = result.error?.message || 'Unable to reach Overseerr.';
  }
  reflectSettingsState();
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

  try {
    await ensureOverseerrSession();
    const tab = await getActiveTab();
    if (!tab?.id) {
      throw new Error('No active tab detected.');
    }

    const response = await sendMessageToTab(tab.id, { type: 'DETECT_MEDIA' });
    const candidates = response?.items || [];
    const weakCandidates = response?.weak_detections || [];
    state.detected = dedupeMedia(await decorateCandidates(candidates));
    state.weakDetections = dedupeMedia(await decorateCandidates(weakCandidates));
    promoteResolvedWeakDetections();
    const canCheckStatus = canCheckOverseerrStatus();
    const canFetchRatings = canFetchOverseerrRatings();
    state.detected = prepareRatingsReadyList(
      prepareStatusReadyList(state.detected, canCheckStatus),
      canFetchRatings
    );
    state.weakDetections = prepareRatingsReadyList(
      prepareStatusReadyList(state.weakDetections, canCheckStatus),
      canFetchRatings
    );
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
    if (canFetchRatings) {
      const detectedToken = ++ratingsRequestTokens.detected;
      const weakToken = ++ratingsRequestTokens.weak;
      fetchRatingsForList('detected', detectedToken);
      fetchRatingsForList('weak', weakToken);
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
    console.error(error);
    setStatus(error.message || 'Detection failed.', 'error');
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
    const canFetchRatings = canFetchOverseerrRatings();
    const normalizedResults = (results || [])
      .filter((item) => isOverseerrTrackableMedia(item?.mediaType))
      .map(normalizeOverseerrResult);
    let preparedResults = prepareStatusReadyList(normalizedResults, canCheckStatus);
    preparedResults = prepareRatingsReadyList(preparedResults, canFetchRatings);
    state.searchResults = preparedResults;
    renderMediaList(state.searchResults, elements.searchResults, elements.searchEmpty);
    const statusToken = ++statusRequestTokens.search;
    if (canCheckStatus) {
      fetchStatusesForList('search', statusToken);
    }
    if (canFetchRatings) {
      const ratingsToken = ++ratingsRequestTokens.search;
      fetchRatingsForList('search', ratingsToken);
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
      applyMediaPatch(listName, media.tmdbId, {
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
      applyMediaPatch(listName, media.tmdbId, {
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

async function fetchRatingsForList(listName, token) {
  const config = STATUS_LIST_CONFIG[listName];
  if (!config) {
    return;
  }

  const targets = config
    .getList()
    .filter((item) => item.showRatings && item.tmdbId && item.ratingsLoading)
    .map((item) => ({ tmdbId: item.tmdbId, mediaType: item.mediaType }));

  if (!targets.length) {
    return;
  }

  for (const media of targets) {
    if (token !== ratingsRequestTokens[listName]) {
      return;
    }
    try {
      const response = await callBackground('FETCH_OVERSEERR_RATINGS', {
        tmdbId: media.tmdbId,
        mediaType: media.mediaType
      });
      if (token !== ratingsRequestTokens[listName]) {
        return;
      }
      const normalizedRatings = normalizeCombinedRatings(response?.ratings);
      applyMediaPatch(listName, media.tmdbId, {
        ratingsLoading: false,
        ratings: normalizedRatings,
        ratingsError: ''
      });
    } catch (error) {
      if (token !== ratingsRequestTokens[listName]) {
        return;
      }
      applyMediaPatch(listName, media.tmdbId, {
        ratingsLoading: false,
        ratingsError: error.message || 'Ratings lookup failed.'
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

function applyMediaPatch(listName, tmdbId, patch) {
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
    setStatus('Add your Overseerr URL in Settings to open it directly.', 'warning');
    return;
  }
  const section = media.mediaType === 'tv' ? 'tv' : 'movie';
  openExternalUrl(`${baseUrl}/${section}/${media.tmdbId}`);
}

function openOverseerrSearch(title) {
  const baseUrl = getOverseerrBaseUrl();
  if (!baseUrl) {
    setStatus('Add your Overseerr URL in Settings to search directly.', 'warning');
    return;
  }
  const query = encodeURIComponent(title);
  openExternalUrl(`${baseUrl}/search?query=${query}`);
}

function getOverseerrBaseUrl() {
  const base = (state.settings.overseerrUrl || '').trim();
  if (!base) {
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


if (
  typeof globalThis !== 'undefined' &&
  typeof globalThis.__SEERRBRIDGE_POPUP_TEST_HOOK__ === 'function'
) {
  globalThis.__SEERRBRIDGE_POPUP_TEST_HOOK__({
    selectBestOverseerrMatch,
    dedupeMedia,
    pickPreferredMedia,
    mediaCompletenessScore,
    buildRatingEntries,
    formatPercentScore,
    formatDecimalScore,
    normalizeOverseerrResult,
    normalizeCombinedRatings
  });
}

function canUseOverseerrSearch() {
  return Boolean(state.settings.overseerrUrl && state.overseerrSessionReady);
}

function canCheckOverseerrStatus() {
  return canUseOverseerrSearch();
}

function canFetchOverseerrRatings() {
  return canUseOverseerrSearch();
}

function reflectSettingsState() {
  if (setupState.visible) {
    const message = state.settings.overseerrUrl
      ? 'Review the setup checklist to finish connecting to Overseerr.'
      : 'Add your Overseerr URL in the setup checklist to continue.';
    setStatus(message, 'warning');
    return;
  }

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

function setStatus(message, tone = 'info') {
  elements.statusText.textContent = message;
  if (elements.statusBar) {
    elements.statusBar.dataset.tone = tone;
  }
}

async function runSetupChecks(options = {}) {
  if (!elements.setupView) {
    return refreshOverseerrSessionStatus(options);
  }

  setSetupRunning(true);
  try {
    const sanitizedUrl = normalizeBaseUrl(state.settings.overseerrUrl || '');
    updateSetupUrlInput(sanitizedUrl || state.settings.overseerrUrl || '');
    if (!sanitizedUrl) {
      setSetupCheck('url', {
        status: 'error',
        message: 'Enter your Overseerr URL to get started.'
      });
      setSetupCheck('reachability', {
        status: 'idle',
        message: 'Add a URL above to test connectivity.'
      });
      setSetupCheck('session', {
        status: 'idle',
        message: 'Once Overseerr is reachable we can verify authentication.'
      });
      state.overseerrSessionReady = false;
      state.overseerrSessionError = '';
      setSetupVisibility(true);
      reflectSettingsState();
      setStatus('Add your Overseerr URL to finish setup.', 'warning');
      return false;
    }

    setSetupCheck('url', {
      status: 'success',
      message: `Using ${sanitizedUrl}.`
    });

    setSetupCheck('reachability', {
      status: 'pending',
      message: 'Checking if Overseerr is reachable…'
    });

    let versionLabel = '';
    try {
      const status = await callBackground('CHECK_OVERSEERR_STATUS', { overseerrUrl: sanitizedUrl });
      if (status?.version) {
        versionLabel = `v${status.version}`;
      }
    } catch (error) {
      const failureMessage = `Overseerr is not reachable at ${sanitizedUrl}. Please check the URL and try again.`;
      setSetupCheck('reachability', {
        status: 'error',
        message: error?.message ? `${failureMessage} (${error.message})` : failureMessage
      });
      setSetupCheck('session', {
        status: 'idle',
        message: 'We need to reach Overseerr before verifying your session.'
      });
      state.overseerrSessionReady = false;
      state.overseerrSessionError = failureMessage;
      setSetupVisibility(true);
      reflectSettingsState();
      setStatus('Overseerr is not reachable at that URL. Please check it and try again.', 'error');
      return false;
    }

    const reachabilityMessage = versionLabel
      ? `Overseerr reachable (${versionLabel}).`
      : 'Overseerr is reachable.';
    setSetupCheck('reachability', {
      status: 'success',
      message: reachabilityMessage
    });

    setSetupCheck('session', {
      status: 'pending',
      message: 'Verifying Overseerr session…'
    });

    try {
      await callBackground('CHECK_OVERSEERR_SESSION', {
        overseerrUrl: sanitizedUrl,
        promptLogin: Boolean(options.promptLogin),
        forceRefresh: Boolean(options.forceRefresh)
      });
    } catch (error) {
      const authMessage =
        error && error.code === 'AUTH_REQUIRED'
          ? 'Authentication required. Sign into Overseerr and try again.'
          : `Authentication check failed: ${error?.message || 'Unknown error'}`;
      const helpSteps = [
        `Open ${sanitizedUrl} in a tab and confirm you are logged into Overseerr and authorized to make requests.`,
        'Reload this popup or try the extension on a new page after signing in.',
        'Click Retry once you are signed in to run the checks again.'
      ];
      setSetupCheck('session', {
        status: 'error',
        message: authMessage,
        steps: helpSteps
      });
      state.overseerrSessionReady = false;
      state.overseerrSessionError = authMessage;
      setSetupVisibility(true);
      reflectSettingsState();
      setStatus('Authentication error. Sign into Overseerr, then try again.', 'warning');
      return false;
    }

    state.settings.overseerrUrl = sanitizedUrl;
    state.overseerrSessionReady = true;
    state.overseerrSessionError = '';
    setSetupCheck('session', {
      status: 'success',
      message: 'Session authorized. Ready to request media.'
    });
    setSetupVisibility(false);
    reflectSettingsState();
    return true;
  } finally {
    setSetupRunning(false);
  }
}

function setSetupVisibility(visible) {
  if (!elements.setupView) {
    setupState.visible = false;
    return;
  }
  setupState.visible = Boolean(visible);
  showView(activeView);
}

function setSetupRunning(running) {
  setupState.running = Boolean(running);
  if (elements.setupRetryButton) {
    elements.setupRetryButton.disabled = Boolean(running);
  }
}

function setSetupCheck(name, config = {}) {
  const { status = 'idle', message = '', steps = [] } = config;
  let card;
  let statusEl;
  let messageEl;
  let helpEl;

  if (name === 'url') {
    card = elements.setupUrlCard;
    statusEl = elements.setupUrlStatus;
    messageEl = elements.setupUrlMessage;
  } else if (name === 'reachability') {
    card = elements.setupReachabilityCard;
    statusEl = elements.setupReachabilityStatus;
    messageEl = elements.setupReachabilityMessage;
  } else if (name === 'session') {
    card = elements.setupSessionCard;
    statusEl = elements.setupSessionStatus;
    messageEl = elements.setupSessionMessage;
    helpEl = elements.setupSessionSteps;
  }

  if (card) {
    card.dataset.status = status;
  }
  if (statusEl) {
    statusEl.textContent = formatSetupStatus(status);
  }
  if (messageEl) {
    messageEl.textContent = message;
  }
  if (helpEl) {
    updateSetupHelpList(helpEl, steps);
  }
}

function formatSetupStatus(status) {
  switch (status) {
    case 'success':
      return 'Ready';
    case 'error':
      return 'Needs attention';
    case 'pending':
      return 'Checking…';
    default:
      return 'Waiting';
  }
}

function updateSetupHelpList(listEl, steps = []) {
  if (!listEl) {
    return;
  }
  listEl.innerHTML = '';
  if (!Array.isArray(steps) || !steps.length) {
    listEl.classList.add('hidden');
    return;
  }
  steps.forEach((step) => {
    const item = document.createElement('li');
    item.textContent = step;
    listEl.appendChild(item);
  });
  listEl.classList.remove('hidden');
}

function updateSetupUrlInput(value = '') {
  if (elements.setupUrlInput) {
    elements.setupUrlInput.value = value || '';
  }
}

async function handleSetupUrlSubmit(event) {
  event.preventDefault();
  if (!elements.setupUrlInput) {
    return;
  }
  const normalized = normalizeBaseUrl(elements.setupUrlInput.value);
  if (!normalized) {
    setSetupCheck('url', {
      status: 'error',
      message: 'Enter a valid Overseerr URL (example: https://overseerr.example.com).'
    });
    elements.setupUrlInput.focus();
    return;
  }

  setSetupCheck('url', {
    status: 'pending',
    message: 'Saving Overseerr URL…'
  });

  try {
    await saveSettings({ overseerrUrl: normalized });
    state.settings.overseerrUrl = normalized;
    const wasVisible = setupState.visible;
    const ready = await runSetupChecks({ forceRefresh: true });
    if (ready && wasVisible) {
      await refreshDetectedMedia();
    }
  } catch (error) {
    setSetupCheck('url', {
      status: 'error',
      message: error?.message || 'Unable to save settings.'
    });
  }
}

async function handleSetupRetry() {
  const wasVisible = setupState.visible;
  const ready = await runSetupChecks({ promptLogin: true, forceRefresh: true });
  if (ready && wasVisible) {
    await refreshDetectedMedia();
  }
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
function sendMessageToTab(tabId, payload) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
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


function shouldShowWeakDetections() {
  return Boolean(state.settings.showWeakDetections);
}
