<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-08-01 · **Created:** 2026-07-22 · Supersedes: none · Follows: INTEGRATOR-OXYDEX-ADAPTER-GAP-2026-07-21-BRIEF.md · **§1 CLOSED + §2 ANSWERED 2026-08-01** · **TRIAGED 2026-09-01 — every section is closed; the two residues are NOT code**

> **TRIAGE 2026-09-01 — verified state, so the next reader does not re-derive it.** §1 CLOSED (the rich export has a committed golden) · §2 ANSWERED, and §2.2's wiring ask RESOLVED 2026-08-20 (the guard exists for every summary that has a reader; a global one would red on someone else's file) · §3 AUDITED + GATED 2026-08-04, structurally and mutation-verified · §4 CLOSED 2026-08-18. **Nothing here is open to code.** Two residues remain and neither is a work-unit:
>
> 1. **Regenerate or delete `OxyDex_2026-07-02_2205_summary.json`** — a gitignored working file >    belonging to whoever generated it (§👥.2: do not step on another session's artifacts). Nothing >    reads it, so it corrupts no analysis; it is only indistinguishable from a live export to the >    next person who globs the directory.
> 2. **§5's gap is real and is DATA-shaped.** Re-verified against the ledger 2026-09-01: both >    `integrator_fusion_2026-06-11/13.json` are `historical: true` — byte-pinned, not code-gated — >    and the only code-gated Integrator fixture is `integrator_tch_golden`, which exercises TCH, >    not fusion. So **no fixture re-runs the Integrator's fusion against a real multi-node night**, >    exactly as §5 states. Closing it means committing a real multi-node night as a code-gated >    fixture, which is a corpus/privacy decision, not an edit.
>
> ⚠️ One number in §5 has drifted: it records `integrator_tch_golden verifiedUnder → 289ab4da91fe`; > the ledger now reads **`48a16810b759`**. The fixture has been re-verified since, which is the > system working — but do not quote §5's hash.

What surfaced while executing `INTEGRATOR-OXYDEX-ADAPTER-GAP-2026-07-21-BRIEF.md` §4.1 that is still owed.
The parent's headline finding was disproven on the real corpus and its two *live* defects (the `n.hb` key
mismatch and the dead `rmssd1Hz` proxy leg) are fixed and gated; everything below is what that work did NOT
close.

## 1 · ~~The parent's §5 is untouched~~ — **CLOSED 2026-08-01: the rich export now has a committed golden**

Carried over verbatim, still true *until 2026-08-01*. The Integrator consumes PpgDex's RICH export (`hrv.time.*`,
`apnea.cvhrIndex`, `recording.site`), but the equiv/GATE-C surface pins only the **light** export
(`compute({text})` → recording + `ganglior_events`). The exact fields the Integrator reads — and the whole
OXYDEX-PULSE-RESOURCING §Phase 2–4 wiring built on them — are exercised only by in-test recompute, so a drift
in the rich export is caught by **no fixture**. Proposal unchanged: commit a rich-export golden + an equiv leg
for the Integrator-facing surface. This is the same class as the parent's own bug — a path nothing pins.

**EXECUTED 2026-08-01.** `uploads/synthetic_ppgdex_rich_golden.node-export.json` is minted from the
**same committed input** as the clean twin (`synthetic_ppgdex_verity.txt`), so the two goldens differ by
`opts.rich` and nothing else — the pair isolates exactly what that flag emits. Registered through
`tools/regen-ppgdex-goldens.mjs` (the sanctioned recorder; no hash was hand-written) and gated by
`ppgdex-dsp · equiv · integrator-facing`, 12 legs:

- **byte-for-byte equivalence** — `compute({text}, {rich:true})` ≡ the golden, volatile keys aside.
- **anti-vacuity**, because the equality alone would pass just as happily if BOTH sides lost the rich
  block — which is the exact failure mode that let this stay unpinned. Each Integrator-read field is
  asserted present and typed: `hrv.time.sdnn` 19.4, `hrv.time.rmssd` 2.1, a named `window`,
  `hrv.frequency`, `hrv.confidence`, `apnea.cvhrIndex` (a **number**; 0 is a measurement, null is not),
  and `recording.site` = `wrist`.
