# Troubleshooting SubChain

## The dashboard says unreachable

Confirm the launcher is running and that the browser is using the same local
host and port printed by the process. Do not expose the dashboard on a network
interface to work around this.

## A provider says no credential

Check the provider's entry in `docs/provider-access`. Put the credential in an
authorized environment source or a local ignored override. Restart after an
environment change. Do not paste the value into an issue or dashboard note.

## A local key returns 401

Copy the key again from the Access page. Keys are independent: rotating or
deleting one does not change the others. An existing Default key remains valid
through migration unless it is explicitly rotated.

## A model is missing

`/v1/models` lists only models inside the local key's provider or chain scope.
Choose the correct local key, or update that key's destination from the Access
page. This is expected access control, not a model-discovery failure.

## A new chain cannot accept another link

New chains have a five-link limit. Create a separate chain and key if you need a
different routing policy. A migrated Default chain may contain more legacy links
but cannot grow further until it is reduced to the normal limit.

## Harness sections close themselves

Harness expansion preferences are saved in browser local storage. They survive
the background state refresh and reload. If a browser privacy mode clears local
storage, expansion preferences reset with the browser session.

## Preset import fails

Check network access to the three public source repositories, then rerun
`npm run import-presets`. The importer never executes source content. A failed
source leaves other completed source imports intact.
