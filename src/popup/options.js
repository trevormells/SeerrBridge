import { DESCRIPTION_LENGTH_LIMITS, DETECTION_LIMITS } from '../lib/config.js';
import { callBackground } from '../lib/runtime.js';
import { sanitizeDescriptionLength, sanitizeDetectionLimit } from '../lib/sanitizers.js';
import { loadSettings, saveSettings } from '../lib/settings.js';
import { normalizeBaseUrl } from '../lib/url.js';

const form = document.getElementById('settings-form');
const statusEl = document.getElementById('options-status');
const testButton = document.getElementById('test-overseerr');

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await loadSettings();
  form.overseerrUrl.value = settings.overseerrUrl || '';
  document.getElementById('prefer4k').checked = Boolean(settings.prefer4k);
  form.showWeakDetections.checked = Boolean(settings.showWeakDetections);
  form.maxDetections.value = sanitizeDetectionLimit(
    settings.maxDetections ?? DETECTION_LIMITS.default,
    DETECTION_LIMITS.default
  );
  form.descriptionLength.value = sanitizeDescriptionLength(
    settings.descriptionLength ?? DESCRIPTION_LENGTH_LIMITS.defaultOptions,
    DESCRIPTION_LENGTH_LIMITS.defaultOptions
  );
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await saveSettings(readForm());
  setStatus('Settings saved.');
});

testButton.addEventListener('click', async () => {
  const { overseerrUrl } = readForm();
  if (!overseerrUrl) {
    setStatus('Add your Overseerr URL first.', 'warning');
    return;
  }

  setStatus('Checking Overseerr server status…');
  let versionLabel = 'unknown version';
  try {
    const status = await callBackground('CHECK_OVERSEERR_STATUS', { overseerrUrl });
    versionLabel = status?.version ? `v${status.version}` : versionLabel;
    setStatus(`Overseerr reachable (${versionLabel}). Checking session…`);
  } catch (error) {
    setStatus(`Unable to reach Overseerr: ${error.message}`, 'error');
    return;
  }

  try {
    await callBackground('CHECK_OVERSEERR_SESSION', {
      overseerrUrl,
      promptLogin: true,
      forceRefresh: true
    });
    setStatus(`Overseerr ${versionLabel} reachable. Session authorized. Ready to request.`);
  } catch (error) {
    if (error.code === 'AUTH_REQUIRED') {
      setStatus(
        `Overseerr ${versionLabel} reachable, but login required. Log into Overseerr in the opened tab, then click Test again.`,
        'warning'
      );
      return;
    }
    setStatus(
      `Overseerr ${versionLabel} reachable, but unable to verify session: ${error.message}`,
      'error'
    );
  }
});

function readForm() {
  return {
    overseerrUrl: normalizeBaseUrl(form.overseerrUrl.value),
    prefer4k: document.getElementById('prefer4k').checked,
    showWeakDetections: Boolean(form.showWeakDetections.checked),
    maxDetections: sanitizeDetectionLimit(
      form.maxDetections.value,
      DETECTION_LIMITS.default
    ),
    descriptionLength: sanitizeDescriptionLength(
      form.descriptionLength.value,
      DESCRIPTION_LENGTH_LIMITS.defaultOptions
    )
  };
}

function setStatus(message, tone = 'info') {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}
