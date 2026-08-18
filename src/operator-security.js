// Deterministic security/reliability analysis over sanitized request records.
// It never needs prompt bodies or credentials to identify the most useful
// operational classes of problems.
const attemptStatus = (attempt = {}) => {
  if (Number.isFinite(Number(attempt.providerStatus))) return Number(attempt.providerStatus);
  const match = String(attempt.detail || '').match(/(?:HTTP\s*)?(\d{3})/i);
  return match ? Number(match[1]) : null;
};

export function analyzeSanitizedRecords(records = []) {
  const findings = [];
  const attempts = records.flatMap((record) => Array.isArray(record.attempts) ? record.attempts : []);
  const count = (predicate) => attempts.filter(predicate).length;
  const auth = count(a => [401,403].includes(attemptStatus(a)));
  const rate = count(a => attemptStatus(a) === 429 || /rate|quota/i.test(String(a.outcome || '') + String(a.detail || '')));
  const five = count(a => (attemptStatus(a) || 0) >= 500);
  const timeout = count(a => /timeout/i.test(String(a.outcome || '') + String(a.detail || '')));
  const failed = records.filter(r => Number(r.status) >= 500 || ['failed','error'].includes(r.outcome)).length;
  const publicClients = records.filter(r => r.client?.remoteCategory === 'public' || r.remoteCategory === 'public').length;
  const byProvider = new Map();
  for (const a of attempts) if (a.provider && a.outcome !== 'ok') byProvider.set(a.provider, (byProvider.get(a.provider) || 0) + 1);

  const add = (severity, id, title, evidence, recommendation) => findings.push({ severity, id, title, evidence, recommendation });
  if (publicClients) add('high','public-client','Requests observed from a public network category',`${publicClients} retained record(s) were categorized as public.`, 'Bind the admin/control surface to loopback and put any intentionally remote API surface behind TLS, firewalling, and a strong local access key.');
  if (auth >= 3) add('high','auth-failures','Repeated upstream authentication failures',`${auth} provider attempt(s) returned 401/403.`, 'Re-authorize the affected provider or replace the credential. Do not weaken authentication to work around it.');
  if (rate >= 3) add('medium','rate-pressure','Repeated rate-limit or quota pressure',`${rate} attempt(s) were rate/quota related.`, 'Increase fallback diversity, honor Retry-After/quota windows, or lower concurrency. Avoid retry storms.');
  if (five >= 3) add('medium','provider-5xx','Repeated upstream provider failures',`${five} attempt(s) returned 5xx.`, 'Prefer healthy fallbacks and probe the affected provider before changing credentials.');
  if (timeout >= 3) add('medium','timeouts','Repeated provider timeouts',`${timeout} attempt(s) timed out.`, 'Check provider/network health, then tune timeout only if successful calls normally need longer.');
  if (records.length >= 10 && failed / records.length >= .30) add('high','failure-rate','High end-to-end failure rate',`${failed}/${records.length} retained requests ended in server-side failure.`, 'Run Doctor, inspect the dominant provider/error category, and fix the narrowest cause before changing chain-wide behavior.');
  const [provider, providerFailures] = [...byProvider.entries()].sort((a,b)=>b[1]-a[1])[0] || [];
  if (provider && providerFailures >= 5) add('medium','provider-concentration','Failures concentrated on one provider',`${provider} accounts for ${providerFailures} failed attempt(s).`, 'Probe that provider, verify its model/auth configuration, and consider moving it later in the chain until healthy.');
  if (!findings.length) add('info','no-strong-signal','No strong security/reliability signal in retained logs','The deterministic checks did not cross an alert threshold.', 'Continue normal monitoring; this does not replace host/network security controls.');
  return { generatedAt: new Date().toISOString(), recordsAnalyzed: records.length, attemptsAnalyzed: attempts.length, findings };
}
