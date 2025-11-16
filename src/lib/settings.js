/**
 * Keys read from chrome.storage.sync across extension surfaces.
 */
export const CORE_SETTINGS_KEYS = Object.freeze(['overseerrUrl', 'prefer4k']);

/**
 * Keys required by popup/options screens (superset of CORE settings).
 */
export const UI_SETTINGS_KEYS = Object.freeze([
  ...CORE_SETTINGS_KEYS,
  'showWeakDetections',
  'maxDetections',
  'descriptionLength'
]);

/**
 * Loads sync storage values for the supplied keys.
 * @param {string[]} [keys=UI_SETTINGS_KEYS]
 * @returns {Promise<Record<string, any>>}
 */
export function loadSettings(keys = UI_SETTINGS_KEYS) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(result || {});
    });
  });
}

/**
 * Persists sync storage values. Consumers can pass partial updates.
 * @param {Record<string, any>} payload
 * @returns {Promise<void>}
 */
export function saveSettings(payload) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(payload, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}
