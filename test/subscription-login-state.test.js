import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSecretStore } from '../src/storage.js';
import { createRoutingRuntime } from '../src/routing.js';

const { createSubscriptionLoginState, shouldShowSubscriptionLogin, shouldPreserveSubscriptionCard, subscriptionFocusTarget } = await import('../src/webui/subscription-login-state.js');
const { routingInventory } = await import('../src/admin.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}

function timerHarness() {
  const scheduled = [];
  const cleared = [];
  return {
    schedule(callback, delay) {
      const timer = { callback, delay, cleared: false };
      scheduled.push(timer);
      return timer;
    },
    clear(timer) {
      if (timer) {
        timer.cleared = true;
        cleared.push(timer);
      }
    },
    scheduled,
    cleared,
  };
}

function createFlow({ start, status, cancel, ping } = {}) {
  const timers = timerHarness();
  const changes = [];
  let connected = 0;
  let cancelled = 0;
  const flow = createSubscriptionLoginState({
    start: start || (async () => ({ status: 'pending', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234' })),
    status: status || (async () => ({ status: 'pending', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234' })),
    cancel: cancel || (async () => ({ status: 'cancelled' })),
    ping: ping || (async () => {}),
    schedule: timers.schedule,
    clear: timers.clear,
    onChange: (value) => changes.push(value),
    onConnected: async () => { connected += 1; },
    onCancelled: () => { cancelled += 1; },
  });
  return { flow, timers, changes, counts: () => ({ connected, cancelled }) };
}

function inventoryRuntime() {
  return createRoutingRuntime({
    secretStore: createSecretStore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-login-state-')) }),
    routing: { schemaVersion: 2, chains: [], localKeys: [] },
  });
}

test('pending login polls once, keeps an unchanged code stable, and clears its timer on cancellation', async () => {
  const { flow, timers, changes, counts } = createFlow();

  await flow.start();
  assert.equal(flow.current().snapshot.status, 'pending');
  assert.equal(timers.scheduled.length, 1);
  const changesBeforePoll = changes.length;
  await timers.scheduled[0].callback();
  assert.equal(changes.length, changesBeforePoll, 'unchanged pending snapshot must not repaint the card');
  assert.equal(timers.scheduled.length, 2);

  await flow.cancel();
  assert.equal(flow.current().snapshot.status, 'cancelled');
  assert.equal(counts().cancelled, 1);
  assert.equal(timers.scheduled[1].cleared, true);
});

test('an early ready response refreshes instead of rendering a failure', async () => {
  const { flow, timers, changes, counts } = createFlow({ start: async () => ({ status: 'ready' }) });

  await flow.start();

  assert.equal(flow.current().snapshot.status, 'connected');
  assert.equal(counts().connected, 1);
  assert.equal(timers.scheduled.length, 0);
  assert.equal(changes.some((state) => state.snapshot?.status === 'failed'), false);
});

test('a failed completion is retryable and clears its polling timer', async () => {
  let starts = 0;
  const { flow, timers } = createFlow({
    start: async () => ({ status: ++starts === 1 ? 'pending' : 'ready' }),
    status: async () => ({ status: 'failed' }),
  });

  await flow.start();
  await timers.scheduled[0].callback();
  assert.equal(flow.current().snapshot.status, 'failed');
  assert.equal(timers.scheduled.length, 1, 'a terminal response must not schedule another poll');

  await flow.start();
  assert.equal(starts, 2, 'a failed sign-in must allow a new start');
  assert.equal(flow.current().snapshot.status, 'connected');
});

test('failed cancellation does not announce cancellation and remains retryable', async () => {
  let starts = 0;
  const { flow, counts } = createFlow({
    start: async () => ({ status: ++starts === 1 ? 'pending' : 'ready' }),
    cancel: async () => ({ status: 'failed' }),
  });

  await flow.start();
  await flow.cancel();

  assert.equal(flow.current().snapshot.status, 'failed');
  assert.equal(counts().cancelled, 0);
  await flow.start();
  assert.equal(starts, 2);
});

test('Ping failure keeps ChatGPT connected and offers a Ping retry', async () => {
  let pings = 0;
  const { flow, counts } = createFlow({
    start: async () => ({ status: 'ready' }),
    ping: async () => {
      pings += 1;
      if (pings === 1) throw new Error('unavailable');
    },
  });

  await flow.start();
  assert.equal(flow.current().snapshot.status, 'refresh-error');
  assert.equal(counts().connected, 0);

  await flow.retryPing();
  assert.equal(flow.current().snapshot.status, 'connected');
  assert.equal(counts().connected, 1);
  assert.equal(pings, 2);
});

test('stale responses and duplicate starts cannot override a cancelled login', async () => {
  const starting = deferred();
  const polling = deferred();
  let starts = 0;
  const { flow, timers } = createFlow({
    start: async () => { starts += 1; return starting.promise; },
    status: async () => polling.promise,
  });

  const firstStart = flow.start();
  await flow.start();
  assert.equal(starts, 1);
  starting.resolve({ status: 'pending' });
  await firstStart;
  const pendingPoll = timers.scheduled[0].callback();
  await flow.cancel();
  polling.resolve({ status: 'ready' });
  await pendingPoll;

  assert.equal(flow.current().snapshot.status, 'cancelled');
  assert.equal(timers.scheduled.length, 1, 'a stale terminal response must not schedule another poll');
});

test('an active refresh-error panel remains visible after inventory records Ping failure', () => {
  const statusStore = {
    list: () => [{ providerId: 'openai-codex', health: 'error' }],
    get: () => ({ providerId: 'openai-codex', health: 'error' }),
  };
  const provider = routingInventory(inventoryRuntime(), null, {
    statusStore,
    managedProviderAvailable: () => true,
  }).providers.find((candidate) => candidate.id === 'openai-codex');

  assert.equal(provider.canConnectSubscription, false);
  assert.equal(shouldShowSubscriptionLogin(provider, { snapshot: { status: 'refresh-error' } }), true);
  assert.equal(shouldShowSubscriptionLogin(provider, { snapshot: null }), false);
});

test('subscription transitions restore focus to a stable, meaningful target', () => {
  assert.equal(subscriptionFocusTarget('connect', { snapshot: { status: 'pending' }, busy: false }), 'code');
  assert.equal(subscriptionFocusTarget('cancel', { snapshot: { status: 'pending' }, busy: true }), 'code');
  assert.equal(subscriptionFocusTarget('cancel', { snapshot: { status: 'refreshing' }, busy: true }), 'panel');
  assert.equal(subscriptionFocusTarget('panel', { snapshot: { status: 'refresh-error' }, busy: false }), 'retry-ping');
  assert.equal(subscriptionFocusTarget('cancel', { snapshot: { status: 'failed' }, busy: false }), 'connect');
});

test('only the active pending subscription card is preserved during inventory refresh', () => {
  assert.equal(shouldPreserveSubscriptionCard('openai-codex', { snapshot: { status: 'pending' } }), true);
  assert.equal(shouldPreserveSubscriptionCard('google', { snapshot: { status: 'pending' } }), false);
  assert.equal(shouldPreserveSubscriptionCard('openai-codex', { snapshot: { status: 'refresh-error' } }), false);
});
