<!--
  DOCS-LEDGER-GATE-2026-07-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->

**Status:** DONE — 2026-07-04 · **Created:** 2026-07-03 · **Followed-by:** `DOCS-LEDGER-GATE-FOLLOWUPS-2026-07-04-BRIEF.md`

> **EXECUTED 2026-07-04.** The `docs-ledger` group is live in `tests/dex-tests.js` (both runners, headless
> floor), skipping cleanly when `env.docsLedger` is absent. Checks 1–6 + a list-staleness leg; all green on
> the tree, and each check verified to RED with an actionable message when deliberately broken. Wiring:
> Node lane `readDocsLedger()` (fs truth + list==fs staleness) in `run-tests.mjs`; browser lane fetches
> names from the committed `tests/docs-ledger-list.json` (generator: `tests/gen-docs-ledger-list.mjs`).
> Phase-0 findings + fixes: **55 pre-2026-07-03 headerless briefs → grandfathered** (never fabricated a
> status — CLAUDE.md §🧪); **10 unindexed briefs → DOCS-INDEX rows added** (check 3); **`DEX-PILL-UNIFY`
> carried an out-of-vocab `DEFERRED` status → rewritten to `PROPOSED (deferred …)`** (check 2a); **a latent
> `**Superseded-by:**` bold-markdown parser bug in check 5 → fixed** (was vacuous with 0 links today).
> `env.docsLedger` is a DISTINCT key from the flat `env.docs` text-map (the brief said `env.docs`; that key
> was taken). CLAUDE.md §📌 notes the gate. **No re-bundle / no provenance churn.** Residue (DEFERRED
> vocabulary decision · whole-tree check-4 link integrity · v2 status-column sync) → the follow-up.

# Docs-ledger gate — make the brief lifecycle machine-checked

> **What this is.** An implementation brief for an AI coder. **One thesis:** the brief-lifecycle
> convention (`CLAUDE.md` §📌 — immutable dated filenames in `briefs/`, status-in-header,
> `DOCS-INDEX.md` as the synced dashboard, `Superseded-by:`/`Supersedes:` symmetry) is the **last
> ungated contract in the suite**. Every other convention that mattered — the evidence ladder, the
> roster, the export schema, code identity — was converted from "please remember" into a red/green
> gate, and drift stopped. The doc ledger is still policed by humans remembering, and the
> 2026-07-03 bulk relocation of 137 briefs into `briefs/` (owner-sanctioned) just demonstrated how
> much can move at once: 127 dashboard links were repointed **by hand-driven script, verified by
> eyeball**. Nothing would have turned red if one had been missed. Fix that: add a `docs-ledger`
> group to the shared suite so a missing header, a dead dashboard link, an unindexed brief, a
> root-level stray, or a one-sided supersede link is a **blocker, not an archaeology find**.
>
> **Scope guard:** pure static text checks. No app code, no DSP, **no re-bundle** — `manifestHash`
> does not move, no ledger churn, `verify-provenance.html` is untouched by construction.

---

## 0. Ground truth — read before writing a line

- **`CLAUDE.md` §📌 Brief lifecycle** — the contract this gate enforces. It is authoritative; if a
  check below disagrees with it, the check is wrong.
- **`DOCS-INDEX.md`** — the dashboard being gated, incl. its "Maintaining this index" tail.
- **`tests/dex-tests.js`** — the shared assertion library BOTH runners load. Study the existing
  `cohesion-badges` and *"Orientation map — roster covers the shipped fleet"* groups: they are the
  house pattern for env-injected, text-over-files gates. This brief adds a sibling group, not a new
  mechanism.
- **`tests/run-tests.mjs`** + **`Dex-Test-Suite.html`** — the two runners; both must feed the new
  group (Node via `fs`, browser via same-origin `fetch`). The group runs in the **headless CI
  floor** (it is cheap text — it must NOT hide behind `?full`).
- **`briefs/`** — 137 files as of creation; `licensing/LICENSING-BRIEF.md` intentionally lives in
  `licensing/` (allowlist it — its path is load-bearing in `CLAUDE.md` §📜).

## 1. The checks (the whole design)

New group `docs-ledger` in `tests/dex-tests.js`, fed an `env.docs` object:
`{ briefFiles: {path: text}, indexText, rootMdNames: [..] }`. If `env.docs` is absent the group
**skips** (older/partial runners stay green — same tolerance pattern as other env-fed groups).

1. **Location rule.** No `*-BRIEF.md` at repo root. Allowlist: `licensing/LICENSING-BRIEF.md`
   (checked by its own path, not root). A stray root brief = red with the message *"briefs live in
   `briefs/` — CLAUDE.md §📌"*.
2. **Header contract.** Every `briefs/*.md` must carry, on its first content line (after an
   optional SPDX comment block), a status header matching ONE of:
   - `**Status:** (PROPOSED|IN-PROGRESS) · **Created:** YYYY-MM-DD`
   - `**Status:** DONE — YYYY-MM-DD · **Created:** YYYY-MM-DD`
   - `**Status:** (REFERENCE|CHECKPOINT) (living …)` + a `last-verified` date somewhere in the header line(s).
   Derive the exact regexes from the real corpus FIRST (see §3 Phase 0) — the contract is what
   `CLAUDE.md` §📌 says, but whitespace/`·` variants in 137 existing files are ground truth; the
   gate must pass the corpus as-is or the corpus must be fixed deliberately, file by file, never by
   loosening the regex to vacuity.
