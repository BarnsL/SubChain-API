# Harnesses

A Harness is a named bundle of instruction components and request defaults.
Each local key is assigned exactly one Harness, so what a client gets is decided
by which key it holds, not by anything the client sends.

Harnesses are edited on the **Harness** page of the dashboard. Changes save
automatically against the active Harness.

## Why components instead of one prompt box

Every component ends up concatenated into the same request, so a single
free-text box would technically work. Splitting it into named parts buys three
things a single box cannot:

- **Independent editing.** Changing how a task is sequenced should not risk
  editing a refusal rule. Separate fields make that impossible by construction.
- **Meaningful presets.** An imported preset can be classified by what it *is*,
  so the library can offer you the right ones for the field you are filling.
- **Reviewable diffs.** "Safety policy changed" is a sentence someone can audit.
  "The prompt changed" is not.

The cost is that you have to know which field a piece of text belongs in. That
is what the guides, tooltips and mismatch warning are for.

## The components

Each field on the page carries a one-line guide, and an **i** button whose
tooltip adds detail plus explicit *belongs here* / *not here* notes. The
tooltip dismisses itself after three seconds.

### Instruction components

| Component | What it answers | Belongs here | Not here |
| --- | --- | --- | --- |
| **Identity** | Who the model is | A role and its domain: "You are a senior Go reviewer for a payments team." | Step-by-step process |
| **Operating instructions** | How it works through a task | Workflow, ordering, verification steps, when to check in | Refusal rules, formatting |
| **Safety policy** | What it must refuse, confirm or escalate | Prohibited actions, required confirmations, escalation paths | Tone and formatting |
| **Tool policy** | When and how tools may be called | Allowed tools, confirmation before side effects, retry and failure handling | How hard to think first |
| **Reasoning policy** | How much to think before answering | Depth rules, self-checks, when to explore alternatives | Output length or formatting |
| **Output style** | How the answer is shaped | Formatting, length targets, structure, code-block conventions | Behavioural rules |
| **Behavioral mode** | The operating mode | Mode definitions: plan before acting, minimal output, review-only | Identity |
| **Persona** | Voice and personality | Tone, register, manner, humour | Capabilities and permissions |

Two distinctions cause most of the confusion:

- **Identity vs Behavioral mode.** Identity is who the model *is* and stays true
  regardless of the task. A mode is what it is *doing right now*. "A senior Go
  reviewer" is identity; "plan before acting" is a mode.
- **Output style vs Persona.** Output style is the shape on the page — headings,
  length, code fences. Persona is the voice. Terse formatting and a warm voice
  are perfectly compatible, which is why they are separate fields.

A rule that reads as a limit belongs in Safety policy even if it is about tools,
because Safety policy is the field you audit when you want to know what the
model will refuse.

### Generation defaults

`Temperature`, `Top P`, `Top K`, `Max tokens` and `Reasoning effort`. Empty
means "use the provider default" — it is not the same as zero. Providers differ
in which of these they honour; `Top K` in particular is accepted by some and
silently ignored by others.

Tune `Temperature` or `Top P`, rarely both. `Max tokens` is a hard ceiling, not
a target, so setting it too low truncates answers mid-sentence.

`Reasoning effort` and the Reasoning policy component work as a pair: the
default buys the budget, the policy spends it.

### Infrastructure defaults

`Stream`, `Service tier` and `Provider user identifier`. These affect delivery
and accounting, never behaviour. A client that explicitly asks for streaming
still wins; the default only applies when the request is silent.

Use an opaque value for the user identifier — never a real name or email.

### Model aliases and custom request metadata

Both are JSON objects.

**Model aliases** rewrite the model name a client asks for before routing, which
is how you retarget a client whose model picker you do not control.

**Custom request metadata** adds HTTP headers to upstream requests. Credential,
cookie, host and connection headers are rejected, so this cannot be used to
smuggle authentication past the credential resolver.

## The imported preset library

Presets are imported with `npm run import-presets` into private app data. They
are **inert text**: SubChain stores and displays them, and never executes them.
Prompt bodies are deliberately never vendored into this repository — see
[PRESETS.md](PRESETS.md).

### Classification is a guess, not a contract

On import, each preset is classified into one component from its metadata:
filename, declared name, description and source. That classification is what
drives the component counts in the library filter.

It is a heuristic over other people's files. It is usually right and sometimes
wrong, which is why nothing in the UI treats it as binding.

### Browsing from a field

Every instruction component has a **Browse presets** action next to its label.
It opens the shared library already filtered to that component and scrolls to
it, so you start from the few hundred presets written for the field you are
filling rather than the full corpus.

You can still clear the filter and browse everything.

### The mismatch warning

When the **Apply to** target differs from the preset's classification, an inline
warning appears above the apply row, the button changes from *Apply preset* to
*Apply anyway*, and confirming asks a second time.

The warning names both components, says what the target field actually expects,
and offers to switch back. It does not block: the classification can be wrong,
and you may genuinely want a mode-shaped preset as your Behavioral mode even
though it was filed under Identity. It exists because a mismatch is far more
often a slip than an intent.

Applying in **Replace** mode over existing content asks for confirmation
separately. A mismatched replace therefore asks twice, which is proportionate to
what it destroys.

## Assigning a Harness

Local keys are assigned on the **Local keys** page. One Harness may serve many
keys; the Harness page shows how many are currently assigned, so you can see the
blast radius before editing.

Deleting a Harness that still has keys assigned is refused.

## Related

- [PRESETS.md](PRESETS.md) — import pipeline, licensing and manifest
- [REQUEST-JOURNAL.md](REQUEST-JOURNAL.md) — Harness ids appear in journal records
- [CONTROL-PLANE-AGENT.md](CONTROL-PLANE-AGENT.md) — the Chat operator reads Harness state but cannot edit prompt components
