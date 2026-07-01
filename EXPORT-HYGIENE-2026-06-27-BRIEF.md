<!--
  EXPORT-HYGIENE-2026-06-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-29 · **Created:** 2026-06-27 — Phase 0 (`dex-export.js` `exportName()` + `export-naming` gate) + Phase 1 PulseDex landed earlier 2026-06-29; the **remaining 7 exporters** (OxyDex/ECGDex/HRVDex/GlucoDex/PpgDex/CPAPDex/Integrator) migrated to the shared `exportName()` 2026-06-29 (local `_exportTs()`/`stampName()`/inline `cpapdex-` stamps DELETED; recording-anchored + span-aware + controlled-vocab; interop files left off-scheme per §5 but de-clocked) → **every exporting node now names through the one shared helper** (DoD met). All 8 re-bundled, both gates green (verify-provenance GATE A 8/8 + GATE B; Dex-Test-Suite all-green, 88 groups). Residue — in-payload `generated` determinism (§5) + the now-UNBLOCKED `recording.contentId` filename suffix (§2.5, PulseDex ships contentId) → `EXPORT-HYGIENE-FOLLOWUPS-2026-06-29-BRIEF.md` → `EXPORT-HYGIENE-FOLLOWUPS-II-2026-06-29-BRIEF.md`. · **Related:** `EXPORT-IDENTITY-2026-06-27-BRIEF.md` (sibling — the *identity/privacy* half of export hygiene; this brief is the *filename/timestamp* half)

# Export-filename unification + the export-clock fix — build brief

> **Read `CLAUDE.md` first — it wins on every conflict** (the Clock Contract §5 `getUTC*` rule, the
> two gates, frozen `Ganglior`/`ganglior.node-export` names, edit-`.js`-then-re-bundle). This brief is
> **forward-first** and **gate-cheap**: the shared helper is a new module (zero gate cost); per-node
> adoption is opportunistic and **fixture-inert** (a download filename is not hashed content).

---

## 0 · Thesis (and the bug hiding inside it)

Every node already names exports with the *same shape* — `<Node>_<YYYY-MM-DD>_<HHMM>_<kind>.<ext>`
(e.g. `ECGDex_2026-06-27_1454_summary.json`). The shape is fine. Two things underneath it are not:

1. **It is a copy-pasted helper that drifts** — `_exportTs()` is duplicated verbatim in every
   `*-app.js`, and the `kind` segment uses an ad-hoc vocabulary that disagrees across nodes.
2. **🔴 It violates the Clock Contract.** Every `_exportTs()` builds the stamp from `new Date()` read
   through **local** getters. That is (a) the *export-click* wall-clock, not the *recording* the file is
   about, and (b) **viewer-timezone-dependent** — the exact failure §5 of the Clock Contract exists to
   prevent. `ecgdex-app.js:1017` even documents it: *"YYYY-MM-DD_HHMM (local export wall-clock)."*

So a file named `ECGDex_2026-06-13_1024_summary.json` is the **10:24-morning export** of a night that
*started ~23:00 the day before* — the filename names the wrong day, and would name a *different* day
again if exported from a machine in another timezone. For private overnight medical data that sorts and
collates by night, that is a correctness defect, not a cosmetic one.

---

## 1 · Current state — grounded (file:line evidence)

**The duplicated, Clock-Contract-violating stamp (identical body in all five confirmed):**
- `pulsedex-app.js:668`, `oxydex-app.js:60`, `glucodex-app.js:877`, `ecgdex-app.js:1018`,
  `hrvdex-app.js:88` — each is
  `const d=new Date(); …d.getFullYear()/getMonth()/getDate()/getHours()/getMinutes()…`.
  **Local getters + `new Date()` = export-time, viewer-TZ-dependent.** (Audit `ppgdex-app.js`,
  `cpapdex-app.js`, `integrator-app.js` the same way — the grep capped at five; assume they have their
  own copy until proven otherwise.)

**The `kind`-segment vocabulary drift (PulseDex shown; mirrors across nodes):**
- `pulsedex-app.js:621` → `…_summary.json` (single-recording JSON)
- `pulsedex-app.js:634` → `…_multi<N>.json` (array + crossNight envelope) — ad-hoc count suffix
- `pulsedex-app.js:654` → `…_ganglior.json` (the `ganglior.node-export` fusion currency)
- `pulsedex-app.js:686` → `…_summary.csv` (human table)
- Committed fixtures additionally use a **double suffix** `.node-export.json`
  (`uploads/ECGDex_2026-06-27_equiv.node-export.json`, `…/PpgDex_2026-06-27_equiv.node-export.json`)
  while older ones use `_summary.json` — two encodings for "what kind of export this is".

