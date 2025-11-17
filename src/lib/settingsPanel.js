import { DESCRIPTION_LENGTH_LIMITS, DETECTION_LIMITS } from './config.js';
import { OVERSEERR_AUTH_MODES } from './overseerr.js';
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
 * @property {string} [overseerrApiKey]
 * @property {string} [overseerrAuthMethod]
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

const noop = () => {};

/**
 * Reads values from the settings form and enforces the configured limits.
 * @param {HTMLFormElement & Record<string, HTMLInputElement>} form
 * @param {{ descriptionLengthDefault?: number, maxDetectionsDefault?: number }} [overrides]
 * @returns {SettingsPanelValues}
 */
export function readSettingsFormValues(form, overrides = {}) {
  if (!form) {
    throw new TypeError('A form reference is required to read values.');
  }

  const descriptionLengthDefault =
    overrides.descriptionLengthDefault ?? DESCRIPTION_LENGTH_LIMITS.defaultPopup;
  const maxDetectionsDefault = overrides.maxDetectionsDefault ?? DETECTION_LIMITS.default;

  const apiKey = typeof form.overseerrApiKey?.value === 'string' ? form.overseerrApiKey.value.trim() : '';
  const authMethod = apiKey
    ? OVERSEERR_AUTH_MODES.COOKIES_WITH_API_KEY_FALLBACK
    : OVERSEERR_AUTH_MODES.COOKIES;

  return {
    overseerrUrl: normalizeBaseUrl(form.overseerrUrl?.value || ''),
    prefer4k: Boolean(form.prefer4k?.checked),
    showWeakDetections: Boolean(form.showWeakDetections?.checked),
    maxDetections: sanitizeDetectionLimit(form.maxDetections?.value, maxDetectionsDefault),
    descriptionLength: sanitizeDescriptionLength(
      form.descriptionLength?.value,
      descriptionLengthDefault
    ),
    overseerrApiKey: apiKey,
    overseerrAuthMethod: authMethod
  };
}

/**
 * Populates the settings form with the provided values.
 * @param {HTMLFormElement & Record<string, HTMLInputElement>} form
 * @param {SettingsPanelValues} [values]
 * @param {{ descriptionLengthDefault?: number, maxDetectionsDefault?: number }} [overrides]
 */
export function writeSettingsFormValues(form, values = {}, overrides = {}) {
  if (!form) {
    throw new TypeError('A form reference is required to set values.');
  }

  const descriptionLengthDefault =
    overrides.descriptionLengthDefault ?? DESCRIPTION_LENGTH_LIMITS.defaultPopup;
  const maxDetectionsDefault = overrides.maxDetectionsDefault ?? DETECTION_LIMITS.default;

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
  if (form.overseerrApiKey) {
    form.overseerrApiKey.value = values.overseerrApiKey || '';
  }
}

/**
 * Executes the full "Test Overseerr" workflow shared by options/popup.
 * @param {SettingsPanelValues} values
 * @param {{
 *   setStatus?: (message?: string, tone?: string) => void,
 *   setTestRunning?: (running: boolean) => void,
 *   onTestResult?: (result: SettingsPanelTestResult) => void,
 *   callBackgroundImpl?: typeof callBackground
 * }} [options]
 * @returns {Promise<SettingsPanelTestResult>}
 */
export async function testOverseerrWorkflow(values = {}, options = {}) {
  const setStatus = options.setStatus || noop;
  const setTestRunning = options.setTestRunning || noop;
  const onTestResult = options.onTestResult || noop;
  const callBackgroundImpl = options.callBackgroundImpl || callBackground;
  const versionLabelFallback = 'unknown version';

  if (!values.overseerrUrl) {
    const error = new Error('Missing Overseerr URL');
    const result = { status: 'error', values, versionLabel: versionLabelFallback, error };
    setStatus('Add your Overseerr URL first.', 'warning');
    onTestResult(result);
    return result;
  }

  setTestRunning(true);
  setStatus('Checking Overseerr server status…');

  let versionLabel = versionLabelFallback;
  try {
    const status = await callBackgroundImpl('CHECK_OVERSEERR_STATUS', {
      overseerrUrl: values.overseerrUrl
    });
    versionLabel = status?.version ? `v${status.version}` : versionLabel;
    setStatus(`Overseerr reachable (${versionLabel}). Checking session…`);
  } catch (error) {
    const result = { status: 'error', values, versionLabel, error };
    setStatus(`Unable to reach Overseerr: ${error.message}`, 'error');
    onTestResult(result);
    setTestRunning(false);
    return result;
  }

  try {
    await callBackgroundImpl('CHECK_OVERSEERR_SESSION', {
      overseerrUrl: values.overseerrUrl,
      promptLogin: true,
      forceRefresh: true
    });
    const result = { status: 'success', values, versionLabel };
    setStatus(`Overseerr ${versionLabel} reachable. Session authorized. Ready to request.`);
    onTestResult(result);
    return result;
  } catch (error) {
    if (error?.code === 'AUTH_REQUIRED') {
      const result = { status: 'auth-required', values, versionLabel, error };
      setStatus(
        `Overseerr ${versionLabel} reachable, but login required. Log into Overseerr in the opened tab, then retry.`,
        'warning'
      );
      onTestResult(result);
      return result;
    }
    const result = { status: 'error', values, versionLabel, error };
    setStatus(
      `Overseerr ${versionLabel} reachable, but unable to verify session: ${error.message}`,
      'error'
    );
    onTestResult(result);
    return result;
  } finally {
    setTestRunning(false);
  }
}

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
    await testOverseerrWorkflow(values, {
      setStatus,
      setTestRunning,
      onTestResult: options?.onTestResult
    });
  };

  form.addEventListener('submit', handleSubmit);
  testButton.addEventListener('click', handleTest);
  cleanupHandlers.push(() => form.removeEventListener('submit', handleSubmit));
  cleanupHandlers.push(() => testButton.removeEventListener('click', handleTest));

  const readValues = () =>
    readSettingsFormValues(form, { descriptionLengthDefault, maxDetectionsDefault });

  const setValues = (values = {}) =>
    writeSettingsFormValues(form, values, {
      descriptionLengthDefault,
      maxDetectionsDefault
    });

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

      <label for="${id('overseerrApiKey')}">Overseerr API key (optional)</label>
      <input
        id="${id('overseerrApiKey')}"
        name="overseerrApiKey"
        placeholder="Paste your Overseerr API key"
        autocomplete="off"
      />

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
