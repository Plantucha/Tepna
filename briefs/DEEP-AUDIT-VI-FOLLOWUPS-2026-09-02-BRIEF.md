<!--
  DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED — 2026-09-02 (residue of executing all 18 DEEP-AUDIT-VI findings across five sessions in one night; §1 remainders are assigned-by-lane, §2–§3 are sweep/tool candidates awaiting a slot, §4 is the scope line DEEP-AUDIT-VII must open with) · **Created:** 2026-09-02 · **Spawned-from:** `DEEP-AUDIT-VI-2026-09-01-BRIEF.md` (DONE 2026-09-02)

# Executing the sixth audit: what the fixes found that the audit did not have

`DEEP-AUDIT-VI` filed 18 confirmed findings on 2026-09-01. All 18 landed by 2026-09-02 05:00 in **20 PRs**
across four sessions — Magpie F1 #2059 · F2 #2068 · F3 #2064 (+ PpgDex port #2073) · F4 #2072; Osprey
F6 #2055 · F5 #2058 · F15 #2066 · F16 #2070; Kestrel F7 #2056 · F9 #2060 · F10 #2061 · F14 #2062 · F12 #2063
· F11 #2065 · F8 #2067 · F13 #2069 (spine, landed last); Heron F17+F18 #2057 (+ #2071 teardown). The audit
stamps went into the parent brief in the same sessions (TRIAGE STAMPS THE BRIEF). This brief records what
executing them turned up that the audit could not see — the pattern of DEEP-AUDIT-V-FOLLOWUPS, and it is
smaller in defect count and larger in *gate-class* count: five of the items below are ways a green gate said
nothing, found only because someone tried to make a fix land.

---

## 1 · Remainders still open under a finding (lane-assigned, not closed by the fix)

