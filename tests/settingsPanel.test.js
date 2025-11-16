import test from 'node:test';
import assert from 'node:assert/strict';

const helpersPromise = import('../src/lib/settingsPanel.js');
const configPromise = import('../src/lib/config.js');

function createMockForm(initial = {}) {
  const form = {
    overseerrUrl: { value: '' },
    prefer4k: { checked: false },
    showWeakDetections: { checked: false },
    maxDetections: { value: '' },
    descriptionLength: { value: '' }
  };
  if ('overseerrUrl' in initial) {
    form.overseerrUrl.value = initial.overseerrUrl;
  }
  if ('prefer4k' in initial) {
    form.prefer4k.checked = Boolean(initial.prefer4k);
  }
  if ('showWeakDetections' in initial) {
    form.showWeakDetections.checked = Boolean(initial.showWeakDetections);
  }
  if ('maxDetections' in initial) {
    form.maxDetections.value = initial.maxDetections;
  }
  if ('descriptionLength' in initial) {
    form.descriptionLength.value = initial.descriptionLength;
  }
  return form;
}

test('readSettingsFormValues normalizes inputs and clamps limits', async () => {
  const [{ readSettingsFormValues }, { DETECTION_LIMITS, DESCRIPTION_LENGTH_LIMITS }] = await Promise.all([
    helpersPromise,
    configPromise
  ]);

  const form = createMockForm({
    overseerrUrl: 'overseerr.example.com///',
    prefer4k: true,
    showWeakDetections: 0,
    maxDetections: '9999',
    descriptionLength: '5'
  });

  const values = readSettingsFormValues(form, {
    descriptionLengthDefault: 45,
    maxDetectionsDefault: 25
  });

  assert.equal(values.overseerrUrl, 'https://overseerr.example.com');
  assert.equal(values.prefer4k, true);
  assert.equal(values.showWeakDetections, false);
  assert.equal(values.maxDetections, DETECTION_LIMITS.max);
  assert.equal(values.descriptionLength, DESCRIPTION_LENGTH_LIMITS.min);
});

test('writeSettingsFormValues populates sanitized data back to the form', async () => {
  const [{ writeSettingsFormValues }, { DETECTION_LIMITS, DESCRIPTION_LENGTH_LIMITS }] = await Promise.all([
    helpersPromise,
    configPromise
  ]);

  const form = createMockForm();
  writeSettingsFormValues(
    form,
    {
      overseerrUrl: 'https://demo.invalid',
      prefer4k: true,
      showWeakDetections: true,
      maxDetections: 0,
      descriptionLength: 2000
    },
    { descriptionLengthDefault: 30, maxDetectionsDefault: 10 }
  );

  assert.equal(form.overseerrUrl.value, 'https://demo.invalid');
  assert.equal(form.prefer4k.checked, true);
  assert.equal(form.showWeakDetections.checked, true);
  assert.equal(form.maxDetections.value, DETECTION_LIMITS.min);
  assert.equal(form.descriptionLength.value, DESCRIPTION_LENGTH_LIMITS.max);
});

test('testOverseerrWorkflow handles missing URLs gracefully', async () => {
  const { testOverseerrWorkflow } = await helpersPromise;
  const statuses = [];
  const results = [];

  const outcome = await testOverseerrWorkflow(
    {},
    {
      setStatus: (message, tone) => statuses.push({ message, tone }),
      onTestResult: (result) => results.push(result)
    }
  );

  assert.equal(outcome.status, 'error');
  assert.equal(statuses[0].tone, 'warning');
  assert.equal(results[0].error.message, 'Missing Overseerr URL');
});

test('testOverseerrWorkflow resolves success path and toggles busy state', async () => {
  const { testOverseerrWorkflow } = await helpersPromise;
  const statuses = [];
  const results = [];
  const runningStates = [];
  const callArgs = [];

  const outcome = await testOverseerrWorkflow(
    { overseerrUrl: 'https://example.invalid' },
    {
      setStatus: (message, tone) => statuses.push({ message, tone }),
      setTestRunning: (running) => runningStates.push(running),
      onTestResult: (result) => results.push(result),
      callBackgroundImpl: async (type, payload) => {
        callArgs.push({ type, payload });
        if (type === 'CHECK_OVERSEERR_STATUS') {
          return { version: '1.2.3' };
        }
        if (type === 'CHECK_OVERSEERR_SESSION') {
          return { ok: true };
        }
        throw new Error('unexpected call');
      }
    }
  );

  assert.equal(outcome.status, 'success');
  assert.deepEqual(runningStates, [true, false]);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'success');
  assert.equal(callArgs.length, 2);
  assert.equal(statuses.at(-1).message.includes('Session authorized'), true);
});

test('testOverseerrWorkflow reports auth-required state when session fails', async () => {
  const { testOverseerrWorkflow } = await helpersPromise;
  const statuses = [];
  const results = [];
  const runningStates = [];

  const authError = new Error('Login required');
  authError.code = 'AUTH_REQUIRED';

  const outcome = await testOverseerrWorkflow(
    { overseerrUrl: 'https://example.invalid' },
    {
      setStatus: (message, tone) => statuses.push({ message, tone }),
      setTestRunning: (running) => runningStates.push(running),
      onTestResult: (result) => results.push(result),
      callBackgroundImpl: async (type) => {
        if (type === 'CHECK_OVERSEERR_STATUS') {
          return { version: '2.0.0' };
        }
        throw authError;
      }
    }
  );

  assert.equal(outcome.status, 'auth-required');
  assert.deepEqual(runningStates, [true, false]);
  assert.equal(results[0].status, 'auth-required');
  assert.equal(statuses.at(-1).tone, 'warning');
});
