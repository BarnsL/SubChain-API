import net from 'node:net';

const MAX_RESTART_DELAY_MS = 30_000;
const STABLE_WORKER_MS = 60_000;

/** Select unprobed providers whose credential or managed runtime can answer. */
export function providersForStartupProbe(providers, managedProviderAvailable = () => false) {
  return providers.filter((provider) => !provider.lastPingAt && (
    provider.hasCredential
    || (provider.transport !== 'http' && managedProviderAvailable(provider.id))
  ));
}

/** Return the bounded delay before the next unexpected worker restart. */
export function restartDelayMs(failures) {
  return Math.min(1_000 * 2 ** Math.max(0, failures - 1), MAX_RESTART_DELAY_MS);
}

/**
 * Supervise one child worker. Dependencies are injectable so restart behavior
 * is unit-testable without creating child processes or waiting on real timers.
 */
export function superviseWorker({
  spawnWorker,
  log = console.log,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
  stableWorkerMs = STABLE_WORKER_MS,
}) {
  let worker = null;
  let restartTimer = null;
  let stopping = false;
  let failures = 0;
  let workerStartedAt = 0;

  const start = () => {
    if (stopping || worker) return;
    workerStartedAt = now();
    worker = spawnWorker();
    worker.once('exit', (code, signal) => {
      const exitedWorker = worker;
      worker = null;
      if (stopping || !exitedWorker) return;

      const stable = now() - workerStartedAt >= stableWorkerMs;
      failures = stable ? 1 : failures + 1;
      const delay = restartDelayMs(failures);
      const reason = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
      log(`[supervisor] worker exited (${reason}); restarting in ${delay / 1_000}s`);
      restartTimer = schedule(() => {
        restartTimer = null;
        start();
      }, delay);
    });
  };

  return {
    start,
    stop() {
      stopping = true;
      if (restartTimer) {
        cancel(restartTimer);
        restartTimer = null;
      }
      if (worker) worker.kill('SIGTERM');
    },
  };
}

/** Dispose worker-owned resources before ending the HTTP process. */
export function installWorkerShutdown({ processTarget = process, server, managedTransports }) {
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    managedTransports.dispose();
    server.close(() => processTarget.exit(0));
  };
  processTarget.once('SIGINT', shutdown);
  processTarget.once('SIGTERM', shutdown);
  return shutdown;
}

/** Check whether the selected local endpoint already has a listener. */
export function isPortListening({ host, port, timeoutMs = 500 }) {
  const probeHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  return new Promise((resolve) => {
    const socket = net.connect({ host: probeHost, port });
    let settled = false;
    const finish = (listening) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}