- **control** — the LIGHT export on the same input carries no `hrv` and no `apnea` at all, which is what
  makes this a test of `opts.rich` rather than of the input, and is the leg that would have exposed the
  gap in the first place.

Mutation-verified: suppressing the `if (opts.rich)` block reds **10 of 12** legs. Because the input is
committed, CI re-runs it from committed bytes on every push — the FIXTURE-VERIFICATION-GATE argument for
why a committed twin beats a corpus one. GATE B now covers **15** fixtures (was 14).

## 2 · `hrv.rmssd` is null on 2 of 7 corpus nights — **ANSWERED 2026-08-01: the exports are STALE**

> *Original text: "it may be a legitimate quality gate in `oxydex-dsp.js` or a silent computation failure.
> Trace the OxyDex side and, if it is a gate, record the reason in the export so a consumer can tell
> 'gated' from 'missing'."*

**It is neither hypothesis, and the third option is worse than both.** The two nights differ from each
other, and only one of them is about HRV at all:

**`OxyDex_2026-07-02_2205_summary.json` — a stale export.** It carries `hrv: null` with
`artifact.hrSamplesCleaned: 22083` on a 368-minute night, i.e. essentially **every** HR sample flagged as
artifact, which empties `computeHRV`'s `motion === 0 && !hrArtifact` filter and trips its `n < 120` floor.
So a gate did fire — but re-running **today's** code on the very file that export NAMES
(`nights[0].file` = `O2Ring S 2100_20260702220521.csv`) gives:

| field | in the export | recomputed today |
|---|---|---|
| `hrv.rmssd` | `null` | **0.5** |
| `hrv.n` | `null` | **22013** |
| `stats.minSpo2` | 84 | **87** |
| `stats.durationMin` | 368.4 | 368 |

The export was generated **2026-07-03** and never regenerated after the code that produced it changed.
`t0Ms` also moves by exactly **25 s**, consistent with a `trimSensorWarmup` difference — plausibly the same
change that stopped the artifact cleaner condemning the whole night, though **which commit fixed it is not
established here** and should not be asserted.

Note `minSpo2` 84 → 87: the staleness is not confined to a null. A consumer reading that export sees a
nadir **3 points lower** than the current code computes.

**`oxydex-2026-06-12.summary.json` — a different export SHAPE, not a null value.** Its keys are
`kernel date t0Ms stats odi4 hypoxicBurden comp ganglior_events` — there is no `hrv` field at all, and no
`file` naming its input. It is a reduced/legacy summary, so "`hrv.rmssd` is null" is really "this shape
never carried HRV". Lumping it with the first night hid two unrelated causes under one symptom.

### 2.1 · So the ask changes: not a reason field, a staleness check

Recording "gated" vs "missing" in the export would have been the right fix for the hypothesis, and the
wrong fix for the fact. A reason field cannot help here — the export's `hrv: null` was *correct when
written*; what a consumer cannot tell is that it was written by code that no longer exists.

**`tools/oxydex-export-staleness.mjs`** (committed with this) re-runs OxyDex on each export's own named
source and reports every field that no longer reproduces. It is possible only because each night records
`file` — the tool never guesses a pairing — and it exits 1, so a corpus run can gate on it.

**The class matters more than the two nights.** `GATE B` content-addresses the *committed* fixtures, so
those cannot rot unseen. These `uploads/` exports are **gitignored working artifacts** that corpus
analyses and the Integrator read directly — outside every gate. Any analysis consuming them inherits
whatever the code did on the day they were written, silently. That is the same shape as
`PAPER-ODI4-REPRODUCIBILITY`'s finding one floor down: an unpinned input behind a computed claim.

