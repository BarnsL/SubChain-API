# Style rule: text always fits inside its card

**Status: binding for FreeChain, SubChain and VisionChain.** These three
dashboards share one visual grammar, so they share this rule. It is not a
per-repo preference.

## The rule

Every card owns its text. Long model ids, provider names, request ids, base
URLs, file paths, access keys and raw upstream error strings must **wrap or
scroll inside the card**. They may never:

- widen the card past its grid or flex track,
- spill past the card border,
- get silently clipped with no way to read the rest,
- or give the page a horizontal scrollbar.

A card that only looks correct because today's content happens to be short is
not compliant. The strings these dashboards paint are lengths we do not
control: they come from provider APIs, model catalogs and upstream errors.

## Where it lives

One canonical CSS block at the end of `src/webui/app.css`, opening with:

```css
/* ── Shared contract: text always fits inside its card ─────────────────────
   CANONICAL BLOCK. Byte-identical in FreeChain, SubChain and VisionChain.
```

The block is **byte-identical in all three repos**. Change it in one and copy
it verbatim into the other two, in the same change. Confirm with:

```bash
sha256sum */src/webui/app.css
```

compared over the canonical block only, or simply diff the blocks. Its
container selector list is the *union* of card class names across all three
dashboards, which is what lets it stay copy-paste identical; class names absent
from a given repo just never match.

## Why it is structural rather than per component

Containing overflow per component means every new card re-litigates the same
bug, and the bug is only visible once a provider returns an unusually long
string in production. Three mechanics do the work globally:

1. **`min-width: 0`** is the load-bearing part. Flex and grid children default
   to `min-width: auto`, which refuses to shrink below their content's
   intrinsic width. That default, not the text itself, is the usual reason one
   long model id pushes a card past its track and puts a horizontal scrollbar
   on the whole page. Resetting it lets wrapping do its job.
2. **`overflow-wrap: anywhere`** breaks strings containing no spaces (URLs,
   keys, base64 request ids). It is an inherited property, so setting it on the
   card carries it to every descendant without repeating it per element.
3. **Content that genuinely cannot wrap** (`<pre>`, tables) scrolls inside its
   own box, so the page itself never scrolls sideways.

Every selector is wrapped in `:where()`, so the block carries **zero
specificity**. It is a safety net for markup nobody thought to constrain; any
explicit rule elsewhere in the file — a deliberate `white-space: nowrap` badge,
a real `min-width` on a control — still wins.

Two elements are deliberately excluded from the `min-width: 0` reset:

- **icons and media** (`svg`, `img`, `video`, `canvas`) are pinned with
  `flex-shrink: 0`. They have no text to wrap, so allowing them to shrink
  squashes the icon instead of wrapping the string beside it.
- **`button`** keeps its intrinsic width, so action labels are never squashed.

## Reviewing a change

Check any new or edited card at **1280 px and at 380 px**, with a
deliberately hostile string in it. Paste this in the browser console on the
page you changed; it reports actual geometry rather than an impression:

```js
(() => {
  const sel = '.card,.stat,.callout,.slot,.provider,.source-card,.log-record,.bubble';
  const de = document.documentElement;
  const out = [`viewport=${window.innerWidth} pageOverflow=${de.scrollWidth > de.clientWidth + 1}`];
  let bad = 0;
  document.querySelectorAll(sel).forEach(card => {
    const cb = card.getBoundingClientRect();
    card.querySelectorAll('*').forEach(el => {
      if (el.tagName === 'PRE' || el.tagName === 'TABLE' || el.closest('.table-wrap')) return;
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      if (r.right > cb.right + 1.5) {
        bad++;
        out.push(`SPILL ${el.tagName}.${el.className} +${(r.right - cb.right).toFixed(0)}px`);
      }
    });
  });
  out.push(`cards=${document.querySelectorAll(sel).length} problems=${bad}`);
  return out.join('\n');
})()
```

`problems=0` and `pageOverflow=false` at both widths is the pass condition. To
prove the rule rather than the current content, append a hostile string to a
few cards first, for example a 90-character unbroken model id or request id,
and re-run the check.

## Adding a new card

Add its class name to the container list in the canonical block, in all three
repos, rather than writing per-card overflow rules. A new card should be
correct before anyone tests it.
