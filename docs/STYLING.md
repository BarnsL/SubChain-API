# Dashboard styling contract

SubChain, [FreeChain](https://github.com/BarnsL/FreeChain-API) and VisionChain
ship three different products behind one dashboard grammar. Someone who learns
one should not have to relearn the others.

This document is the contract. It is written to be identical in all three
repositories except where a rule genuinely differs, and those differences are
called out rather than left to drift.

## The rule

**Same structure everywhere; only the nouns change.**

A page's shape, component classes, button weights and ordering are shared. What
each app puts inside them is its own: FreeChain talks about free-tier providers
and one access key, SubChain about subscriptions and local keys, VisionChain
about image parts and vision routing.

If you find yourself writing new CSS for something that already exists in
another chain app, port the class instead. If a page needs a shape none of them
has, add it here first.

## Tokens

Defined once on `:root` in `app.css`. Never hard-code a colour in markup or
script; a literal hex is how a light-theme regression ships.

| Token | Use |
| --- | --- |
| `--background` / `--foreground` | Page ground and default text |
| `--card` / `--card-hover` | Raised surfaces and their hover state |
| `--muted` / `--muted-foreground` | Quiet fills and secondary text |
| `--border` | Every 1px rule, card edge and divider |
| `--input` | Field interiors |
| `--primary` / `--primary-foreground` / `--primary-soft` | The single accent, its text, and its 12% wash |
| `--success` / `--warning` / `--danger` | Status only, never decoration |
| `--radius` | Card and panel corners (8px is used for controls) |
| `--sidebar` / `--content` | Fixed rail width and the content column cap |

The accent colour is the one thing each app may legitimately differ on, since it
is the brand mark. Everything else stays the same value.

Theme, font family, font scale and density are applied as
`[data-operator-theme]`, `[data-operator-font]`, `[data-operator-density]` and
`--operator-scale` on `<html>` by the Chat page's appearance settings. Any new
component must inherit rather than fix its own font size in pixels where a
relative unit will do.

## Layout

- `.shell` → `.sidebar` (fixed, sticky, full height) + `.main` → `.container`
  (`max-width: var(--content)`, centred, generous bottom padding).
- One `<section class="page" id="page-*">` per page; `goto()` toggles `.active`.
  Pages are never separate documents. A standalone `operator.html` existed once
  in every app and was removed from every app for this reason.
- Navigation order is shared: **Overview, Local keys/Access key, Providers,
  Chain, Harness, Logs, Chat**, then a `.nav-label` group of outbound provider
  links. VisionChain inserts its **Vision test** page after Chain because it has
  no Harness; that is the one sanctioned deviation.

## Components

| Class | What it is | Rules |
| --- | --- | --- |
| `.card` | The default container | 20px padding, 1px border, `--radius`. Stacked cards get `margin-top: 14px` automatically |
| `.stat-grid` / `.stat` | The metric row under a page title | `repeat(auto-fit, minmax(180px, 1fr))`. Label, then value, then a one-line `.stat-sub` explaining what the number counts |
| `.callout` | An inline notice | Icon in the first column, prose in the second. `.warn` for anything the reader must act on |
| `.btn` | Any action | `.btn-primary` for the one committing action in a card, plain `.btn` for peers, `.btn-ghost` for dismissals and filter resets, `.btn-danger` for destructive hover state, `.btn-sm` inside dense rows |
| `.form-row` / `.form-field` / `.form-hint` | Inline forms | Fields grow, the submit button does not. Hints sit under the row, never inside a field |
| `.badge` | State, not action | `.badge-ok` / `.badge-warn` / `.badge-free`. Never clickable |
| `.harness-section` / `.harness-toggle` / `.harness-body` | Collapsible editor sections | Header is a button, chevron rotates when open, expansion state persists per Harness in `localStorage` |
| `.op-panel` / `.op-bubble` / `.op-pending` / `.op-compose` / `.op-fields` | The Chat page | Built from dashboard components; the operator has no private stylesheet |
| `.op-status` | The Chat status line | Reports what just happened. It is empty on load |

### Buttons: weight carries meaning

One `.btn-primary` per card, at most. Two primaries in one card means the card
is doing two jobs and should be two cards.

On the Logs title row, **Pause live** and **Refresh** are both plain `.btn`:
they act on the same live feed and neither is more committing than the other.
**Clear filters** is `.btn-ghost` because it undoes rather than does.

## Page shapes

### Logs

Shared shape, per-service columns:

1. `.log-title-row` — title and lede on the left, `.log-title-actions` on the
   right holding **Pause live** and **Refresh**.
2. A retention warning, hidden by default (see below).
3. `.stat-grid.log-summary` — four tiles.
4. `.log-filters` — a form of `.input` fields plus a ghost **Clear filters**.
5. `.log-toolbar` — live status on the left, the exact/estimated legend on the
   right.
6. The record table, each row expanding into a three-column detail grid.

What differs is the columns and filters, and that is the point:

| | FreeChain | SubChain | VisionChain |
| --- | --- | --- | --- |
| Tiles | Matching records, Tokens observed, Average latency, Cooling involved | Matching records, Tokens observed, Average latency, Cooling involved | Matching records, Successful, Other/failed, Average latency |
| Filters | outcome, provider, app, route, harness, search | outcome, local key, target, harness, transport, provider, app, route, search | outcome, provider, model, route, search |
| Row column | App | Local key | Images |

### The retention warning

All three apps can be configured to retain caller content, and none of them may
claim otherwise.

The callout ships **hidden and empty**. Script fills it from the live log policy
and shows it only when something is actually being retained. A static
"prompts are never stored" sentence is forbidden: it becomes a lie the moment a
host flips a switch, told by the very screen they would check.

### Harness

FreeChain and SubChain only. Eight instruction components in four collapsible
sections, then generation defaults, infrastructure defaults, model aliases and
custom request metadata. Every field carries a one-line `.harness-guide` and an
`i` tooltip with explicit *belongs here* / *not here* notes.

The difference is where the choice of Harness lives: SubChain assigns one per
local key; FreeChain marks one active because it has a single access key. See
[HARNESS.md](HARNESS.md).

## Text containment

Binding across all three repos:
[CARD-TEXT-CONTAINMENT.md](CARD-TEXT-CONTAINMENT.md). In short — text wraps
inside its card, wide content scrolls inside its own container, and the page
body never scrolls sideways.

## Accessibility

- Focus is always visible; the shared `:focus-visible` outline is not to be
  removed for aesthetics.
- Toggles carry `aria-pressed`, collapsibles `aria-expanded`, live regions
  `aria-live` or `role="status"`.
- Motion respects `prefers-reduced-motion`.
- Colour never carries meaning alone: every status colour is paired with a word.

## Changing this contract

A change that affects the shared grammar lands in all three repositories, or it
is not a change to the grammar — it is a fork. Update this file in each repo in
the same change, and say which apps are affected in the commit message.
