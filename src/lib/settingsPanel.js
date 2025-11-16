import { DESCRIPTION_LENGTH_LIMITS, DETECTION_LIMITS } from './config.js';
import { callBackground } from './runtime.js';
import { sanitizeDescriptionLength, sanitizeDetectionLimit } from './sanitizers.js';
import { saveSettings } from './settings.js';
import { normalizeBaseUrl } from './url.js';

/**
 * @typedef {Object} SettingsPanelOptions
 * @property {HTMLElement} root
 * @property {string} [idPrefix]
 * @property {number} [descriptionLengthDefault]
 * @property {number} [maxDetectionsDefault]
 * @property {(context: SettingsPanelCallbackContext) => (boolean|void|Promise<boolean|void>)} [onAfterSave]
 * @property {(context: SettingsPanelCallbackContext) => (boolean|void|Promise<boolean|void>)} [onBeforeSave]
 * @property {(values: SettingsPanelValues) => void} [onValuesChange]
 * @property {(result: SettingsPanelTestResult) => void} [onTestResult]
 */

/**
 * @typedef {Object} SettingsPanelValues
 * @property {string} overseerrUrl
 * @property {boolean} prefer4k
 * @property {boolean} showWeakDetections
 * @property {number} maxDetections
 * @property {number} descriptionLength
 */

/**
 * @typedef {Object} SettingsPanelCallbackContext
 * @property {SettingsPanelValues} values
 * @property {(message?: string, tone?: string) => void} setStatus
 * @property {(busy: boolean) => void} setBusy
 */

/**
 * @typedef {Object} SettingsPanelTestResult
 * @property {'success'|'error'|'auth-required'} status
 * @property {SettingsPanelValues} values
 * @property {string} versionLabel
 * @property {Error & { code?: string }} [error]
 */

const TEMPLATE_CLASSNAMES = Object.freeze({
  form: 'settings-form',
  actions: 'panel-actions',
  status: 'panel-status',
  toggle: 'toggle'
});

/**
 * Mounts a shared settings panel UI/logic bundle inside the provided root node.
 * @param {SettingsPanelOptions} options
 */