3. **Dashboard coverage.** Every file in `briefs/` appears **at least once** as a link target
   `](briefs/<name>)` in `DOCS-INDEX.md`. A brief missing from the dashboard = red (the roster-gate
   precedent: ship a thing, forget the map, suite turns red).
4. **Link integrity.** Every relative markdown link target in `DOCS-INDEX.md` (strip `#fragment`s;
   ignore `http(s)://`) resolves to an existing file/folder. This is the check that would have
   caught a missed repoint during the 2026-07-03 move.
5. **Supersede symmetry.** For every brief whose header carries `Superseded-by: <NAME>`, the named
   brief exists and carries a matching `Supersedes:` back-link, and vice versa. One-sided links = red.
6. **Filename discipline (new briefs only).** Any brief whose `Created:` date is ≥ 2026-07-03 must
   have the `-YYYY-MM-DD-BRIEF.md` dated-filename form and the filename date must equal `Created:`.
   Older briefs are grandfathered (their undated names are FROZEN — do not flag them).

**Authority rule (mirror of the badge gate's "fix the DOC"):** when the dashboard and a brief's
header disagree, **fix `DOCS-INDEX.md`**, never the brief header — the header is the source of
truth, the index is the view.

## 2. What this gate is NOT (do not scope-creep)

- It does NOT parse or validate brief *content* (acceptance items, "Done when" boxes).
- It does NOT check status **values** against reality (a DONE stamped on unverified work is a human
  honesty failure the text cannot see).
- It does NOT gate `docs-archive/`, `papers/`, or reference guides (those have their own gates).
- It does NOT require the dashboard row's prose to restate the status — only presence + resolvable
  link. (A status-column sync check is a possible follow-up; keep v1 small.)

## 3. Phases

- **Phase 0 — corpus survey (½ day).** Script-scan all 137 headers; tabulate the real header
  variants. Output: the exact regexes + a (probably short) list of malformed headers to fix
  in-place (header edit only — filename untouched, per §📌).
- **Phase 1 — the group (½–1 day).** Implement checks 1–6 in `tests/dex-tests.js`; feed `env.docs`
  from both runners (Node: `fs.readdirSync('briefs')` + reads; browser: fetch `briefs/` names from
  a small generated `tests/docs-ledger-list.json` **written by the Node runner** — the browser
  cannot list a directory; regenerate the list file whenever a brief is added, and add a check that
  the list matches `fs` reality in the Node lane so a stale list reds in CI).
- **Phase 2 — turn it on (½ day).** Fix whatever Phase 0/1 surfaced (headers, index rows, links);
  land both runners green; add the `DOCS-INDEX.md` row; update `CLAUDE.md` §📌 with one line:
  *"gate-backed by the `docs-ledger` group"*.

**Total: ~1½–2 days.** No re-bundle, no provenance churn at any phase.

## Honesty / risks

- **The browser lane needs a file list** (no directory listing over `fetch`). The generated
  `docs-ledger-list.json` is itself a tiny ledger — it can go stale. The Node-lane reality check in
  Phase 1 is mandatory, not optional, or this brief re-creates the exact hand-fed-ledger disease it
  exists to kill.
- **Regex honesty.** If Phase 0 finds many malformed headers, resist widening the regex until it
  matches everything — that is editing the assertion to hide the break (`CLAUDE.md` §🧪). Fix the
  headers.
- **This gate reads ~140 small text files per run.** Trivial in Node; in the browser keep it in the
  headless floor but fetch lazily/parallel — if it measurably slows the ~3 s bare open, cache or
  trim, don't demote it to `?full`.

## Done when

- ☐ Phase 0 survey committed (variant table + fixed headers, filenames untouched).
- ☐ `docs-ledger` group implemented in `tests/dex-tests.js`, fed by BOTH runners, running in the
  headless floor; skips cleanly when `env.docs` absent.
- ☐ Checks 1–6 all green on the current tree; deliberately breaking each (temp local edit) turns
  the suite red with an actionable message.
- ☐ `docs-ledger-list.json` generated + Node-lane staleness check in place.
- ☐ `DOCS-INDEX.md` row added; `CLAUDE.md` §📌 notes the gate.
- ☐ `verify-provenance.html` untouched and still green (nothing re-bundled — assert by simply not
  having changed any `*-dsp/render/app.js` or `.src.html`).
- ☐ Follow-up brief `DOCS-LEDGER-GATE-FOLLOWUPS-YYYY-MM-DD-BRIEF.md` spawned with what surfaced, or
  this header says nothing did.

## Expected follow-up

Phase 0 will almost certainly surface a handful of pre-relocation briefs with drifted headers, and
possibly dashboard rows whose prose status went stale. Record them + any deliberate regex
decisions in the follow-up. A v2 candidate (explicitly deferred): status-column sync between the
dashboard table and headers.

---

## Cross-references
- `CLAUDE.md` §📌 (the contract) · §🧪 (never loosen an assertion to match a break).
- `DOCS-INDEX.md` — the gated view + its "Maintaining this index" tail.
- `tests/dex-tests.js` — `cohesion-badges` + roster groups: the house pattern this group copies.
- `tests/run-tests.mjs` · `Dex-Test-Suite.html` — the two runners to wire.
- The 2026-07-03 briefs relocation (this file's own `briefs/` path) — the event that motivated the gate.
- `briefs/OWN-THE-BUILD-2026-06-30-BRIEF.md` — the sibling philosophy: construction-enforcement over
  drift-suppression; this brief applies it to the doc layer.