| # | under | what stays open | lane |
|---|---|---|---|
| 1.1 | **F1** | The sibling **`_ACC.txt` clock step** (MotionDex / PMDARRIVAL inheritance) — F1's repro verified the ns step IS present in the ACC file of the same night; the ECG fix bounds the ECG gap walk by the phone-column delta, but the ACC consumer's consequence was **never executed**, and nothing bounds that stream. First step is to run it, not to port the fix. | Magpie (JS) |
| 1.2 | **F1** | **Capture-side hardening**: rotate the file set on a `clock_watchdog` step so a resynced night lands as two fragments instead of one poisoned file. Specified as a SEPARATE unit in F1's stamp; not built. | Heron |
| 1.3 | **F1** | **ONE DEVICE CLOCK PER AXIS** — the refold, not the audit, found that pre-resync anchors carry a *different oscillator state* (08-27: +1508 ms over 9.5 s ≈ 160,000 ppm) and `hostAxis` quoted it into `fs`. Fixed for ECGDex (`anchorsDroppedPreResync`, `clockResyncs[].hostOffsetMs`); **the principle is not yet stated in the Clock Contract §7** — an axis must be built from anchors of ONE clock state, and a resync boundary is a state change. Add the paragraph; then check PpgDex's `hostAxis` call site for the same pre-resync exposure. **§7 paragraph BUILT 2026-09-02 (Kestrel)** — the contract now names the split, the ECGDex fields, and the rule that a node which detects no steps has not shown it has none. **PpgDex check OPEN**: `ppgdex-dsp.js` has NO step detection at all (`grep -i resync` → 0), so the question is first whether `_PPG.txt` ever carries a counter step on a resynced night, then the split. | Kestrel (CLAUDE.md §7 — DONE) → Magpie (PpgDex check) |
| 1.4 | **F2** | Both lanes now resolve `t0Ms` by Clock Contract §4 "first VALID sample". **If a real night ever shows the old app rule ("first non-empty, null if unparseable") choosing a different row, quote the row here** — do not regenerate on the assumption. **Not checked by any sweep**: F2's six-file parser-parity run (2 committed twins + the equiv clip + the three resync nights) asserts that the two PARSERS agree, not that the two ANCHOR RULES pick the same row, and the old rule no longer exists in either lane to run. A watch item with no supporting measurement behind it. | any, on sighting |
| 1.5 | **F4** | `rraccRate` was re-tiered emerging → **experimental** on 45 real H10 nights (median r 0.07, MAE 2.5 br/min, LoA −4…+7.5). **`edrResp`'s own `emerging` grade was NOT adjudicated** — it needs a reference the corpus lacks (CPAP flow is the candidate reference once the co-imported nights are aligned). Until measured it is probably also experimental; do not re-grade on this sentence alone. | Osprey (measurement) |
| 1.6 | **F8** | CPAPDex **`therapyHours` = wall duration** feeds the usage KPI and `compliancePct` in the night summary, where mask-on usage is the clinically meant quantity (the F8 fix corrected `usageHours`; `therapyHours` still reads the session span). Measure the gap on the real corpus before deciding whether it is a relabel or a recompute. | Kestrel |
| 1.7 | **contested** | `capture-host/status_union.py:77` heartbeat-across-DST — still the disposition the audit gave: **drive `_now()` through a real faked-tz transition with a writer open**; only then confirm and pick among the three fixes. Not touched this pass. | Heron |
| 1.8 | **F3 / F10** | The PpgDex `cvhrFromNN` port (#2073) changes the **denominator** only. The OxyDex §2.6 group's standing note *"PPGDEX cvhrFromNN IS DELIBERATELY NOT PART OF THIS FIX"* governs **nulling `index: 0`** (the refusal marker two goldens pin byte-for-byte) and is UNCHANGED: 0 still means what it meant. Recorded so a third session does not read the port as a violation of that note, or the note as a bar on the port. | — (record only) |

---

## 2 · Gate classes found by trying to land a fix (each a sweep candidate)

### 2.1 A fixture corpus can only falsify what it can express — bitten TWICE in one night
`verify-fixtures` reported "1 stamped / 13 current, no fixture moved" for the PpgDex port, which reads as
"the new export field is inert". It is not inert: **none of the six committed PpgDex fixtures can take the
`cvhrHours` attach branch, by TWO independent mechanisms** (enumerated from `provenance/PpgDex.json`): the three
rich-route goldens (`synthetic_ppgdex_rich_golden` · `_o2ring_finger_golden` · `_inverted_golden`) carry an apnea
block with `cvhrIndex: null`; the other three (`PpgDex_2026-06-27_equiv` — a REAL corpus night, not a synthetic —
`synthetic_ppgdex_golden` · `_gapped_golden`) were produced on the non-rich route, which never emits the block at
all. *(#2073's own commit text and an earlier draft of this line said "every golden is a short synthetic with a null
index" — falsifiable by one glance at the equiv night; corrected on Magpie's enumeration.)* Same for F3: no ECGDex golden is a
long non-ambulatory night, so none carries an `apnea` block at all — and there the wire was genuinely
**dead** (the `analyze()` reshape allowlist dropped `denomSec`; the source-scan assertion passed on a regex
while nothing travelled). A green fixture gate and a passing source scan coexisted with a wire that had
never executed once.

**Rule:** when a new field attaches under a condition NO committed fixture meets, the fixture gate is silent
*by construction* — not reassuring — and the unit owes an **executed end-to-end leg**. Magpie added one on
both nodes; on PpgDex it caught its own first mistake immediately (the apnea block is `opts.rich`-gated, so
the plain builder yields none). Now: 900 s synthetic → `analyze` → builder, asserting
`cvhrIndex × cvhrHours ≈ cvhrEvents`; plus a **cross-node leg** — ECGDex and PpgDex return the SAME index
and the SAME denominator on identical input, the property the Integrator's corroboration rests on and which
nothing had asserted.
**Candidate mechanism:** a *field-attach coverage* check — for every export field attached conditionally
(`if (x != null) out.x = …`), at least one committed fixture or equiv-leg synthetic must take the attach
branch. Same family as the memory `assertions-encode-shape-not-contract`.

### 2.2 Gates that assert SHAPE go red when the code gets BETTER (the inverse failure)
Three existing ECGDex gates reddened on F2 — a change that *strengthened* the invariant each exists to
protect: the stream-fallback group enumerating six accumulator variable NAMES; the worker-clock group slicing
`WORKER_SRC` as one template literal; the `t0Ms` leg regexing an app-side null guard. Re-aimed at the contract
in #2068. **Fourth instance, sharpened:** a gate that asserts a **PLURAL** has encoded the duplication as the
requirement — `Integrator §12-§16` asserted `_fsSites >= 3` and its own comment knew one site was a mirror;
single-sourcing then read as a regression. Re-aimed: DSP keeps the form (≥1, anti-vacuity), app derives NO
rate (exactly 0), ns counter still outranks the mean form.
**Sweep rule:** grep `tests/dex-tests.js` for `>= [2-9]` / `=== [2-9]` on a count of source sites,
accumulator names, or copies, and for any assertion that greps a variable name or slices source text. Each
is a candidate; the fix is to assert the property the copies were evidence *for*.

### 2.3 "Structurally pinned because we cannot execute it" is a DATED claim
The fallback group's note said the harness has no async group so the invariant is pinned structurally. The
moment the scan became a DSP export (F2), DEEP-AUDIT-II §4.4's stale re-read became executable with a defect
direction. Such comments should carry a **date and the condition** that makes them true, and be re-checked
whenever the module boundary they lean on moves.

### 2.4 Two `dormant:true` registry flags were false WHEN WRITTEN
#1455 (2026-08-18) flagged `rraccRate` and `edrDisagree` dormant with a comment claiming a per-name sweep of
every surface; both had compute + surface sites since the initial commit (`accExtras`/`_accCardRR`;
`ecgdex-app.js disagreementRatePct`). Examined-nothing family: a sweep that examined other surfaces than
it claimed. **Sweep:** every `dormant:true` in every `<node>-registry.js`, checked against a grep of the id
AND its aliases in the app/render files.

### 2.5 An UNREGISTERED surfaced label is an UNCHECKED grade
The ECGDex Reference guide graded posture `ev-measured` for a mount-dependent convention — invisible because
'Posture' resolved to no registry id, so `cohesion-badges` had nothing to compare. Registering the id made
the wrong grade visible and it was corrected to experimental. **Sweep:** every reference-guide card label with
no `idForLabel` hit is a grade nobody checks.

### 2.6 The dormant-surface alias matcher: an alias shorter than a word is not a surface token
MotionDex `uprightFrac`'s bare alias `upright` matched a posture ENUM value in `POS_ORDER` — a false
positive. Matcher (#2072) now admits the label always, an alias only if multi-word or ≥ 8 chars; negative
control keeps the ECGDex pair. Generalise to any label-driven scan.

### 2.7 A `rec.gaps` fold ADDS dead time to later beats rather than removing them
A folded night keeps its active seconds and grows only its span (F3). Read this before writing another
gap-geometry test — the intuitive "gaps subtract" model produces assertions that pass for the wrong reason.

---

## 3 · Tooling and process residue

### 3.1 `rebase-safe` "THIS REBASE DISCHARGED N VERIFICATION(S)" over-reports by design
Seen on F11, F12, F13 (Kestrel) and F2 (Magpie): it reports every stamp that reverted to the base's, not
whether the revert *mattered*. **Verdict rule used all night:** `git diff origin/main -- provenance/<Node>.json`
EMPTY **and** the branch touches nothing in that node's compute closure ⇒ main's verification is valid and
verify-fixtures' "already current" is correct, not a skip. Otherwise run `verify-fixtures`. **Tool fix:** print
the two sub-cases separately — *stamp reverted AND differs from base* (a real discharge) vs *stamp equals base*
(nothing owed). Cost of not fixing: a full ~11 min verify lap per false alarm.

### 3.2 A spine PR costs one full verify lap per merge ahead of it
F13 (`dex-export.js`, 11 bundles) had to re-verify after each node PR merged under it (vf3 → vf4). The
"land the spine last" order was right; the missing rule is **hold the other lanes' pushes from the moment the
spine's verify starts until it is pushed** — otherwise each merge burns another lap.

### 3.3 Pre-rebase a HELD branch while its conflicts are only with your own merged work (Osprey, F16)
Rebase-safe onto main at idle time when the conflict set is self-owned; the eventual landing is then a
near fast-forward. One rebase-safe + build, no CI. Adopt as a fleet habit.

### 3.4 `selftest-all` couples two selftests through a mutable local index (primary-box-only flake)
`npm run check` failed ONCE on `tools/dsp-review-qwen.mjs`'s selftest in F4's chain; passes standalone (21 ok),
passed in F2's identical chain 20 min earlier, F4 touched no tool. `selftest-all.mjs` runs
`tools/doc-search.mjs`'s selftest immediately before it and both share the local bge-m3 chunk index — the
chain-time run was re-embedding. CLAUDE.md says no gate may read doc-search output, yet `selftest-all` runs its
selftest, so the coupling exists on the primary box and CI never sees it. **Fix candidates:** serialise the two
behind a lock, or give the qwen selftest a read-only snapshot.

### 3.5 Kill only what you own; a pattern is not a name (Osprey / Kestrel, 2026-08-31 → 09-01)
A pattern kill hit a PEER's gate unit; a clearing sweep globbed `*check*.log` while the evidence sat in
`*vf*.log`; a superseded monitor kept firing with authoritative-sounding text. Standing rules, now in memory
(`kill-only-owned-pids`, `kill-by-pattern-hits-peers`, `superseded-monitor-still-fires`): stop only named
`systemd --user` units; after any reported kill re-check every sentinel log for a missing `EXIT=`; `TaskStop`
a retired monitor in the same turn you retire it.

---

## 4 · The standing empty cells — DEEP-AUDIT-VII opens HERE, not with a new charter pass

Two cells the audit named as unexamined are **still unexamined after all 18 fixes landed**, because no fix
touched them:

1. **The browser lane was not booted.** `Dex-Test-Suite.html?full`, `verify-provenance.html` and the
   render-coverage rigs were never run this pass. F2's app-lane work exercised `WORKER_SRC` by source
   extraction in a vm. Every green above is a headless green.
2. **Integrator noisy-OR posterior · `effConf` · Poisson-null / event-coupling surrogate** — **three
   consecutive audits** unexamined. F11 fixed the grouping that feeds it; the arithmetic downstream has never
   had an executed lens. This is the largest unverified surface in the suite and it must be the FIRST finder
   in the next workflow, not the tenth.

---

## 5 · Leads not assigned (cheap first probes)

- **15 of 48 box nights have NO ECG/PPG beat-train overlap** (Osprey, from #2052's un-blinding; formerly
  hidden as "too few beats"). A capture-session fact, not a DSP one. First probe: a per-night span table from
  the raw files. Heron-lane candidate.
- *(Closed while drafting: DEEP-AUDIT-II §12.1's fallen FALSE-POSITIVE row was already re-stamped by #2062 —
  checked in `git show 3411f069`, not assumed.)*