export function createSettingsPanel(options) {
  const root = options?.root;
  if (!root) {
    return null;
  }
  const idPrefix = options.idPrefix || '';
  const descriptionLengthDefault =
    options.descriptionLengthDefault ?? DESCRIPTION_LENGTH_LIMITS.defaultPopup;
  const maxDetectionsDefault = options.maxDetectionsDefault ?? DETECTION_LIMITS.default;
  root.innerHTML = renderTemplate({ idPrefix, descriptionLengthDefault, maxDetectionsDefault });

  const form = root.querySelector('form');
  const statusEl = root.querySelector('[data-role="settings-status"]');
  const testButton = root.querySelector('[data-role="test-button"]');
  if (!form || !statusEl || !testButton) {
    return null;
  }

  const cleanupHandlers = [];
  const setBusy = (busy) => {
    const controls = form.querySelectorAll('input, button');
    controls.forEach((control) => {
      control.disabled = busy;
    });
  };
  const setStatus = (message = '', tone = 'info') => {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message;
    statusEl.dataset.tone = tone;
  };
  const setTestRunning = (running) => {
    if (testButton) {
      testButton.disabled = running;
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const values = readValues();
    if (options?.onBeforeSave) {
      const continueSave = await options.onBeforeSave({ values, setStatus, setBusy });
      if (continueSave === false) {
        return;
      }
    }
    setBusy(true);
    setStatus('Saving settings…');
    try {
      await saveSettings(values);
      const afterHandled = (await options?.onAfterSave?.({ values, setStatus, setBusy })) || false;
      if (!afterHandled) {
        setStatus('Settings saved.');
      }
    } catch (error) {
      setStatus(error?.message || 'Unable to save settings.', 'error');
    } finally {
      setBusy(false);
    }
  };
  const handleTest = async () => {
    const values = readValues();
    if (!values.overseerrUrl) {
      setStatus('Add your Overseerr URL first.', 'warning');
      options?.onTestResult?.({
        status: 'error',
        values,
        versionLabel: 'unknown version',
        error: new Error('Missing Overseerr URL')
      });
      return;
    }
    setTestRunning(true);
    setStatus('Checking Overseerr server status…');
    let versionLabel = 'unknown version';
    try {
      const status = await callBackground('CHECK_OVERSEERR_STATUS', {
        overseerrUrl: values.overseerrUrl
      });
      versionLabel = status?.version ? `v${status.version}` : versionLabel;
      setStatus(`Overseerr reachable (${versionLabel}). Checking session…`);
    } catch (error) {
      setStatus(`Unable to reach Overseerr: ${error.message}`, 'error');
      options?.onTestResult?.({ status: 'error', values, versionLabel, error });
      setTestRunning(false);
      return;
    }

    try {
      await callBackground('CHECK_OVERSEERR_SESSION', {
        overseerrUrl: values.overseerrUrl,
        promptLogin: true,
        forceRefresh: true
      });
      setStatus(`Overseerr ${versionLabel} reachable. Session authorized. Ready to request.`);
      options?.onTestResult?.({ status: 'success', values, versionLabel });
    } catch (error) {
      if (error?.code === 'AUTH_REQUIRED') {
        setStatus(
          `Overseerr ${versionLabel} reachable, but login required. Log into Overseerr in the opened tab, then retry.`,
          'warning'
        );
        options?.onTestResult?.({ status: 'auth-required', values, versionLabel, error });
        setTestRunning(false);
        return;
      }
      setStatus(
        `Overseerr ${versionLabel} reachable, but unable to verify session: ${error.message}`,
        'error'
      );
      options?.onTestResult?.({ status: 'error', values, versionLabel, error });
    } finally {
      setTestRunning(false);
    }
  };

  form.addEventListener('submit', handleSubmit);
  testButton.addEventListener('click', handleTest);
  cleanupHandlers.push(() => form.removeEventListener('submit', handleSubmit));
  cleanupHandlers.push(() => testButton.removeEventListener('click', handleTest));

  const readValues = () => {
    return {
      overseerrUrl: normalizeBaseUrl(form.overseerrUrl.value),
      prefer4k: Boolean(form.prefer4k.checked),
      showWeakDetections: Boolean(form.showWeakDetections.checked),
      maxDetections: sanitizeDetectionLimit(form.maxDetections.value, maxDetectionsDefault),
      descriptionLength: sanitizeDescriptionLength(
        form.descriptionLength.value,
        descriptionLengthDefault
      )
    };
  };

  const setValues = (values = {}) => {
    form.overseerrUrl.value = values.overseerrUrl || '';
    form.prefer4k.checked = Boolean(values.prefer4k);
    form.showWeakDetections.checked = Boolean(values.showWeakDetections);
    form.maxDetections.value = sanitizeDetectionLimit(
      values.maxDetections ?? maxDetectionsDefault,
      maxDetectionsDefault
    );
    form.descriptionLength.value = sanitizeDescriptionLength(
      values.descriptionLength ?? descriptionLengthDefault,
      descriptionLengthDefault
    );
  };

  return {
    form,
    statusEl,
    setValues,
    readValues,
    setStatus,
    destroy() {
      cleanupHandlers.forEach((fn) => fn());
      root.innerHTML = '';
    }
  };
}

function renderTemplate({ idPrefix, descriptionLengthDefault, maxDetectionsDefault }) {
  const id = (name) => `${idPrefix}${name}`;
  return `
    <form id="${id('settings-form')}" class="${TEMPLATE_CLASSNAMES.form}">
      <label for="${id('overseerrUrl')}">Overseerr URL</label>
      <input
        id="${id('overseerrUrl')}"
        name="overseerrUrl"
        placeholder="https://overseerr.example.com"
        autocomplete="off"
      />

      <label class="${TEMPLATE_CLASSNAMES.toggle}">
        <input id="${id('prefer4k')}" name="prefer4k" type="checkbox" />
        Prefer 4K requests
      </label>

      <label class="${TEMPLATE_CLASSNAMES.toggle}">
        <input id="${id('showWeakDetections')}" name="showWeakDetections" type="checkbox" />
        Show weak detections (debug)
      </label>

      <label for="${id('maxDetections')}">Maximum detections shown</label>
      <input
        id="${id('maxDetections')}"
        name="maxDetections"
        type="number"
        min="${DETECTION_LIMITS.min}"
        max="${DETECTION_LIMITS.max}"
        placeholder="Defaults to ${maxDetectionsDefault}"
      />

      <label for="${id('descriptionLength')}">Description display length (characters)</label>
      <input
        id="${id('descriptionLength')}"
        name="descriptionLength"
        type="number"
        min="${DESCRIPTION_LENGTH_LIMITS.min}"
        max="${DESCRIPTION_LENGTH_LIMITS.max}"
        placeholder="Defaults to ${descriptionLengthDefault}"
      />

      <div class="${TEMPLATE_CLASSNAMES.actions}">
        <button type="submit">Save</button>
        <button type="button" class="secondary" data-role="test-button">Test Overseerr</button>
      </div>
    </form>
    <p class="${TEMPLATE_CLASSNAMES.status}" data-role="settings-status"></p>
  `;
}
