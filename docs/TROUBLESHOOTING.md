# Troubleshooting SubChain

## Dashboard unreachable

Confirm the launcher is running and use the exact local host and port it prints.
Do not expose the dashboard on a network interface as a workaround.

## Provider reports no credential

Read the provider's guide in `docs/provider-access`. Use an authorized
environment source, ignored override, approved private directory, provider
application, or platform store. Restart after changing the service environment.
Never paste the credential into a dashboard note or issue.

Managed Codex does not use a copied credential. Sign in through Codex, then use
the provider card's **Ping** action. Managed Antigravity likewise relies on its
own installed client's sign-in state.

## ChatGPT subscription connection needs attention

On the OpenAI Codex Providers card, choose **Connect ChatGPT subscription**.
Open only the official verification URL displayed by the card and enter the
one-time code there. Do not paste that code into a shell, issue, chat, or any
other site. Codex owns the sign-in, storage, and token refresh.

- **Pending**: Complete the official verification flow, or use **Cancel**.
- **Expired**, **failed**, or **cancelled**: Start a new connection to receive a
  new one-time code.
- **Refresh error**: The ChatGPT login succeeded but Ping could not refresh
  provider data. Use **Retry Ping**. Do not reconnect unless the card later
  reports a missing login.

If connection cannot start, confirm the official Codex client is installed and
can sign in, then retry. A ChatGPT subscription is not an OpenAI API key. Use
the separate OpenAI API card and its authorized API-key source for API Platform
billing.

## Local key returns 401

Copy the intended key again from Local keys. Keys are independent: rotating or
deleting one does not change the others. Assigning a destination or Harness
does not rotate the key.

Use the dashboard **Logs** page to correlate the 401 by request ID, app label,
session label, and timestamp. An invalid key is rejected before body parsing,
so its journal record contains `unavailable-before-auth`, no input summary, and
no local-key owner. It appears only in the loopback admin view, not in any
key-scoped `GET /v1/logs` response.

## Request journal is empty or incomplete

Confirm the launcher did not use `--no-log`. That flag intentionally keeps only
the current process's bounded in-memory records. The default persistent journal
lives in private SubChain app data, not in the repository. A custom `--log`
path must be writable by the SubChain process.

Token totals are marked `exact` when the provider supplies usage and
`estimated` otherwise. A missing provider attempt or output summary can be
normal for authentication and request-validation failures because SubChain
records the failure at the earliest safe point. Streaming requests are counted
incrementally and finalized when the stream closes.

If the JSONL file ends with a torn or malformed line after a crash, SubChain
skips that line and loads the remaining valid records. Rotation retains the
active file plus one `.1` predecessor. Persistence failure does not stop
routing; inspect the launcher console for the local filesystem error.

The log APIs intentionally return no prompt text, assistant text, credentials,
authorization headers, raw provider bodies, or full IP addresses. Put only
non-sensitive correlation labels in `X-SubChain-App` and
`X-SubChain-Session-Id`.

## Model is missing

Use **Ping** on the provider card to refresh its live model list. `/v1/models`
still lists only models inside the authenticated local key's selected provider
or chain. This scope is an access-control boundary.

## Quota is missing

Not every provider exposes a quota endpoint. A missing quota means unknown, not
unlimited. Locally observed request and token totals continue to accumulate as
SubChain routes successful requests.

## Chain cannot accept another subscription

New chains have a five-subscription limit. Create another chain and local key
for a different routing policy. A migrated Default chain may retain additional
legacy links but cannot grow until it is within the normal limit.

## Harness section closes or content seems stale

Expansion preferences live in browser local storage per named Harness and are
preserved through background refresh. A privacy mode that clears local storage
will reset those preferences. Confirm the selected Harness before editing.

## Preset import fails

Confirm network access to the three declared public repositories, then rerun
`npm run import-presets`. A failed source does not execute content and does not
invalidate other completed imports.
