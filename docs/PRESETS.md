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

## Using presets in the Harness

Open **Harness** and use **Imported preset library** to filter the private
catalogue by source or search by title, description, or file name. Select one
entry to preview it, then apply it to **Operating Instructions** or **Persona**
in replace or append mode. Application saves immediately and inserts the
selected text as a system message before provider-specific request transforms.

The list and preview endpoints are loopback-only. They read only files declared
by an import manifest, so a browser selection cannot access arbitrary local
files.

## Safety rules

- Imported text is inert preset data. The importer does not execute it.
- Only the declared paths and file extensions are copied. Symlinks and source
  code outside those paths are skipped.
- Re-importing replaces only that source's generated private directory.
- Review a source's licence and terms before redistributing its content.
- Do not add imported prompt files to Git. They are user-selected third-party
  data, not SubChain source.
