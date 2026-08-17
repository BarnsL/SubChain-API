const SNAPSHOT_KEYS = ['status', 'verificationUrl', 'userCode', 'expiresAt', 'message'];
const RETRYABLE_LOGIN_STATUSES = new Set(['failed', 'cancelled', 'expired']);
const ACTIVE_WORKFLOW_STATUSES = new Set(['pending', 'refreshing', 'connected', 'refresh-error']);

function snapshotFor(value) {
  const snapshot = { status: String(value?.status || 'failed') };
  for (const key of SNAPSHOT_KEYS.slice(1)) {
    if (value?.[key] !== undefined) snapshot[key] = value[key];
  }
  return snapshot;
}

function sameSnapshot(first, second) {
  return SNAPSHOT_KEYS.every((key) => first?.[key] === second?.[key]);
}

export function shouldShowSubscriptionLogin(provider, state) {
  return provider?.id === 'openai-codex' && Boolean(
    provider.canConnectSubscription || ACTIVE_WORKFLOW_STATUSES.has(state?.snapshot?.status),
  );
}

export function shouldPreserveSubscriptionCard(providerId, state) {
  return providerId === 'openai-codex' && state?.snapshot?.status === 'pending';
}

export function subscriptionFocusTarget(previous, state) {
  const status = state?.snapshot?.status;
  if (!status && state?.busy) return 'starting';
  if (status === 'pending') return !state.busy && previous === 'cancel' ? 'cancel' : 'code';
  if (status === 'refreshing' || status === 'connected') return 'panel';
  if (status === 'refresh-error') return 'retry-ping';
  if (RETRYABLE_LOGIN_STATUSES.has(status)) return 'connect';
  return previous;
}

/** Keep one provider-card login lifecycle current without repainting unchanged pending instructions. */
export function createSubscriptionLoginState({
  start,
  status,
  cancel,
  ping,
  schedule = setTimeout,
  clear = clearTimeout,
  pollMs = 2_500,
  onChange = () => {},
  onConnected = async () => {},
  onCancelled = () => {},
} = {}) {
  let snapshot = null;
  let busy = false;
  let timer = null;
  let requestId = 0;

  const current = () => ({ snapshot: snapshot && { ...snapshot }, busy });
  const publish = () => onChange(current());
  const setState = (nextSnapshot = snapshot, nextBusy = busy) => {
    const changed = !sameSnapshot(snapshot, nextSnapshot) || busy !== nextBusy;
    snapshot = nextSnapshot;
    busy = nextBusy;
    if (changed) publish();
  };
  const clearPolling = () => {
    if (timer) clear(timer);
    timer = null;
  };
  const nextRequest = () => {
    clearPolling();
    requestId += 1;
    return requestId;
  };

  const refreshProvider = async (id) => {
    if (id !== requestId) return current();
    try {
      await ping();
      if (id !== requestId) return current();
      setState({ status: 'connected' }, false);
      try { await onConnected(); } catch {}
    } catch {
      if (id === requestId) setState({ status: 'refresh-error' }, false);
    }
    return current();
  };

  const scheduleStatus = (id) => {
    clearPolling();
    timer = schedule(() => poll(id), pollMs);
  };

  const accept = async (value, id) => {
    if (id !== requestId) return current();
    const next = snapshotFor(value);
    if (next.status === 'pending') {
      setState(next, false);
      scheduleStatus(id);
      return current();
    }
    clearPolling();
    if (next.status === 'ready') {
      setState({ status: 'refreshing' }, true);
      return refreshProvider(id);
    }
    setState(next, false);
    return current();
  };

  const poll = async (id) => {
    if (id !== requestId) return current();
    timer = null;
    try {
      return await accept(await status(), id);
    } catch {
      if (id === requestId) {
        clearPolling();
        setState({ status: 'failed' }, false);
      }
      return current();
    }
  };

  const begin = async () => {
    if (busy || (snapshot && !RETRYABLE_LOGIN_STATUSES.has(snapshot.status))) return current();
    const id = nextRequest();
    setState(null, true);
    try {
      return await accept(await start(), id);
    } catch {
      if (id === requestId) setState({ status: 'failed' }, false);
      return current();
    }
  };

  const cancelLogin = async () => {
    if (busy || snapshot?.status !== 'pending') return current();
    const id = nextRequest();
    setState(snapshot, true);
    try {
      const result = snapshotFor(await cancel());
      if (id !== requestId) return current();
      if (result.status === 'cancelled') {
        setState(result, false);
        onCancelled();
        return current();
      }
      return accept(result, id);
    } catch {
      if (id === requestId) setState({ status: 'failed' }, false);
      return current();
    }
  };

  const retryPing = async () => {
    if (busy || snapshot?.status !== 'refresh-error') return current();
    const id = nextRequest();
    setState({ status: 'refreshing' }, true);
    return refreshProvider(id);
  };

  const clearCompleted = () => {
    if (snapshot?.status !== 'connected') return current();
    nextRequest();
    setState(null, false);
    return current();
  };

  return { current, start: begin, poll, cancel: cancelLogin, retryPing, clearCompleted };
}
