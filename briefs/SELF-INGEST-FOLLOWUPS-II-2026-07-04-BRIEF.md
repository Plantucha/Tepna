<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-04 · **Parent:** `SELF-INGEST-FOLLOWUPS-2026-07-03-BRIEF.md` (DONE 2026-07-04, all 6 nodes) · **Supersedes:** — · **House pattern:** `SELF-INGEST-FOLLOWUPS` → `-II`

# Self-ingest roll-out — follow-ups II (residue surfaced executing the 6-node roll-out)

> **What this is.** The follow-up the brief lifecycle mandates after executing `SELF-INGEST-FOLLOWUPS-2026-07-03`
> (PulseDex/GlucoDex/ECGDex/HRVDex/PpgDex `loadOwnExport` + review UI, all gate-green 2026-07-04). Captures what
> the roll-out surfaced that the parent did NOT scope. **One real privacy bug (F1), one test-coverage gap (F2),
> and three lower items.** Read `CLAUDE.md` first: F1 touches the shared `dex-export.js` (fleet re-bundle + the
> whole re-bundle/provenance ritual); the rest are node-local or docs-only.

---

## F1 — 🔴 MED/HIGH (privacy): the shared `dexScrubExport` does NOT strip per-element recording blocks on a MULTI-record export

**Verified 2026-07-04.** `scrubExport` in `dex-export.js` de-identifies a shared export by deleting
`schema.provenance.inputs[].{name,sha256}` + `out.recording.{device,serial,model}` **and** — only —
`out.nights[].recording.{device,serial,model}` (the OxyDex/CPAPDex multi-night wrapper). It does **NOT** walk
the OTHER two multi carriers the roll-out introduced/relies on:

- **`out.recordings[]`** — ECGDex + PulseDex multi wrapper (`exportSummary` `recordings:list.map(buildV2)` /
  `recordings[]`).
- **`out.sessions[]`** — PpgDex multi wrapper (`exportSummary` `sessions:list.map(buildV2)`).

**Impact.** A user who exports a **multi-recording / multi-session** ECGDex/PulseDex/PpgDex file and ticks
"scrub for sharing" still ships the **device serial / model** inside each `recordings[i].recording` /
`sessions[i].recording` block — exactly the identifier scrub exists to remove. Single-record exports are fine
(top-level `out.recording` is stripped). Only the multi path leaks.

**Fix.** Generalize the per-element sweep in `scrubExport` to every known carrier (and be future-proof):
```js
['nights','recordings','sessions'].forEach(function (key) {
  if (Array.isArray(out[key])) out[key].forEach(function (el) {
    if (el && el.recording && typeof el.recording === 'object') {
      delete el.recording.device; delete el.recording.serial; delete el.recording.model;
    }
  });
});
```
**Gate/ritual.** `dex-export.js` is inlined in ALL 8 bundles → this is a **fleet re-bundle** (all bundles'
`manifestHash` move). It is **EXPORT-INERT** (scrub is OFF by default, never in `compute()`/the emit path or any
committed fixture) → hand-update every bundle's `BUILD-MANIFEST.json` GATE-A entry + re-record each code-gated
fixture's `manifestHash` (NOT the outputHash — no output moves), per the §🔏 re-bundle checklist. Add a leg to
the `Self-ingest (ECGDex)` **and** `(PpgDex)` §7 groups asserting a scrubbed `recordings[]`/`sessions[]` wrapper
has **no `recording.device`/`serial` in any element** (today only single-record scrub is asserted). **Done when:**
scrub strips device/serial from every element of all three carriers; new multi-scrub test legs green; `?full` +
`verify-provenance` + `no-network` all green.

---

## F2 — 🟠 MED (test coverage): the review-mode RENDER functions are not exercised by any gate

The §7 groups test the **pure** `<node>LoadOwnExport` (detect/guard/unwrap/faithful-view/scrub) in both runners,
but the **review renderers** — `pulseReviewView` / `glucoReviewView` / `ecgReviewView` / `hrvReviewView` /
`ppgReviewView` (+ their `…RenderReview` DOM glue) — are **not driven by anything**. Render-coverage boots each
app but never enters review mode (it needs a dropped envelope), so a broken review renderer (a thrown error, a
`null.hrv.time` deref on a light export, malformed HTML) would **ship uncaught**. This bit nothing this round only
because the renderers were hand-checked at build time; it is latent.

**Options (pick one).** (a) A `tests/dex-tests.js` **browser-only** group that, per node, builds a representative
export, calls `<node>RenderReview(loadOwnExport(exp))` in a detached container, and asserts the card mounts +
contains the KPI grid + the greyed-raw note + no thrown error (mirrors the render-coverage rig style). (b) A
lighter **pure** assertion that `<node>ReviewView(review)` returns a non-empty string containing the banner +
disclaimer for BOTH a rich and a light export (guards the null-safety on the light path). (b) is cheaper and
node:vm-safe if the `ReviewView` functions are made reachable (see F5); (a) is the real thing. **Done when:**
every node's review render is asserted on both a rich and a light export, both runners (or browser-only for (a)).