**The shared download primitive already exists** — `dl(content, name, type)` at `pulsedex-app.js:659`
(`createElement('a')` → `href=URL.createObjectURL` → `a.download=name` → click). Only the *name* is
computed per-node; that is the one seam to centralize.

**Separate (do NOT fold in): an in-payload export timestamp.** `pulsedex-app.js:652`
`generated:new Date().toISOString()` writes export-time **into the export content**. `toISOString()` is
at least UTC (not the filename's local bug), but it makes the bytes **non-deterministic per export** and
so depends on the equivalence gate's exclusion list to stay green. That is a *content* field → changing
it **moves fixtures**, so it is a different, gated decision — tracked in §5, not done here.

---

## 2 · Target

```
<Node>_<YYYY-MM-DD>_<HHMM>_<kind>.<ext>
   │         │          │      │      └ format: json | csv | jsonl | html
   │         │          │      └ controlled vocab (see below)
   │         └──────────┴ recording ANCHOR t0Ms, via getUTC*  (NOT new Date(), NOT local getters)
   └ frozen LEXICON node name (capital-D, acronym stems all-caps)
```

**2.1 Timestamp = recording anchor `t0Ms`, read via `getUTC*`.** Reuse the Clock-Contract formatters
already in each node (`fmtDate`/`fmtClock`). Consequences, all desirable: the name identifies the
**night**, is **deterministic** (re-exporting the same recording yields the same name), and is
**viewer-timezone-independent** by construction. **Missing `t0Ms` → literal `undated`**, never a
fabricated `now()` (Clock Contract §1/§6; epistemic-honesty invariant). For a multi-recording span
export (HRVDex), the anchor is the FIRST night plus a span marker (2.4).

**2.2 One shared helper (single source of truth).**

```js
// dex-export.js  (new CORE/util module — DOM-free, loadable in node:vm)
// kind ∈ EXPORT_KINDS; ext ∈ {json,csv,jsonl,html}; t0Ms is the recording anchor (floating ms) or null.
function exportName({ node, t0Ms, kind, ext, spanDays = null }) { … }   // → "<Node>_<date>_<time>_<kind>.<ext>" | "<Node>_undated_<kind>.<ext>"
const EXPORT_KINDS = ['ganglior', 'summary', 'series', 'report'];
```

Every node deletes its local `_exportTs()` and calls `exportName(...)`. The `dl(...)` primitive is
unchanged.

**2.3 Controlled `kind` vocabulary** (collapses the drift in §1):

| kind | what it is | replaces |
|---|---|---|
| `ganglior` | the `ganglior.node-export` JSON — the fusion currency | `_ganglior` (keep), `.node-export.json` double-suffix |
| `summary` | human-readable metrics table (CSV/JSON) | `_summary` (keep) |
| `series` | per-record rows (multi-recording array / JSONL) | `_multi<N>` (drop the count from the name) |
| `report` | rendered HTML/PDF | (new, where applicable) |

The **extension** carries the format; the `kind` lives **only** in the name segment — pick one home, so
we never again have both `_ganglior.json` and `.node-export.json` meaning the same thing. **Frozen-name
note:** this is the *filename* `kind`, entirely separate from the FROZEN `schema.name:"ganglior.node-export"`
*inside* the file — do not touch the schema string.

**2.4 Span-aware names.** HRVDex exports a multi-night window; a single `HHMM` misrepresents it. Use the
first night + an explicit span: `HRVDex_2026-05-01_29d_summary.csv` (or `…_2026-05-01_to_2026-05-29_…`).
`exportName` takes `spanDays` and formats this; single-recording nodes pass `null`.

**2.5 Privacy seam (see the sibling brief).** The filename stays **identity-free** — no patient name,
no device serial. The only sanctioned disambiguator is the short content digest from
`EXPORT-IDENTITY`'s `recording.contentId`, appended optionally: `…_ganglior_a1b2c3.json`. Adopt that
**after** the identity brief lands; do not invent a separate id here.

---

## 3 · Phased plan (sequenced by gate cost — zero first)

### Phase 0 — `dex-export.js` + unit tests   · GATE COST: Node runner only
New `dex-export.js` (the `exportName` + `EXPORT_KINDS`), DOM-free, plus a `export-naming` group in
`tests/dex-tests.js` (both runners): asserts recording-anchored UTC output is **TZ-independent**
(format under two `TZ`s → identical), `undated` on null `t0Ms` (never `now()`), the kind vocabulary is
closed, and span formatting round-trips. **No existing `*-app.js` edited, nothing bundled loads it yet**
→ provenance untouched; run `node tests/run-tests.mjs`.

### Phase 1 — Per-node adoption (opportunistic, one node per pass)   · GATE COST: per-node re-bundle, **fixture-INERT**
For each node, when you're touching it anyway: load `dex-export.js` in its `.src.html`, replace the
local `_exportTs()` call sites with `exportName(...)`, delete the dead `_exportTs()`. Then the standard
ritual (`CLAUDE.md`): re-bundle → `Dex-Test-Suite.html` all-green → read `manifestHash` →
hand-update `BUILD-MANIFEST.json` (GATE A).
**Why this is cheap:** the download **filename is not hashed content** — `manifestHash` is over the
bundle, fixture hashes are over file *bytes*, neither sees the name. So **no fixture regen, GATE B
untouched**. You pay one `manifestHash` bump per node, nothing more.
**⚠ Do NOT rename the already-committed fixtures** (`uploads/ECGDex_2026-06-13_1024_summary.json`, etc.)
— they are cross-referenced by name in `BUILD-MANIFEST.json` / `FIXTURE-PROVENANCE.json` / briefs
(`PROFILE-HANDOFF-BRIEF.md:90`, `DEX-METRIC-REMOVAL-AUDIT-BRIEF.md:28`). Same frozen-name hazard as
briefs. New scheme applies to **new** exports only; the old fixture names stay as historical anchors.

### Phase 2 — Audit the un-grepped exporters   · GATE COST: folds into each node's Phase 1
Confirm `ppgdex-app.js` / `cpapdex-app.js` / `integrator-app.js` filename builders and fold them into
the same helper as those nodes migrate. Don't sweep all at once (`ARCHITECTURE-PRINCIPLES §7`).

---

## 4 · Invariants you MUST NOT break

1. **Clock Contract verbatim.** `t0Ms` floating wall-clock; read back **only** via `getUTC*`; missing →
   `undated`, never `now()`. This brief *fixes toward* the contract — do not "simplify" back to
   `new Date()` local.
2. **Frozen names.** The filename `kind` is cosmetic; the in-file `schema.name:"ganglior.node-export"`
   and all `ganglior.*` identifiers are untouchable. Node names follow `LEXICON.md §4`.
3. **Fixture-name immutability.** Never rename a committed `uploads/*.json` fixture to match the new
   scheme — it breaks GATE A/B + brief cross-refs.
4. **Single source of truth.** After Phase 1 a node has **no** local `_exportTs()`; the only filename
   authority is `dex-export.js`. (Tradeoff to accept: it becomes a shared bundled module — a future
   edit re-bundles every node that loads it, same as `ganglior-provenance.js`.)
5. **SPDX header** on `dex-export.js`; Apache-2.0; author Michal Planicka.

---

## 5 · Out of scope (separate, fixture-MOVING — do not fold in)

- **In-payload `generated:new Date().toISOString()`** (`pulsedex-app.js:652` + mirrors). Making it
  deterministic (recording-anchored, or omitted, or formally on the equivalence-gate exclusion list)
  changes **export content** → moves fixtures → must ride a node's next deliberate fixture regen with
  GATE B. Track it; do not silently change it under the filename pass.
- **`recording.contentId` filename suffix** — owned by `EXPORT-IDENTITY-2026-06-27-BRIEF.md`; wire the
  optional suffix only after that lands.

---

## 6 · Definition of done + follow-up

**Done when:** `dex-export.js` exists with a green `export-naming` group; at least one node (suggest
**PulseDex** — cleanest, most `kind`s) emits recording-anchored, TZ-independent, controlled-vocab
filenames through the shared helper with its local `_exportTs()` deleted; both gates green for that
node; `DOCS-INDEX.md` row present. Remaining nodes migrate opportunistically (Phase 1 is forever, like
SIGNAL-ADAPTER Phase 9).

**Lifecycle (`CLAUDE.md`):** date is in this filename (set once, never rename). Flip the header to
`IN-PROGRESS` once Phase 0 + the first node land, `DONE — <today>` when every exporting node is
migrated. Keep `DOCS-INDEX.md` in sync. Spawn `EXPORT-HYGIENE-FOLLOWUPS-<YYYY-MM-DD>-BRIEF.md` for
residue, or state in this header that none surfaced.
