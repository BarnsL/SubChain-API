import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RequestJournal,
  createSseMeter,
  estimatedUsage,
  requestMetadata,
  summarizeInput,
  summarizeJsonOutput,
} from '../src/request-journal.js';

const temporaryDirectory = () => fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-journal-'));

test('request and response summaries count content without retaining it', () => {
  const input = summarizeInput({
    model: 'auto',
    stream: false,
    max_tokens: 321,
    messages: [
      { role: 'system', content: 'private system text' },
      { role: 'user', content: [{ type: 'text', text: 'private user text' }] },
    ],
    tools: [{ type: 'function', function: { name: 'private_tool', parameters: { secret: true } } }],
  });
  const output = summarizeJsonOutput(JSON.stringify({
    choices: [{ message: { content: 'private answer' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 17, completion_tokens: 5, total_tokens: 22 },
  }));

  assert.deepEqual(input, {
    model: 'auto',
    stream: false,
    messageCount: 2,
    roles: { system: 1, user: 1 },
    inputChars: 36,
    toolCount: 1,
    maxTokens: 321,
  });
  assert.equal(output.choiceCount, 1);
  assert.deepEqual(output.finishReasons, ['stop']);
  assert.equal(output.outputChars, 14);
  assert.equal(output.usage.source, 'exact');
  assert.deepEqual(output.usage, { inputTokens: 17, outputTokens: 5, totalTokens: 22, source: 'exact' });
  assert.doesNotMatch(JSON.stringify({ input, output }), /private|secret/i);
});

test('token estimates are explicit and streaming output is metered incrementally', () => {
  assert.deepEqual(estimatedUsage(9, 5), {
    inputTokens: 3,
    outputTokens: 2,
    totalTokens: 5,
    source: 'estimated',
  });

  const meter = createSseMeter();
  meter.push(Buffer.from('data: {"choices":[{"delta":{"content":"hel"}}]}\n'));
  meter.push(Buffer.from('\ndata: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\ndata: [DONE]\n\n'));
  const summary = meter.finish(20);

  assert.equal(summary.outputChars, 5);
  assert.equal(summary.choiceCount, 1);
  assert.deepEqual(summary.finishReasons, ['stop']);
  assert.deepEqual(summary.usage, { inputTokens: 4, outputTokens: 2, totalTokens: 6, source: 'exact' });
  assert.ok(summary.outputBytes > 5);
});

test('client metadata is opt-in, categorized, sanitized, and length capped', () => {
  const metadata = requestMetadata({
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      'x-subchain-app': ` Nous\u0000 Man ${'x'.repeat(100)} `,
      'x-subchain-session-id': 'session\r\n1538967477453717675',
      'x-freechain-app': 'wrong-brand-app',
      'x-freechain-session-id': 'wrong-brand-session',
      'x-stainless-lang': 'js',
      'x-stainless-package-version': '4.2.0',
      authorization: 'Bearer must-never-appear',
    },
  });

  assert.equal(metadata.remoteCategory, 'loopback');
  assert.equal(metadata.reportedApp.length, 80);
  assert.equal(metadata.sessionId, 'session1538967477453717675');
  assert.deepEqual(metadata.sdk, { language: 'js', packageVersion: '4.2.0' });
  assert.doesNotMatch(JSON.stringify(metadata), /Bearer|must-never-appear/);
});

test('journal bounds memory, filters before pagination, and drops unsafe fields', () => {
  const journal = new RequestJournal({ enabled: false, maxEntries: 3 });
  assert.deepEqual(journal.status(), {
    persistence: 'memory-only',
    maxEntries: 3,
    rotateAtBytes: 5 * 1024 * 1024,
    predecessors: 1,
  });
  for (let index = 1; index <= 4; index++) {
    journal.append({
      id: `r${index}`,
      startedAt: `2026-08-17T17:47:0${index}.000Z`,
      completedAt: `2026-08-17T17:47:0${index}.010Z`,
      durationMs: index * 10,
      route: index === 4 ? '/v1/models' : '/v1/chat/completions',
      method: index === 4 ? 'GET' : 'POST',
      status: index === 2 ? 401 : 200,
      outcome: index === 2 ? 'auth-rejected' : 'served',
      client: { reportedApp: index % 2 ? 'Nous Man' : 'Codex', sessionId: `s${index}` },
      request: { model: 'auto', inputSummary: { inputChars: index * 4 } },
      attempts: [{ provider: 'local', model: 'first', keyIndex: 0, outcome: 'ok', ms: 2, detail: 'provider body secret' }],
      served: { provider: 'local', model: 'first', keyIndex: 0 },
      result: { usage: estimatedUsage(index * 4, index * 2), outputChars: index * 2 },
      cooling: { count: 0, candidates: [] },
      error: { code: 'invalid_api_key', category: 'authentication', message: 'raw secret' },
      prompt: 'never persist this prompt',
      response: 'never persist this response',
      authorization: 'Bearer never-persist-this',
    });
  }

  const all = journal.query({ limit: 2 });
  assert.deepEqual(all.items.map((item) => item.id), ['r4', 'r3']);
  assert.equal(all.nextBefore, 'r3');
  assert.deepEqual(journal.query({ before: 'r3' }).items.map((item) => item.id), ['r2']);
  assert.deepEqual(journal.query({ app: 'nous', route: 'chat', q: 'r3' }).items.map((item) => item.id), ['r3']);
  assert.deepEqual(journal.query({ status: '401' }).items.map((item) => item.id), ['r2']);
  assert.equal(all.summary.total, 3);

  const serialized = JSON.stringify(journal.query());
  assert.doesNotMatch(serialized, /never persist|never-persist|provider body|raw secret/i);
  assert.equal(journal.query().items[0].schemaVersion, 1);
});

test('journal recovers valid JSONL records and rotates to one predecessor', () => {
  const directory = temporaryDirectory();
  const filePath = path.join(directory, 'requests.jsonl');
  try {
    fs.writeFileSync(filePath, `${JSON.stringify({ schemaVersion: 1, id: 'old', startedAt: '2026-08-17T00:00:00.000Z', outcome: 'served' })}\nnot-json\n`, { mode: 0o600 });
    const journal = new RequestJournal({ filePath, maxEntries: 5, maxBytes: 420 });
    assert.deepEqual(journal.status(), {
      persistence: 'persistent',
      maxEntries: 5,
      rotateAtBytes: 420,
      predecessors: 1,
    });
    assert.deepEqual(journal.query().items.map((item) => item.id), ['old']);

    for (let index = 0; index < 8; index++) {
      journal.append({
        id: `new-${index}`,
        startedAt: `2026-08-17T00:00:0${index}.000Z`,
        route: '/v1/chat/completions',
        method: 'POST',
        status: 200,
        outcome: 'served',
        result: { outputChars: 30, usage: estimatedUsage(40, 30) },
      });
    }

    assert.equal(fs.existsSync(`${filePath}.1`), true);
    assert.equal(fs.existsSync(`${filePath}.2`), false);
    assert.ok(fs.statSync(filePath).size <= 600, 'active log stays close to the configured rotation ceiling');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
    }

    const reloaded = new RequestJournal({ filePath, maxEntries: 5, maxBytes: 420 });
    assert.ok(reloaded.query().items.length > 0);
    assert.doesNotThrow(() => reloaded.query());
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('SubChain ownership is applied before filtering, search, summary, and pagination', () => {
  const journal = new RequestJournal({ enabled: false });
  journal.append({
    id: 'key-a-record',
    startedAt: '2026-08-17T18:00:00.000Z',
    route: '/v1/chat/completions',
    method: 'POST',
    status: 200,
    outcome: 'served',
    localKeyId: 'key-a',
    localKeyName: 'Private Team Name',
    target: { type: 'chain', id: 'coding' },
    harnessId: 'default',
    transport: 'http',
    client: { reportedApp: 'App A', sessionId: 'a-session' },
    served: { provider: 'openai0', model: 'model-a', keyIndex: 0, transport: 'http' },
    result: { usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5, source: 'exact' } },
    localKeyToken: 'must-never-persist',
    privatePath: 'must-never-persist',
    prompt: 'must-never-persist',
    presetBody: 'must-never-persist',
  });
  journal.append({
    id: 'key-b-record',
    startedAt: '2026-08-17T18:01:00.000Z',
    route: '/v1/chat/completions',
    method: 'POST',
    status: 401,
    outcome: 'auth-rejected',
    localKeyId: 'key-b',
    client: { reportedApp: 'App B', sessionId: 'b-session' },
  });

  const owned = journal.query({ ownerId: 'key-a' });
  assert.deepEqual(owned.items.map((record) => record.id), ['key-a-record']);
  assert.equal(owned.summary.total, 1);
  assert.deepEqual(owned.items[0].target, { type: 'chain', id: 'coding' });
  assert.equal(owned.items[0].harnessId, 'default');
  assert.equal(owned.items[0].transport, 'http');
  assert.equal(journal.query({ ownerId: 'key-a', q: 'b-session' }).summary.total, 0);
  assert.equal(journal.query({ ownerId: 'key-a', target: 'coding', transport: 'http' }).summary.total, 1);
  assert.equal(journal.query({ ownerId: 'key-a', harness: 'default' }).summary.total, 1);
  assert.equal(journal.query({ ownerId: 'key-a', harness: 'research' }).summary.total, 0);
  assert.equal(journal.query({ ownerId: 'key-a', target: 'other' }).summary.total, 0);
  assert.equal(journal.query({ ownerId: 'key-a', transport: 'codex-app-server' }).summary.total, 0);
  assert.equal(journal.query({ ownerId: 'key-a', before: 'key-b-record' }).items.length, 1);
  assert.doesNotMatch(JSON.stringify(owned), /Private Team Name|must-never-persist|b-session/);
});