### 2.2 · What is still owed

- The stale export is a **gitignored working file belonging to whoever generated it** — regenerating it is
  a local action and was NOT done here (§👥.2: don't step on another session's artifacts). Whoever owns
  the corpus should re-run it; the tool says which.
- ~~Wire the staleness check into the corpus-run path, so a stale input reds before an analysis reads it.~~
  **RESOLVED 2026-08-20 — the guard already exists for every summary that HAS a reader, and adding a
  global one would red on someone else's file. See §3.**
- 7 of 8 exports in `uploads/` were skipped because their named source is not on disk. The check is only
  as good as the raw files present, and it says so rather than reporting a clean sweep.

  > **📏 RE-RUN 2026-08-15 WITH THE RAW CORPUS SUPPLIED — 7 skipped becomes 4, and the staleness is
  > ISOLATED.** The tool takes `--raw <dir>`, and the missing sources are on the working volume:
  >
  > ```sh
  > node tools/oxydex-export-staleness.mjs uploads \
  >      --raw "/run/media/michal/647A504F7A50205A/Ecg nightly"
  > ```
  >
  > | | as shipped (no `--raw`) | with the corpus |
  > |---|---|---|
  > | checked | 1 | **4** |
  > | no longer reproduce | 1 | **1** |
  > | skipped, source absent | **7** | **4** |
  >
  > **The three newly-checkable nights all reproduce cleanly** (`2026-06-25`, `2026-06-26`, `2026-07-01`
  > → ✓). So `OxyDex_2026-07-02_2205` remains the **only** stale export in the corpus, and it is stale in
  > the way §2 already characterised (`hrv.rmssd: null → 0.5`, `hrv.n: null → 22013`,
  > `stats.minSpo2: 84 → 87`).
  >
  > **This changes the reading of §2.** With 7 of 8 unverifiable, "one export is stale" was consistent
  > with a systemic problem that happened to be visible on one night. With 4 of 8 verified and 3 of those
  > clean, it is a **single stale artifact**, not a pattern — which is the difference between "regenerate
  > one file" and "distrust the corpus".
  >
  > ⚠️ Four remain unverifiable: their named sources are not in `Ecg nightly/` either. The bound is
  > unchanged in kind, only smaller — the check is still only as good as the files present, and it still
  > says so rather than reporting a clean sweep.

## 3 · `hypoxicBurden` was null for the entire life of the field — check for other renamed-on-export keys

> ### ✅ AUDITED + GATED 2026-08-04 — there is no second `hypoxicBurden`
>
> **The audit §3 asked for, run against the 40 real corpus exports.** Every night-level key
> `adaptOxyDex` reads is emitted by the export builder. The only fields null on **40/40** nights are
> `contentId`, `file`, `provenance` — the three `dexScrubExport` deliberately strips — plus `ecgFusion`
> and `ansAge`, which `oxydex-dsp.js:6259` documents as null when `compute()` runs without a paired ECG
> ("identical to dropping a raw O2Ring file into the app"). All five are correct.
>
> **One near-miss worth recording.** `adaptOxyDex` reads `n.desat`, and **no export carries a `desat`
> key (0 of 40)** — which looks exactly like the original defect. It is not: the line is
> `n.desatProfile || n.desat || null`, a legacy fallback, and `desatProfile` is present on 40/40. A
> key-presence diff alone would have filed this; reading the line is what settled it.
>
> **And the durable half.** §3 asked for an anti-vacuity assertion per field. A corpus-driven one would
> **SKIP wherever `uploads/` is absent — which is CI**, so it would be green precisely where it needs to
> bite. The gate that shipped is **structural** instead: *every night-level key `adaptOxyDex` reads must
> appear as an emitted key in the OxyDex export builder*, plus two pins on the original defect (the
> export still renames `n.hb → hypoxicBurden`; the adapter must **not** read `n.hb`). Corpus-free, runs
> in both lanes. **Mutation-verified**: re-inserting `var _hb = n.hb` into the adapter — the exact
> original defect — reds it.

