# Harness preset imports

SubChain imports third-party prompt collections into private platform
application data. The public repository contains the importer, classifier, and
provenance rules, never the upstream prompt bodies.

## Sources

| Source | Imported paths | Use in SubChain |
|---|---|---|
| CL4R1T4S | approved provider directories with text prompt files | model and provider operating behavior |
| tweakcc | declared prompt JSON | focused prompt components and custom behavior |
| claude-code-system-prompts | declared system-prompt Markdown | system, tool, safety, and behavioral components |
| deepseek-harness | `SKILL.md` agent instruction documents (MIT), localized `.zh.md` copies excluded | tool, operating, and behavioral components |

Run `npm run import-presets` to fetch current revisions. Each private source
directory receives a manifest containing the repository, commit revision,
import time, license copy, file count, and SHA-256 checksums. `index.json`
summarizes the import and `catalog.json` caches classified metadata for fast
dashboard search.

## Classification

The importer and catalogue classify likely prompt functions into:

- identity
- operating instructions
- safety policy
- tool policy
- reasoning policy
- output style
- behavioral mode
- persona
- full Harness or unclassified, when a narrower function is not reliable

Classification is deterministic metadata, not execution. The library shows the
source, suggested component, detected functions, description, and a private
preview. The user chooses the destination and replace or append mode before any
named Harness changes.

## Using presets

1. Open **Harness** and select or create a named Harness.
2. Filter the library by source, component, or search text.
3. Select one entry and review its preview and detected functions.
4. Choose the exact Harness component.
5. Apply in replace or append mode.
6. Assign the named Harness to one or more local keys.

All Harness changes save immediately. Background refresh preserves expanded
sections, and expansion state is stored separately for each Harness.

## Safety rules

- Imported text is inert third-party data. The importer never executes it.
- Only declared paths and text or JSON extensions are copied.
- Symlinks and source code outside declared paths are skipped.
- List and preview routes are loopback-only and restricted to manifest entries.
- Re-importing replaces only the generated private directory for that source.
- Review source licenses and terms before redistributing imported content.
- Never add imported prompt files, private catalogue data, or previews to Git.
