import test from 'node:test';
import assert from 'node:assert/strict';

import { createRuntimeMessageListener } from '../../src/background/index.js';

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('synchronous handler failures are routed through the catch block', async () => {
  const listener = createRuntimeMessageListener({
    TEST_SYNC_ERROR: () => {
      throw new Error('sync boom');
    }
  });

  const responses = [];
  const sendResponse = (payload) => responses.push(payload);
  const originalError = console.error;
  const errorLogs = [];
  console.error = (...args) => {
    errorLogs.push(args);
  };

  try {
    const returnValue = listener({ type: 'TEST_SYNC_ERROR' }, null, sendResponse);
    assert.strictEqual(returnValue, true);
    await flushMicrotasks();

    assert.deepEqual(responses, [{ ok: false, error: 'sync boom' }]);
    const syncLog = errorLogs.find(([message]) => message === 'Background handler failed');
    assert.ok(syncLog, 'missing background error log entry');
    assert.strictEqual(syncLog[1]?.type, 'TEST_SYNC_ERROR');
  } finally {
    console.error = originalError;
  }
});

test('asynchronous handler failures are routed through the catch block', async () => {
  const listener = createRuntimeMessageListener({
    TEST_ASYNC_ERROR: () => Promise.reject(new Error('async boom'))
  });

  const responses = [];
  const sendResponse = (payload) => responses.push(payload);
  const originalError = console.error;
  const errorLogs = [];
  console.error = (...args) => {
    errorLogs.push(args);
  };

  try {
    const returnValue = listener({ type: 'TEST_ASYNC_ERROR' }, null, sendResponse);
    assert.strictEqual(returnValue, true);
    await flushMicrotasks();

    assert.deepEqual(responses, [{ ok: false, error: 'async boom' }]);
    const asyncLog = errorLogs.find(([message]) => message === 'Background handler failed');
    assert.ok(asyncLog, 'missing background error log entry');
    assert.strictEqual(asyncLog[1]?.type, 'TEST_ASYNC_ERROR');
  } finally {
    console.error = originalError;
  }
});
