import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { JsonlRpcClient } from '../src/jsonl-rpc.js';

function childProcess() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  return child;
}

test('JSONL RPC reports one unexpected process exit to lifecycle owners', () => {
  const child = childProcess();
  const rpc = new JsonlRpcClient(child);
  if (typeof rpc.onClose !== 'function') {
    rpc.close();
    assert.fail('JSONL RPC must expose a close notification');
  }
  const closed = [];
  rpc.onClose((error) => closed.push(error?.message || null));

  child.emit('exit', 23);
  child.emit('error', new Error('later child error'));

  assert.deepEqual(closed, ['managed provider process exited (23)']);
});
