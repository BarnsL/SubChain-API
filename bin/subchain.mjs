#!/usr/bin/env node
import { fork, spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadChain, loadDotEnv, chainStatus, ROOT } from '../src/config.js';
import { createServer } from '../src/server.js';
import { installWorkerShutdown, isPortListening, superviseWorker } from '../src/supervisor.js';
import { QuotaTracker } from '../src/quota.js';
import { IS_SEA } from '../src/runtime.js';
import { createSecretStore } from '../src/storage.js';
import { createRoutingRuntime, ensureLocalKey, loadRouting } from '../src/routing.js';
import { createProviderStatusStore } from '../src/provider-status.js';
import { createProviderProbeService } from '../src/provider-probes.js';
import { routingInventory } from '../src/admin.js';
import { createManagedTransports } from '../src/managed-transports.js';
import { providerDef } from '../src/providers.js';

const argv = IS_SEA ? process.argv.slice(1) : process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(name);
const isWorker = has('--worker');

if (has('--help') || has('-h')) {
  console.log(`subchain — subscription-provider failover router

  subchain [--port 4854] [--host 127.0.0.1] [--chain <file>] [--verbose]
           [--allow-network]
  subchain --status        show which links have credentials, then exit

Point any OpenAI-compatible client at http://<host>:<port>/v1 and use the
model id "auto" to let the chain pick.`);
  process.exit(0);
}

loadDotEnv();

const chainFile = path.resolve(flag('--chain', path.join(ROOT, 'chain.config.json')));
const routingFile = path.resolve(flag('--routing', path.join(ROOT, 'routing.config.json')));
if (!fs.existsSync(chainFile) && !argv.includes('--chain')) {
  const starter = path.join(ROOT, 'chain.config.example.json');
  if (fs.existsSync(starter)) fs.copyFileSync(starter, chainFile);
}
let chain;
try { chain = loadChain(chainFile); } catch (err) {
  console.error(`subchain: ${err.message}`);
  process.exit(1);
}

const status = chainStatus(chain);
const configured = status.filter((l) => l.hasKey);

if (has('--status')) {
  for (const l of status) {
    const creds = l.keyCount
      ? `${l.keyCount} key${l.keyCount > 1 ? 's' : ''} / ${l.accountCount} slot${l.accountCount > 1 ? 's' : ''}`
      : l.hasKey ? 'no key needed' : '—';
    console.log(`${l.hasKey ? 'ok  ' : '--  '} ${l.provider.padEnd(14)} ${creds.padEnd(18)} ${l.model}`);
  }
  console.log(`\n${configured.length}/${status.length} links configured.`);
  process.exit(configured.length ? 0 : 1);
}

const port = Number(flag('--port', process.env.SUBCHAIN_PORT || 4854));
const host = flag('--host', process.env.SUBCHAIN_HOST || '127.0.0.1');
const ui = !has('--no-ui');
const loopbackHost = new Set(['127.0.0.1', '::1', 'localhost']).has(host.toLowerCase());
if (!loopbackHost && !has('--allow-network')) {
  console.error('subchain: refusing a network host without --allow-network');
  process.exit(1);
}

async function startSupervisor() {
  if (await isPortListening({ host, port })) {
    console.log(`subchain already running at http://${host}:${port}/v1`);
  } else {
    const supervisor = superviseWorker({
      spawnWorker: () => (IS_SEA
        ? spawn(process.execPath, [...argv, '--worker'], { cwd: process.cwd(), env: process.env, stdio: 'inherit' })
        : fork(fileURLToPath(import.meta.url), [...argv, '--worker'], { cwd: process.cwd(), env: process.env })),
    });
    process.once('SIGINT', () => { console.log('[supervisor] SIGINT'); supervisor.stop(); });
    process.once('SIGTERM', () => { console.log('[supervisor] SIGTERM'); supervisor.stop(); });
    supervisor.start();
  }
}

function startWorker() {
  const secretStore = createSecretStore();
  const routing = loadRouting({
    routingFile,
    legacyFile: chainFile,
    legacyAccessKey: process.env.SUBCHAIN_ACCESS_KEY || null,
    secretStore,
  });
  const runtime = createRoutingRuntime({ routing, secretStore, settings: chain.settings, routingFile });
  const accessKey = ensureLocalKey(runtime);
  const quota = new QuotaTracker();
  const providerStatusStore = createProviderStatusStore();
  const managedTransports = createManagedTransports();
  const providerProbeService = createProviderProbeService({
    statusStore: providerStatusStore,
    managedProbes: managedTransports.probes,
  });

  const server = createServer(runtime, quota, {
    verbose: has('--verbose'),
    ui,
    providerStatusStore,
    providerProbeService,
    managedTransports,
    managedProviderAvailable: (providerId) => managedTransports.has(providerDef(providerId).transport),
  });
  installWorkerShutdown({ server, managedTransports });
  server.listen(port, host, () => {
    console.log(`subchain     http://${host}:${port}/v1`);
    if (ui) console.log(`dashboard    http://${host}:${port}/`);
    console.log(`chain        ${configured.length}/${status.length} links configured (${chainFile})`);
    console.log(`mode         ${runtime.settings.mode}${runtime.settings.mode === 'pinned' ? ` → ${runtime.settings.pinnedProvider}` : ''}`);

    if (!configured.length) {
      console.log('\nNo provider credentials found. Configure a provider or set an environment override.');
      if (ui) console.log(`Add credentials at http://${host}:${port}/`);
    } else if (accessKey) {
      console.log(ui ? 'access key   set (reveal it in the dashboard)' : 'access key   set');
    }

    setImmediate(() => {
      const accounts = routingInventory(runtime, quota, {
        statusStore: providerStatusStore,
        managedProviderAvailable: (providerId) => managedTransports.has(providerDef(providerId).transport),
      }).providers;
      for (const account of accounts.filter((candidate) => candidate.hasCredential && !candidate.lastPingAt)) {
        providerProbeService.ping(account.id).catch(() => {});
      }
    });
  });
}

if (isWorker) startWorker();
else startSupervisor().catch((err) => { console.error(`subchain: ${err.message}`); process.exit(1); });
