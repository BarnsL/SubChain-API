# Preset imports

SubChain imports third-party prompt collections into private local application
data. The public repository contains the importer and provenance rules, never
the upstream prompt bodies.

## Sources

| Source | Imported paths | Notes |
|---|---|---|
| CL4R1T4S | approved provider directories, Markdown and text prompt files | Source licence is copied into its private import directory. |
| tweakcc | `data/prompts/*.json` | Source licence is copied into its private import directory. |
| claude-code-system-prompts | `system-prompts/*.md` | Source licence is copied into its private import directory. |

Run `npm run import-presets` to fetch current revisions. Each source directory
gets a `manifest.json` with the upstream repository, commit revision, import
time, file count, and SHA-256 for every imported file. `index.json` summarizes
the import.

## Safety rules

- Imported text is inert preset data. The importer does not execute it.
- Only the declared paths and file extensions are copied. Symlinks and source
  code outside those paths are skipped.
- Re-importing replaces only that source's generated private directory.
- Review a source's licence and terms before redistributing its content.
- Do not add imported prompt files to Git. They are user-selected third-party
  data, not SubChain source.
