import { DESCRIPTION_LENGTH_LIMITS } from '../lib/config.js';
import { loadSettings } from '../lib/settings.js';
import { createSettingsPanel } from '../lib/settingsPanel.js';

const panel = createSettingsPanel({
  root: document.getElementById('options-settings-panel'),
  idPrefix: 'options-',
  descriptionLengthDefault: DESCRIPTION_LENGTH_LIMITS.defaultOptions
});

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await loadSettings();
  panel?.setValues(settings);
});
