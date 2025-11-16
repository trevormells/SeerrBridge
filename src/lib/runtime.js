/**
 * Sends a structured message to the background service worker and resolves the payload.
 * @template T
 * @param {string} type
 * @param {Record<string, any>} [payload]
 * @returns {Promise<T>}
 */
export function callBackground(type, payload) {
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
