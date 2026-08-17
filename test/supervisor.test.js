import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as supervisorModule from '../src/supervisor.js';

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
