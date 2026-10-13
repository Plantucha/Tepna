<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** DONE — 2026-10-12 · **Created:** 2026-10-07 · **Owner:** unassigned · **Relates:** `dex-export.js` `scrubExport`, `ganglior.node-export` contract, SELF-INGEST-FOLLOWUPS-II §F1, #3344

# Export scrub: from deny-list to allow-list

## 0 · The contract

`ganglior.node-export`: a scrubbed export contains no device identifiers — no serial, no filename, no input hash that names the upload. The scrub is the trust boundary between a node's working data and what leaves the machine.

## 1 · What the code does today

`scrubExport` (`dex-export.js:180-240`) is a **key-driven deny-list**:

- `_SCRUB_FILE_KEYS = ['file', 'fname', 'filename', 'fileName', 'sourceFile']` — deleted per element
- `recording.{device,serial,model}` — deleted
- `source` — deleted only when filename-shaped (path separator or dotted extension)
- `provenance.inputs[]` — reduced to `{ bytes }` only
- Per-element `provenance` — reduced to build stamp + generated + scrubbed flag

Every fix in this file's history **adds a key**. SELF-INGEST-FOLLOWUPS-II §F1 widened the element loop from `nights[]` to `recordings[]`/`sessions[]` after a leak. #3344 found per-element `inputs[].sha256` surviving. The 07-xx scrub handled `schema.provenance` + `recording.{device,serial,model}` and missed the per-element copy — measured: `Jane_Smith_O2Ring S 2100_20260612230016.csv` survived scrub ON.

## 2 · The defect shape

A deny-list is **fail-open**: the next new identifier key — a field added by a node author who never read this file — leaks silently. The scrub's correctness depends on every future field author knowing it exists. That is the same shape as the absence bugs the §∅ work just drained: a default that reads as safe until a new case proves it isn't.

## 3 · The proposal

Invert the scrub: define the **allow-list** of fields that survive, drop everything else.

- `scrubExport` builds the output from a declared schema of surviving keys per block (envelope, element, provenance, recording), instead of deleting known-bad keys from a cloned envelope.
- A new field added by a node is **absent from scrubbed exports by default** — the safe direction. If the field is needed downstream, its author adds it to the allow-list explicitly, which is a reviewable decision.
- The filename-shape heuristic (`_FILE_SHAPE_RE`) goes away: under an allow-list, `source` survives only if declared, and a semantic tag vs. a filename is the declarer's decision, not a regex's.

## 4 · What does not change

- The scrubbed/unscrubbed toggle and the `scrubbed: true` marker.
- The deep-clone-before-scrub (never mutate the caller).
- `buildHash`/`generated` coarse stamps (integrity, not identity).

## 5 · Migration

This is a contract change, not a bugfix — it needs the owner's ruling before code changes (per the 2026-10-05 directive: brief allowed, code not). Migration path once ruled:

1. Enumerate every field a scrubbed export's consumers actually read (schema + per-node).
2. Declare the allow-list; add a test asserting the scrubbed output's key set **equals** the allow-list (not "contains no known-bad keys" — the current test shape, which is the deny-list thinking).
3. Land behind the existing scrub flag; verify against the corpus fixtures.

## 6 · Open questions for the owner

- Is there any consumer of scrubbed exports that reads a field not on the obvious allow-list (metrics beyond bytes/counts)?
- Should the allow-list live in `dex-export.js` or in a schema file the nodes share?

## 7 · What was built — 2026-10-12

The owner ruled §6's second question on 2026-10-12: the allow-list lives in **one shared schema file**,
`export-schema.js`, and every node-export and the Integrator read it. The file holds no DOM call and no
node logic, so the test runner loads it in a vm realm beside the other spine modules.

`scrubExport` now projects the envelope through `ExportSchema.project`. A key absent from the
allow-list is absent from the output. `schema.scrubDropped` names every dropped key as a dotted block
path, because §∅ asks a removal to announce itself. Without the shared file `scrubExport` **throws**
rather than stamping `scrubbed: true`. So a bundle that never co-loaded the schema cannot ship an
export claiming a scrub that nothing performed.

**One deviation from §3.** The filename-shape regex did not go away. `tests/dex-tests.js` already pins
`recording.source` surviving a scrub as `'file'`, and a semantic tag beside it
(`'ResMed AirSense 11 (EDF set)'`). Dropping the regex would break both committed assertions. So
`source` carries a declaration on the three blocks that hold it, and the regex moved out of the scrub
body into a `GUARDS` entry in the schema file. A guarded key whose value looks like a path drops and
gets named, like any undeclared key. The regex stopped being a secret; it did not stop existing.

§3 really asks for a node-side repair — a node writing its semantic tag under a key no reader can mistake
for a path. That repair rides a residue row, not this unit.

The suite answered §6's first question, where inspection had not. An allow-list drawn from the corpus
alone dropped `sessions[].hrvScore`, which a committed assertion reads. That key carries a declaration
on the strength of the assertion, and the schema file says as much beside it.
