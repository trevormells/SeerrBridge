const DEFAULT_MAX_DETECTIONS = 10;
const MAX_ALLOWED_DETECTIONS = 100;
const DEFAULT_DESCRIPTION_LENGTH = 60;
const MIN_DESCRIPTION_LENGTH = 10;
const MAX_DESCRIPTION_LENGTH = 500;
const form = document.getElementById('settings-form');
const statusEl = document.getElementById('options-status');
const testButton = document.getElementById('test-overseerr');

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await getSettings();
  form.overseerrUrl.value = settings.overseerrUrl || '';
  document.getElementById('prefer4k').checked = Boolean(settings.prefer4k);
  form.showWeakDetections.checked = Boolean(settings.showWeakDetections);
  form.maxDetections.value = sanitizeDetectionLimit(
    settings.maxDetections ?? DEFAULT_MAX_DETECTIONS
  );
  form.descriptionLength.value = sanitizeDescriptionLength(
    settings.descriptionLength ?? DEFAULT_DESCRIPTION_LENGTH
  );
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await saveSettings();
  setStatus('Settings saved.');
});

testButton.addEventListener('click', async () => {
  const { overseerrUrl } = readForm();
  if (!overseerrUrl) {
    setStatus('Add your Overseerr URL first.', 'warning');
    return;
  }

  setStatus('Checking Overseerr session…');
  try {
    await callBackground('CHECK_OVERSEERR_SESSION', {
      overseerrUrl,
      promptLogin: true,
      forceRefresh: true
    });
    setStatus('Overseerr session detected. Ready to request.');
  } catch (error) {
    if (error.code === 'AUTH_REQUIRED') {
      setStatus('Log into Overseerr in the opened tab, then click Test again.', 'warning');
      return;
    }
    setStatus(`Unable to reach Overseerr: ${error.message}`, 'error');
  }
});

function readForm() {
  return {
    overseerrUrl: normalizeBaseUrl(form.overseerrUrl.value),
    prefer4k: document.getElementById('prefer4k').checked,
    showWeakDetections: Boolean(form.showWeakDetections.checked),
    maxDetections: sanitizeDetectionLimit(form.maxDetections.value),
    descriptionLength: sanitizeDescriptionLength(form.descriptionLength.value)
  };
}

function saveSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.set(readForm(), resolve);
  });
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      [
        'overseerrUrl',
        'prefer4k',
        'showWeakDetections',
        'maxDetections',
        'descriptionLength'
      ],
      (result) => resolve(result || {})
    );
  });
}

function setStatus(message, tone = 'info') {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function normalizeBaseUrl(value) {
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
    // Fall back to best-effort normalization; background validation will surface bad inputs.
    return candidate.replace(/\/+$/, '');
  }
}

function sanitizeDetectionLimit(value) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MAX_DETECTIONS;
  }

  if (parsed < 1) {
    return 1;
  }

  return Math.min(parsed, MAX_ALLOWED_DETECTIONS);
}

function sanitizeDescriptionLength(value) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_DESCRIPTION_LENGTH;
  }

  if (parsed < MIN_DESCRIPTION_LENGTH) {
    return MIN_DESCRIPTION_LENGTH;
  }

  return Math.min(parsed, MAX_DESCRIPTION_LENGTH);
}

function callBackground(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      if (!response) {
        reject(new Error('No response from background.'));
        return;
      }
      if (!response.ok) {
        const error = new Error(response.error || 'Unknown background error.');
        if (response.code) {
          error.code = response.code;
        }
        reject(error);
        return;
      }
      resolve(response.data);
    });
  });
}
