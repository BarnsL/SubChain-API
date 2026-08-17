import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as supervisorModule from '../src/supervisor.js';

test('startup probes available managed runtimes without probing uncredentialed HTTP providers', () => {
  if (typeof supervisorModule.providersForStartupProbe !== 'function') {
    assert.fail('startup provider selection must expose a testable helper');
  }
  const providers = [
    { id: 'openai-codex', transport: 'codex-app-server', hasCredential: false, lastPingAt: null },
    { id: 'google-antigravity', transport: 'antigravity-cli', hasCredential: false, lastPingAt: 123 },
    { id: 'google', transport: 'http', hasCredential: false, lastPingAt: null },
    { id: 'anthropic', transport: 'http', hasCredential: true, lastPingAt: null },
  ];

  const selected = supervisorModule.providersForStartupProbe(
    providers,
    (providerId) => providerId === 'openai-codex' || providerId === 'google-antigravity',
  );

  assert.deepEqual(selected.map((provider) => provider.id), ['openai-codex', 'anthropic']);
});

test('worker shutdown disposes managed transports before closing the server', () => {
  if (typeof supervisorModule.installWorkerShutdown !== 'function') {
    assert.fail('worker lifecycle must expose testable shutdown wiring');
  }
  const processTarget = new EventEmitter();
  const events = [];
  processTarget.exit = (code) => events.push(`exit:${code}`);
  const server = {
    close(callback) {
      events.push('server.close');
      callback();
    },
  };
  const managedTransports = { dispose: () => events.push('managed.dispose') };
  supervisorModule.installWorkerShutdown({ processTarget, server, managedTransports });

  processTarget.emit('SIGTERM');
  processTarget.emit('SIGINT');

  assert.deepEqual(events, ['managed.dispose', 'server.close', 'exit:0']);
});