The defect was structural: the Integrator read OxyDex's **internal** night key (`n.hb`) while the export
renames it (`oxydex-dsp.js:5712 hypoxicBurden: n.hb`). Nothing detected it because `null` is a plausible
value. That rename is unlikely to be the only one — `adaptOxyDex` also reads `n.odi4`, `n.hrv`, `n.stats`,
`n.desatProfile`, `n.hr_spikes`. **Audit every key `adaptOxyDex` reads against what the export builder
actually emits**, and add an anti-vacuity assertion (source-present ⇒ adapted-non-null) per field, the pattern
the §4.3 gate now uses. A field that is *always* null across the whole corpus should be a RED, not a shrug.

## 4 · ✅ CLOSED 2026-08-18 — option (a): the fallback stays, GATED — ~~unreachable-by-construction~~

> ### ✅ EXECUTED 2026-08-18 — the gate exists, and its route-proof is the interesting part
>
> Option (a), deliberately: deleting the branch buys nothing (it is dead weight only until a future
> OxyDex payload fails the predicate, which is exactly when it earns its keep), while an untested
> fallback was §4's own "worst option". The `Integrator OxyDex fallback branch emits the SAME summary
> as adaptOxyDex (ADAPTER-GAP-FOLLOWUPS §4)` group (tests/dex-tests.js, `integrator-dsp`) drives BOTH
> routes through the public `normalizeFile` with identical underlying values — bare payload (fails the
> intercept predicate → fallback) vs the same payload + `hr_spikes: []` (→ adaptOxyDex) — and pins
> `pulseHr1Hz`/`rmssd1Hz`/`hrVarSd1Hz` equal, plus null-on-absent for both routes (§2.6's rule).
>
> **The route-proof is built on the one measured divergence.** adaptOxyDex guards
> `isFinite(stats.meanHr)`; the fallback `_dig`s it raw. A `meanHr: Infinity` payload therefore
> surfaces Infinity ONLY through the fallback — so that assertion doubles as proof the bare payload
> really took the fallback route. If a future edit widens the intercept predicate, it reds, and §4's
> decision must be re-made deliberately instead of decaying silently into adaptOxyDex-vs-itself
> (a vacuous reconcile). The divergence itself is left in place ON PURPOSE: fixing it means editing
> `integrator-dsp.js`, which moves 5 manifestHashes + computeHash + a corpus re-verification — not a
> price a dead branch's cosmetics justifies, and the gate makes the asymmetry visible instead of latent.
>
> Mutation-verified both ways: fallback reading `hrv.sdnn` instead of `hrv.rmssd` → 7 assertions red;
> fallback fabricating `|| 0` for absent stats → 3 red.


`normalizeFile`'s predicate cannot miss any OxyDex shape, so that branch is dead for OxyDex today. It was left
in place, reconciled and commented, as the fallback for a future payload that fails the predicate. Decide
deliberately: either (a) keep it as the fallback and add a gate asserting the two paths emit an identical
summary for a *hand-built* OxyDex-shaped payload that deliberately lacks `nights`/`hr_spikes`, or (b) delete
it and route unconditionally. Leaving an untested fallback is the third option and the worst one.

## 5 · The `computeHash` re-verification was corpus-local

`DEX_UPLOADS=… node tools/verify-fixtures.mjs` re-stamped `integrator_tch_golden` `verifiedUnder` →
`289ab4da91fe` on the author's machine. The two `integrator_fusion_*` fixtures are `historical: true`
(byte-pinned, not code-gated) so they were correctly exempt — but that also means **no fixture anywhere
re-runs the Integrator's fusion against a real multi-node night**. Same gap as §1, one level up.

## Cross-references
- Parent: `INTEGRATOR-OXYDEX-ADAPTER-GAP-2026-07-21-BRIEF.md` (DONE 2026-07-22).
- Grandparent: `OXYDEX-PULSE-RESOURCING-2026-07-18-BRIEF.md` (DONE 2026-07-20) — §Phase 3 shipped the proxy
  leg this work found dead; its own follow-up (`OXYDEX-PULSE-RESOURCING-FOLLOWUPS-2026-07-20-BRIEF.md`) still
  tracks the corpus-gated `emerging → validated` re-tier.
- Code: `integrator-dsp.js` `adaptOxyDex` summary literal + the generic `node === 'OxyDex'` branch;
  `oxydex-dsp.js:5712` (the `hb` → `hypoxicBurden` export rename).

---

## 3 · The staleness wiring, resolved by finding out who actually reads these (2026-08-20)

§2.2 asked to *"wire the staleness check into the corpus-run path"*. Before wiring a guard, the question
is which artifacts have a consumer — a guard over a path nobody walks is the hollow-gate pattern.

**Five `OxyDex_*_summary.json` sit in `uploads/`. Exactly two are read by anything in the tree:**

| summary | read by | already guarded? |
|---|---|---|
| `_2026-06-13_1056` | `tests/run-tests.mjs:847` — the **equiv gate**, paired to `O2Ring S 2100_20260612230016.csv` | **YES** |
| `_2026-06-25_0439` | `tests/run-tests.mjs:852` — the equiv gate, paired to `O2Ring S 2100_20260624222730.csv` | **YES** |
| `_2026-06-27_0745` · `_2026-07-01_2143` · `_2026-07-02_2205` | nothing | n/a — no reader |

The equiv/GATE-C leg **re-runs `compute()` on the export's own named raw source and compares**, which is
precisely the check §2.2 asks for. It already covers both summaries that have a consumer, and it runs on
every suite pass where the corpus is present. `integrator-dsp.js` and `overdex-app.js` mention
`_summary.json` only in **comments** (an adapter-naming note), not as a corpus read.

⚠️ **So a global staleness gate is deliberately NOT added, and the reason is §👥.2.** These are
**gitignored working artifacts belonging to whoever generated them**. Wiring the check into `npm run
check` would turn another session's un-regenerated local file into a RED gate for everyone who happens
to hold it — breaking a shared gate over a file the failing session does not own and cannot be expected
to have. The check stays a tool you run against a corpus you own, which is what its own header says
(*"Exit 1 if any export fails to reproduce, so this can gate a corpus run"* — a corpus run, not the
fleet gate).

### 3.1 · Re-measured, and the 2026-08-15 numbers reproduce exactly

```sh
node tools/oxydex-export-staleness.mjs uploads \
     --raw "/run/media/michal/647A504F7A50205A/Ecg nightly"
```

**4 checked · 1 no longer reproduces · 4 skipped** — identical to the table above, five days on. The
staleness is **stable and isolated to one file**, `OxyDex_2026-07-02_2205_summary.json`, with the same
four deltas (`hrv.rmssd null → 0.5`, `hrv.n null → 22013`, `durationMin 368.4 → 368`,
`minSpo2 84 → 87`). Without `--raw` only 1 night is checkable, so the bare invocation under-reports by
4× — quote the flag with the number.

The tool is also already swept by `tools/selftest-all.mjs` (57 tools), so its own logic is gated even
though its corpus run cannot be.

⚠️ **`REAL_EXIT=1` — verified without a pipe.** Read through `| tail`, the same run reports `EXIT=0`,
because `$?` is then **tail's** status (CLAUDE.md §👥.4b). The tool's exit code is correct; a first pass
here nearly recorded a defect that did not exist.

**Still owed, and it is a local action for whoever owns the corpus, unchanged from §2.2:** regenerate
`OxyDex_2026-07-02_2205_summary.json`, or delete it. Nothing reads it today, so it is not corrupting an
analysis — but it is indistinguishable from a live export to the next person who globs the directory.
