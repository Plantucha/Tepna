<!--
  EXPORT-PATH-UNREACHABLE-FOLLOWUPS-II-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-01 · **Created:** 2026-08-01 · **Follows:** `EXPORT-PATH-UNREACHABLE-FOLLOWUPS-2026-08-01-BRIEF.md` · **Affects:** `overdex-app.js`, `OverDex.src.html`

# OverDex advertised an adapter it could not feed and a node it never booted.

`OverDex.html` lists **nine** adapters in its own UI, `resmed-edf` among them. Drop a ResMed night on
it and every file routed correctly — and then died:

> `20260726_210819_BRP.edf` → *"unusable frame: resmed-edf: EDF is binary + multi-file — pass
> `ctx.buffers=[{name,buffer}]` (raw) or `ctx.edfSets` (pre-decoded); the text argument is not used"*

Two independent gaps, stacked. Neither is in the adapter, which documents its own contract precisely
and has been correct since it was written three weeks ago.

## 1 · OverDex read every file as text, so a binary adapter could never be fed

`ingest()` called `readText(f)` on everything. EDF is bytes. The adapter's escape hatch —
`ctx.buffers`, the same mechanism `oxydex-spo2` uses for `ctx.parseCSV` and `polar-h10-ecg` for
`ctx.companions` — was never populated by anyone.

Fixed by reading bytes **alongside** text, and only for files that could plausibly want them
(`wantsBytes()` → `/\.edf$/i`). Text is still read for every file: `classify()`'s head sniff and the
adapter registry both need it, and a byte read that fails resolves `null` rather than failing the
classify.

**One night is one EDF SET, so the adapter runs ONCE.** A ResMed night is five files per session
(`BRP`/`PLD`/`SA2` + `EVE`/`CSL`) that the adapter groups by its own §F4 session rule. Running
per-file would re-decode the same night N times and hand the Integrator N duplicate exports to
dedupe. So the cpap branch collects every dropped EDF's bytes, runs once, and marks the rest:

> `20260726_210819_PLD.edf` → CPAPDex · *folded into the CPAP session run above (one night = one EDF set)*

Marked, not blanked — **a file that was consumed must say so**. Silence in a manifest reads as "not
handled", which is the failure this whole brief family is about.

## 2 · The node behind the advertised adapter was never in the realm

With bytes flowing, the run reached the emitter and died differently:

> `CPAPDex namespaced DSP not found on host — set window.__DEX_NAMESPACED__=true and load
> cpapdex-dsp.js (with kernel-constants.js) before using this module`

`signal-orchestrate.js` already had **all** of it — `cpapHost()`, `emitCpapNodeExport()`, `cpap` in
`_HOSTS`, gated on `canEmit('cpap')`. The `__DEX_NAMESPACED__` co-load block in `OverDex.src.html`
lists oxydex · hrvdex · pulsedex · glucodex · ppgdex · ecgdex — **and not cpapdex**. The orchestration
was complete and the realm was one script short.

Added `cpapdex-edf.js` (the binary reader the adapter references by name as `root.CpapEdf`),
`cpapdex-dsp.js` (an IIFE that leaks nothing bare, so it co-exists with `integrator-dsp`'s globals),
and `cpapdex-fusion.js` (`cpapBuildExport` — the SAME builder the CPAPDex app's own export uses).

**Result on the real night** (2026-07-26, ten ResMed EDFs): `CPAPDex · 2026-07-26 · 29 events`,
fused. Previously: nothing at all.

---

## 3 · RECORDED, NOT RESOLVED — the two ingest paths disagree by one session

Same ten files, two paths, two answers:

| path | window start | events |
|---|---|---|
| CPAPDex app (its own binary ingest) | `1785100099000` = **21:08:19** | **28** |
| OverDex → `resmed-edf` §F4 grouping | `1785099745000` = **21:02:25** | **29** |

Both end at `1785126259000`. The gap is **354 s at the FRONT**: OverDex includes the short
`210217/210225` session that the app's own ingest excludes, and that session carries the 29th event.

**This is pre-existing and was not introduced here** — it could not have been observed before, because
the OverDex path did not run at all. It is the same shape as everything else in this brief family:
**two implementations of one ingest, differing quietly.** It matters beyond a count — therapy hours and
the AHI denominator both move with the session set.

**Deliberately not resolved here.** Deciding which grouping is right is a CPAPDex-scoring question
(does a ~6-minute mask-on session count as therapy?), it needs the real corpus rather than one night,
and it belongs with whoever owns `cpapdex-dsp.js`'s session rule. Picking a side from a single night is
the error `POOLED-CLOCK-FIT` §8.5 refused and `…-FOLLOWUPS` §3.1 just repeated in miniature.

## 4 · The Data Unifier has the same missing co-load

`Data Unifier.src.html` carries the identical `__DEX_NAMESPACED__` block, also without cpapdex. Left
alone in this unit — it is a sibling orchestrator with its own ingest surface, and #634 landed in it
hours ago. Fixing one and not the other is exactly how the two drift, so it is recorded here as owed
rather than forgotten.

## 5 · Done when

- [x] A dropped ResMed EDF set reaches CPAPDex through OverDex and fuses (**29 events**, was
      *"unusable frame"*).
- [x] The set is decoded **once**; every other file in it is marked folded, never silently dropped.
- [x] Bytes are read only for files that want them; a failed byte read cannot break the text classify.
- [x] The app-vs-OverDex session divergence measured and stated with both timestamps, not hand-waved.
- [ ] *(owed)* The same co-load for `Data Unifier.src.html`.
- [ ] *(owed, CPAPDex-scoped)* One session-grouping rule, decided on the corpus.
