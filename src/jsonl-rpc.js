// Minimal newline-delimited JSON RPC client for supported local provider runtimes.

import { spawn } from 'node:child_process';
import readline from 'node:readline';

function timeoutError(method) {
  return Object.assign(new Error(`${method} timed out`), { code: 'ETIMEDOUT' });
}

export class JsonlRpcClient {
  constructor(child, { timeoutMs = 30_000 } = {}) {
    this.child = child;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closeListeners = new Set();
    this.closed = false;
    this.closeError = null;
    this.stderr = '';

    child.stderr?.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-2_000);
    });
    readline.createInterface({ input: child.stdout }).on('line', (line) => this.#receive(line));
    child.once('error', (error) => this.#failAll(error));
    child.once('exit', (code) => this.#failAll(new Error(`managed provider process exited (${code ?? 'unknown'})`)));
  }

  #send(message) {
    if (this.closed || !this.child.stdin?.writable) throw new Error('managed provider connection is closed');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #receive(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && !message.method && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(String(message.error.message || 'Managed provider request failed')));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) {
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
      if (message.id !== undefined) {
        this.#send({ id: message.id, error: { code: -32601, message: 'SubChain does not expose client tools' } });
      }
    }
  }

  #failAll(error, closeError = error) {
    if (this.closed) return;
    this.closed = true;
    this.closeError = closeError;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    const listeners = [...this.closeListeners];
    this.closeListeners.clear();
    for (const listener of listeners) listener(closeError);
  }

  request(method, params, timeoutMs = this.timeoutMs) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(timeoutError(method));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.#send(params === undefined ? { method, id } : { method, id, params }); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params = {}) {
    this.#send({ method, params });
  }

  subscribe(method, listener) {
    const listeners = this.listeners.get(method) || new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  onClose(listener) {
    if (this.closed) {
      listener(this.closeError);
      return () => {};
    }
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  waitFor(method, predicate = () => true, timeoutMs = this.timeoutMs) {
    return new Promise((resolve, reject) => {
      const unsubscribe = this.subscribe(method, (params) => {
        if (!predicate(params)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(params);
      });
      const timer = setTimeout(() => {
        unsubscribe();
        reject(timeoutError(method));
      }, timeoutMs);
    });
  }

  async initialize(clientInfo, capabilities) {
    await this.request('initialize', { clientInfo, ...(capabilities ? { capabilities } : {}) });
    this.notify('initialized');
  }

  close() {
    if (this.closed) return;
    this.#failAll(new Error('managed provider connection closed'), null);
    this.child.stdin?.end();
    this.child.kill?.();
  }
}

export function spawnJsonlRpc({
  command,
  args = [],
  cwd,
  env = process.env,
  spawnImpl = spawn,
  timeoutMs,
} = {}) {
  if (!command) throw new Error('Managed provider command is required');
  const child = spawnImpl(command, args, {
    cwd,
    env,
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return new JsonlRpcClient(child, { timeoutMs });
}
