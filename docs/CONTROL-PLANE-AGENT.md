# Agent Operating Contract

This contract is intentionally procedural so a relatively weak model can operate the apps without being trusted as a security boundary.

## Output protocol

The operator model must return exactly one JSON object:

```json
{
  "message": "Human-readable explanation",
  "actions": [
    {
      "tool": "allowlisted_tool_name",
      "args": {},
      "reason": "Why this is the smallest appropriate change",
      "description": "Exactly what the human will see before confirming"
    }
  ],
  "links": [
    { "label": "Official setup", "url": "an allowlisted URL from current context" }
  ]
}
```

Unparsed prose cannot execute a tool. Unknown tool names are discarded. A proposal does not mutate state.

## Mandatory reasoning procedure

1. Read the sanitized current state supplied by the server.
2. Inspect Doctor findings.
3. Inspect deterministic security findings.
4. Inspect recent sanitized logs if relevant.
5. Classify the problem before proposing a change:
   - 400/422: request/model incompatibility;
   - 401/403: authentication/permission;
   - 404: bad endpoint/model;
   - 408/timeout/network: connectivity/latency;
   - 429/quota: rate or quota pressure;
   - 5xx: upstream/provider failure.
6. Prefer advice requiring no mutation.
7. If a mutation is actually needed, propose one minimal action.
8. State that confirmation is required.
9. Never claim the action happened until the server returns the confirmed result.
10. Re-read state after a confirmed action before proposing a second mutation.

## Secret handling

Never ask the user to paste an API key, OAuth token, cookie, JWT, authorization header, or credential file content into chat. Provider-key inputs in the UI post directly to the local server. Credential discovery returns only source categories and presence. A confirmed import rereads the credential server-side.

For subscription auth, prefer the provider-owned managed client. Do not extract OAuth tokens from browser profiles, OS credential stores, Claude Code, Codex, Dario, or Antigravity and then replay them through chat.

## Mutation boundary

Never propose changes that disable or weaken:
- access-key/local-key authentication;
- loopback-only admin/operator routes;
- same-origin mutation checks;
- secret redaction;
- log/request size limits;
- confirmation requirements;
- CSP or other browser security headers;
- credential-store separation.

Never request arbitrary shell execution, arbitrary file writes, package installation, broad repository rewrites, firewall changes, or credential export.

## Minor repair

A minor repair is last resort. It is one exact search/replace within an allowlisted file, limited in size. The server creates a backup, runs `node --check` where applicable and the full `npm test`; a failure restores the original automatically.

In SubChain the allowlist covers presentation files only:

```text
src/webui/app.css
src/webui/app.js
src/webui/index.html
src/webui/operator.css
src/webui/operator.js
```

The operator's own executor is deliberately excluded, so a confirmed repair can never widen the action allowlist or edit the confirmation gate. Text matching authorization, credential, token, OAuth, process-spawning, `eval`, CSP or loopback-check patterns is rejected on both the search and the replacement side.
