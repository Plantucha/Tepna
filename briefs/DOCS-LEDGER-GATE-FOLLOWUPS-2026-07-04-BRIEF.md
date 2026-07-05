<!--
  DOCS-LEDGER-GATE-FOLLOWUPS-2026-07-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->

**Status:** DONE — 2026-07-05 · **Created:** 2026-07-04 · **Follows:** `DOCS-LEDGER-GATE-2026-07-03-BRIEF.md` (DONE 2026-07-04)

> **EXECUTED 2026-07-05.** **F1** decided = option (a): `DEFERRED` is NOT a first-class status — the
> vocabulary stays the five values; a parked brief is `PROPOSED (deferred …)`. Recorded in CLAUDE.md §📌
> and LOCKED by three `STATUS_RE` self-tests in the `docs-ledger` group (a bare `**Status:** DEFERRED`
> header reds check2a). **F2** landed: check 4 split into **4a** (briefs links → authoritative brief set —
> the sharp repoint guard, unchanged) + **4b** (every OTHER relative `DOCS-INDEX.md` link — docs/·audits/·
> wiring/·papers/·root — resolves against a whole-tree path inventory). New `paths[]` (698 paths) in
> `docs-ledger-list.json`, emitted by a shared walker `tests/docs-ledger-fs.mjs` (imported by BOTH
> `gen-docs-ledger-list.mjs` + `run-tests.mjs`, so they can't drift); the Node lane recomputes `fsPaths` and
> asserts `listedPaths == fs` (a stale list reds, same device as the brief-name list). 221 DOCS-INDEX links
> resolve, 0 dead. Deliberate, documented scope on the brief's "weigh the staleness surface": the inventory
> excludes never-linked churn dirs (`node_modules`, `screenshots`, `scraps`, `_diag`, `uploads`) + dot-
> entries — narrowed to the LINKABLE tree, visibly (see the walker header), not silently. **F3** stays a
> consciously-deferred v2 (no row↔header drift observed; tracked in §F3, not dropped). No re-bundle / no
> provenance churn. Validated: whole test file parses, all F1/4b self-tests + link resolution green.

# Docs-ledger gate — follow-ups (residue from executing the gate)

> **What this is.** The lifecycle-mandated follow-up after landing the `docs-ledger` group
> (`tests/dex-tests.js`, both runners, all-green 2026-07-04). Three items, all **LOW**, plus the
> Phase-0 scale note for the record. No re-bundle at any phase — pure static text / test-only, exactly
> like the parent.

---

## Phase-0 scale note (for the record, no action)

The parent expected "a handful" of drifted headers. Reality: **93 briefs carry a well-formed status
header (0 malformed after the one fix below); 55 are headerless — ALL pre-2026-07-03 / undated legacy
briefs.** Retrofitting 55 status headers would mean fabricating DONE/status on work this session cannot
verify (CLAUDE.md §🧪 — never stamp DONE on unverified work), so the gate **grandfathers pre-cutoff
headerless briefs** (the same 2026-07-03 cutoff check 6 uses for filenames) and requires a header only on
briefs dated ≥ cutoff. This is a principled cutoff, not a regex loosened to vacuity: every current + future
brief is fully gated, and all 93 existing headers are format-checked. Recorded so a future reader doesn't
"fix" the grandfather by mass-stamping the legacy corpus.

## F1 — 🟢 LOW (decision): should `DEFERRED` be a first-class status in the CLAUDE.md §📌 vocabulary?

Phase 0 found exactly one brief (`DEX-PILL-UNIFY-2026-06-24-BRIEF.md`) carrying `**Status:** DEFERRED —
2026-06-24` — a value NOT in the §📌 vocabulary (PROPOSED | IN-PROGRESS | DONE | REFERENCE | CHECKPOINT).
Per the parent's own rule ("fix the headers, don't widen the regex"), it was rewritten in-place to
`**Status:** PROPOSED (consciously deferred 2026-06-24 — optional polish, see note below)`, which is
in-vocab and preserves the deferred meaning inline. **But** the suite uses "DEFERRED" constantly for
*sub-items* inside DONE headers (`§3 DEFERRED`, `§5 DEFERRED`), so "deferred" is a real, recurring
lifecycle state. **Decide:** either (a) confirm the status quo — DEFERRED is expressed as `PROPOSED
(deferred …)` or a sub-item note, never a top-level status (keep the gate's 5-value vocabulary tight); or
(b) add `DEFERRED` as a sixth first-class status in CLAUDE.md §📌 **and** the gate's `STATUS_RE` (a
deliberate, documented vocabulary extension — NOT a silent widen). (a) is the lean default; (b) only if
the owner wants parked briefs to carry it at the top level. **Done when:** the decision is recorded in
CLAUDE.md §📌 (and, if (b), `STATUS_RE` + one test leg added).

## F2 — 🟡 LOW: extend check 4 (link integrity) beyond `briefs/` to the whole tree

v1 check 4 resolves only `](briefs/…)` links (the 2026-07-03 repoint guard — the motivating case). Other
relative links in `DOCS-INDEX.md` (`docs/…`, `wiring/…`, `audits/…`, root files) are **not** resolved,
because the browser lane has no directory listing and the group has no full-tree file inventory. During
execution the ad-hoc check found the only "dead" non-brief links were `%20`-encoding artifacts (false
positives once `decodeURIComponent` is applied) — so there is no known real breakage today, but a future
moved/renamed `docs/` file would not red. **Do (LOW):** generate a full repo path inventory (extend
`tests/gen-docs-ledger-list.mjs` to also emit a `paths:[]` list; Node lane cross-checks it against fs like
the brief list) and have check 4 resolve EVERY relative link (decode first) against that inventory. Weigh
the added staleness surface (another generated list to keep fresh) against the coverage. **Done when:**
check 4 resolves all relative DOCS-INDEX links, with a Node-lane list==fs guard on the inventory.

## F3 — 🟢 LOW (v2, explicitly deferred by the parent): status-column ↔ header sync

The parent scoped v1 to *presence + resolvable link*, NOT restating each brief's status in its dashboard
row. So a row whose prose says "PROPOSED" while the header flipped to DONE will not red. **Do (v2, LOW):**
add a check that, for every dashboard row carrying a parenthetical status (e.g. `*(DONE 2026-07-04)*` /
`*(PROPOSED …)*`), the value agrees with the linked brief's header status. **Authority rule:** on
disagreement, fix the ROW (the header is source of truth). Non-trivial to parse the freeform prose
reliably — keep it a genuine v2, only if the row/header drift becomes a real problem.

**Status (2026-07-05):** still deferred — F1 + F2 executed; no row↔header drift observed on the current
tree, so v2 stays parked (tracked here, not dropped). Revisit only if a stale dashboard status bites.

---

## Sequencing & gate expectations
- **F1** is a one-line decision (+ optional gate leg) — cheapest; do first if touched.
- **F2** is the real engineering item (inventory + broader check 4).
- **F3** is a genuine v2 (prose parsing) — defer unless drift bites.
- All test-/doc-only: **no re-bundle, no provenance churn**; land `Dex-Test-Suite.html?full` green + the
  `docs-ledger` group green in both runners.