---

## F3 — 🟡 LOW/DOC: the light-vs-rich export DUALITY has no single contract; three nodes were mis-Tiered in the parent

**✅ DONE 2026-07-04 — `docs/EXPORT-SHAPES.md` written** (per-node light-vs-rich table + multi-carrier keys +
reload targets + the rules a new node follows; DOCS-INDEX row added). Residual (LOW): add a one-line pointer to
it from `ARCHITECTURE-PRINCIPLES.md` §8's "adding a new Dex" checklist (the doc already cross-refs §8; the
back-pointer is optional polish). The rest of this section is the original write-up.

The roll-out corrected the parent brief **three times** by reading the actual builders instead of trusting the
Tier labels: **GlucoDex** and **HRVDex** shipped a *light* `ganglior.node-export` (events + recording only) and
needed real enrichment (`glucose` block / `measurements[]`), while **ECGDex** and **PpgDex** already emit a *rich*
export via `buildV2`/`exportSummary` (recording + hrv + quality/personalization + …) and were export-inert. The
root cause: **most nodes emit TWO `ganglior.node-export` artifacts** — a LIGHT `exportGanglior` (events, for the
Integrator's byte-identical fusion stream) and, for some, a RICH `buildV2`/`exportSummary` ("full AI-readable
JSON") — and **nothing documents which is which, or which is the clinical-reload artifact.**

**Do.** Add a short **"Export shapes per node"** table to `docs/` (or `ARCHITECTURE-PRINCIPLES.md` §export) —
per node: light builder + its fields, rich builder (if any) + its fields, the multi-carrier key
(`nights[]`/`recordings[]`/`sessions[]`), and which artifact `loadOwnExport` treats as the clinical view. **This
is the reference EEGDex/SpiroDex must fill in at build time** (decide the export shape up front, don't ship light
then retrofit an enrich pass). No code. **Done when:** the table exists and the ARCH §8 "adding a new Dex"
checklist points at it.

---

## F4 — 🟡 LOW (test fidelity): ECGDex + PpgDex §7 groups drive HAND-BUILT exports, not `compute()`

Unlike Pulse/Gluco/HRVDex (whose §7 groups drive `compute()` → `loadOwnExport` on a real synthetic input), the
ECGDex + PpgDex groups reload a **hand-authored** buildV2-shaped export (raw ECG/PPG synthesis is heavy and
`buildV2` is DOM-adjacent app code, not the headless `compute()` light builder). Each has a **guarded**
`genSynthetic→compute(rich)` authenticity leg, but it exercises the LIGHT `ppg/ecgBuildNodeExport` rich branch,
not the app's `buildV2` the user actually reloads. Residual risk: if `buildV2`'s field shape drifts from what
`ecg/ppgLoadOwnExport` reads, the hand-built test won't catch it. **Do (LOW):** extract the `buildV2` field
assembly to a DOM-free helper (or add a headless golden of one real `buildV2` output) so a §7 leg can assert the
reader against the ACTUAL rich shape. Defer unless `buildV2` changes. **Done when:** at least one §7 leg per node
reloads a real `buildV2`-produced export.

---

## F5 — 🟢 LOW (consistency): 4 of 5 review renderers are app-IIFE-local, not global (unlike PulseDex's render.js)

`glucoReviewView`/`ecgReviewView`/`hrvReviewView`/`ppgReviewView` were co-located in each node's `*-app.js`
(reachable by the file-drop handler in the same scope, but **not** global — a global `eval` can't call them, so
this round's visual check relied on boot-clean + source-presence). `pulseReviewView` lives in `pulsedex-render.js`
and IS global. Harmless functionally, but it (a) blocks the cheap F2(b) pure-render test and (b) is inconsistent.
**Do (LOW):** either move each `*ReviewView` to the node's `*-render.js` (global, matches PulseDex) OR expose them
on the node namespace (`<Node>.reviewView`) so F2(b) can reach them. Pick one convention fleet-wide. **Done when:**
all six review renderers are reachable the same way + F2(b) can call them.

---

## Sequencing
1. **F1 first** (real privacy bug) — the fleet re-bundle is the heaviest gate action; do it as its own pass.
2. **F5** (make renderers reachable) unblocks **F2(b)** — do them together.
3. **F3** (docs) any time — cheapest, and gates EEGDex.
4. **F4** only if `buildV2` is touched.

## Gate expectations
- **F1:** fleet re-bundle → 8× GATE-A hand-update + code-gated fixture `manifestHash` re-record (export-inert, no
  outputHash moves) + new multi-scrub §7 legs; `?full` + `verify-provenance` + `no-network` green.
- **F2/F4/F5:** node-local external-JS → per-node re-bundle, export-inert (manifestHash-only); `?full` green.
- **F3:** docs-only, no gate.
