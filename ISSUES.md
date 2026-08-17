# SubChain issue tracker

This source-adjacent tracker follows the same operating format as FreeChain.
It records testable outcomes without copying credentials, account identities,
private routing choices, imported prompt bodies, or machine-specific paths.

## Status legend

| Status | Meaning |
|---|---|
| `OPEN` | Not started |
| `IN_PROGRESS` | Being implemented or verified |
| `DONE` | Implemented and verified |
| `WONTFIX` | Deliberately declined, with a documented reason |

## Priority legend

| Priority | Meaning |
|---|---|
| `P0` | Critical security or data-loss risk |
| `P1` | Major product, routing, or reliability gap |
| `P2` | Meaningful usability or operations improvement |
| `P3` | Minor convenience or cosmetic refinement |

## Open issues

No open release-blocking issues are recorded for this revision.

## Closed issues

### SUB-013: Complete the exact public-release audit

- **Status**: DONE
- **Priority**: P0
- **Type**: Security
- **Description**: The public commit must contain no credentials, local keys,
  private state, account identity, imported preset bodies, personal paths, or
  unintended contributor identity.
- **Resolution**: Full tests, the public audit, syntax and diff checks, browser
  inspection, sensitive-data scans, and the contributor-name check passed. The
  release audit also checks untracked publishable files so a new document cannot
  bypass the scan before staging.

### SUB-001: Align provider status cards

- **Status**: DONE
- **Priority**: P2
- **Type**: UI
- **Description**: Long states such as `no credential` overflowed and provider
  status bubbles moved between cards.
- **Resolution**: Provider cards use a larger layout and a fixed trailing
  status column. Wide browser inspection confirmed the long badge fits and all
  badges share the same card position.

### SUB-002: Preserve expanded Harness sections

- **Status**: DONE
- **Priority**: P1
- **Type**: Bug
- **Description**: Background state refreshes collapsed sections the user had
  deliberately opened.
- **Resolution**: Expansion state is stored by named Harness and section.
  Browser verification confirmed all eight sections remain open through a
  background refresh and a page reload.

### SUB-003: Add manual subscription Ping

- **Status**: DONE
- **Priority**: P1
- **Type**: Feature
- **Description**: Each provider account needed an explicit, user-triggered
  refresh of account health, models, quota, and usage.
- **Resolution**: Every account card has a **Ping** action backed by one bounded
  loopback admin request. Codex Ping was exercised in the dashboard and updated
  its health, current models, two quota windows, plan, and last-Ping time.

### SUB-004: Name accounts and report usage

- **Status**: DONE
- **Priority**: P1
- **Type**: Feature
- **Description**: Provider families did not identify individual local
  subscriptions or distinguish provider quotas from local observations.
- **Resolution**: Account labels are locally editable. Cards show plan, health,
  last Ping, provider-reported quota buckets, and separately accumulated local
  request and token totals.

### SUB-005: Keep model catalogs current

- **Status**: DONE
- **Priority**: P1
- **Type**: Reliability
- **Description**: Static model menus had become stale and incomplete.
- **Resolution**: A Ping replaces fallback entries with the account's live
  model listing. Dynamic Chain menus read the same catalog. Conservative
  fallbacks cover unprobed accounts without asserting unsupported limits.

### SUB-006: Use the ChatGPT-backed Codex subscription safely

- **Status**: DONE
- **Priority**: P0
- **Type**: Security
- **Description**: SubChain needed a supported third-party integration without
  exporting a consumer OAuth token or relying on an undocumented web endpoint.
- **Resolution**: The managed provider uses the documented Codex app-server
  JSONL protocol. The Codex client owns sign-in and token refresh. Live account,
  model, rate-limit, usage, and completion checks passed in a read-only private
  workspace, and the transient thread is deleted after completion.

### SUB-007: Separate Antigravity quota families

- **Status**: DONE
- **Priority**: P1
- **Type**: Feature
- **Description**: Google models and the Claude/GPT models exposed by the local
  subscription do not draw from the same quota family.
- **Resolution**: Live discovery returned 14 models and the UI groups them into
  Google and Claude/GPT quota families. Provider authentication and exhaustion
  remain sanitized account-level errors; the currently installed account could
  not complete a live generation because its provider quota or authentication
  was unavailable.

### SUB-008: Compose named Harnesses

- **Status**: DONE
- **Priority**: P1
- **Type**: Feature
- **Description**: One global Harness could not express per-application prompt,
  policy, generation, and infrastructure combinations.
- **Resolution**: Named Harnesses support eight independently editable text
  components, generation settings, aliases, and allowlisted request metadata.
  Users can create, rename, edit, and delete unassigned Harnesses.

### SUB-009: Classify and apply imported Harness presets

- **Status**: DONE
- **Priority**: P1
- **Type**: Feature
- **Description**: Imported prompt collections were present but unavailable as
  useful Harness building blocks.
- **Resolution**: All three declared collections remain private and inert,
  classify into explicit functional components, and support source, component,
  and text filters with preview and apply actions. Browser verification loaded
  70,165 indexed entries without committing their bodies.

### SUB-010: Simplify Overview statistics

- **Status**: DONE
- **Priority**: P2
- **Type**: UI
- **Description**: The Candidates statistic did not communicate a useful user
  outcome.
- **Resolution**: The card was removed. Overview now reports endpoint, chain
  links, ready provider accounts, and served requests.

### SUB-011: Make credential guidance portable

- **Status**: DONE
- **Priority**: P0
- **Type**: Documentation
- **Description**: Existing copy referenced one person's secret directory and
  operating system.
- **Resolution**: The fixed path and unconditional platform reference were
  removed. Provider guides now describe portable source categories, supported
  managed clients, environment overrides, validation, and sanitized failure
  handling.

### SUB-012: Map deployment and source ownership

- **Status**: DONE
- **Priority**: P2
- **Type**: Documentation
- **Description**: Future agents needed an exact map from runtime behavior to
  the source and tests that own it.
- **Resolution**: `DEPLOYMENT.md` defines the stable client contract, private
  state boundary, request flow, source ownership table, operations, and release
  checklist. A separate troubleshooting guide covers sanitized recovery.

### SUB-014: Verify the real dashboard workflow

- **Status**: DONE
- **Priority**: P1
- **Type**: Verification
- **Description**: Unit tests alone could not prove that account cards, dynamic
  models, named Harnesses, presets, and expansion state work in the browser.
- **Resolution**: Browser QA covered account Ping, provider cards, live model
  menus, the 70,165-entry preset catalog, named Harness creation and autosave,
  per-key assignment, background refresh, and reload persistence.

### SUB-015: Block cross-site admin mutations

- **Status**: DONE
- **Priority**: P0
- **Type**: Security
- **Description**: A malicious web page could attempt a blind request against a
  loopback admin route if the server accepted a simple content type.
- **Resolution**: State-changing admin requests reject cross-site Fetch Metadata
  and POST bodies that are not `application/json`. Loopback and scoped API
  boundaries remain independently enforced by regression tests.

## How to file an issue

Add the next sequential `SUB-NNN` heading. Include status, priority, type,
description, and testable acceptance criteria. Move a verified item to Closed
Issues and replace Acceptance with a concise Resolution. General operating
failures and recovery steps belong in
[`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).
