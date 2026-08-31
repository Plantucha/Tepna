<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living audit charter) · **last-verified:** 2026-07-18 · **Audience:** an AI agent (or human) doing a deep correctness audit of the Tepna Dex suite

# Deep-audit prompt — Tepna Dex suite

> **Paste the “MISSION” block below to start an auditor.** The rest of this file is the reference it
> reads. This is tuned to *this* codebase: a generic “review my code” pass wastes effort here.
>
> **Auditing the TESTS instead of the code?** Use the sibling charter `audits/TEST-AUDIT-PROMPT.md` — it
> hunts *gates that stay green under a real defect* (mutation-testing lens), the orthogonal axis to this
> one. This file finds wrong numbers; that one finds gates that would let a wrong number through.

---

## MISSION (paste this)

You are auditing the **Tepna Dex suite** — browser-based, 100%-offline physiological-signal analyzers
that compute **health metrics**. Your job is to find **real defects**, prioritizing the **“plausible but
wrong”** class: a number that looks reasonable but is silently incorrect. In this domain a wrong number is
the worst possible outcome, worse than a crash — so weight correctness over everything.

**VERIFY, DON’T TRUST.** Every finding must carry a **reproduction**: a failing assertion you added to
`tests/dex-tests.js`, an input that triggers the bug, or a re-run whose diff proves it. A claim without a
reproduction is a *hypothesis*, not a finding — label it as such.

**Method (play to an AI’s strengths):** state an **invariant** and hunt **counterexamples** — do not read
line-by-line hoping to spot a typo. Prefer **differential** (compare two paths that must agree),
**metamorphic** (transform the input in a way the output must respect), and **adversarial-input**
reasoning. Trace at least one **real recording end-to-end** (raw file → parse → `SignalFrame` → `compute()`
→ export → Integrator fusion) and inspect every boundary’s **units, clock, and null-handling**.

**Start one hop EARLIER than feels necessary.** The trace above begins at "raw file" — but something *wrote*
that file. Read `capture-host/` (the writer) alongside the adapter that parses it, and ask whether the file's
**shape honestly reflects the hardware**. A whole defect class lives only in that seam and is invisible to any
amount of in-suite checking (see bug class 11).

**A comment is not a measurement. A brief marked DONE is not a measurement.** In this repo a code comment
describing a defect, a `Status: DONE` header, and observed behaviour are three different things, and only the
third is evidence. Comments describing *already-fixed* bugs are common here — one is a post-fix regression
note that reads exactly like a live defect report. Before acting on any defect claim you did not execute
yourself, execute it. (Precedent: a 29-agent verification pass found **6 of 14** candidate findings did not
survive execution.)

**Verify the MECHANISM, not the correlation.** When an experiment shows that changing X moves output Y, trace
*how* before concluding what it means — otherwise you will credit a defect as a feature. Real precedent:
adding a gyro stream measurably changed MotionDex's body-position output, which was recorded as "gyro
contributes to a metric". It does not: gyro reaches no positional code path, and the only thing it changed
was a shared `durSec` denominator that then diluted the result with sample-less epochs. The experiment was
sound; the interpretation inverted a bug into a feature.

**Before you start:** read `ORIENTATION.md` (the map) and `CLAUDE.md` (the constitution — it wins on every
conflict). Then establish a **green baseline**: open `Dex-Test-Suite.html?full` (render-coverage is
**on-demand** — `?full` or the **▶** button boots the rigs; a bare open paints only the headless floor
and reads amber, **NOT a pass**. Wait for the `#summary` pill to read all-green after the group count
stops climbing, ~30–50 s) and `verify-provenance.html` (read `window.__provenanceOK`). **If either gate is red before you touch anything, that is finding #1.** Skim
`DOCS-INDEX.md` for open briefs (known residue) and the **“Out of scope” list below** so you don’t file
known/intentional behavior.

Deliver findings in the format under **“Reporting”** below. Do not fix in a sweep — propose one gated change
at a time.

---

## The bug classes worth hunting (highest yield first — these are what this suite actually fears)

1. **Units / dimensional slips — the #1 fear.** A `ms`-vs-`s`, `mg/dL`-vs-`mmol/L`, or `bpm`-vs-`Hz` slip
   yields a *plausible-but-10³–10⁶×-wrong* value. Do a **dimensional pass at every I/O boundary**: does the
   value entering a formula carry the unit the formula assumes? Flag any metric-vs-metric arithmetic that
   adds incompatible units. **Canonical example to pattern-match:** the Baevsky SI/CSI guard
   (`hrvdex-dsp.js`, `DexUnits.guardBaevsky`) — look for *un-guarded siblings* that read a vendor column and
   assume a unit. Also: metric is the canonical system (store/compute in SI; imperial is display-only) —
   flag any persisted imperial value or math done in imperial.

2. **The Clock Contract** (`CLAUDE.md` §Clock Contract). Canonical unit is *floating wall-clock* `tMs =
   Date.UTC(...)`, read back **only** via `getUTC*`; a missing stamp → `null`, **never** `now()`. Hunt:
   any `getHours()/getMonth()/getDate()` (non-UTC) on a `tMs`; any `new Date(str)`/`Date.parse` on a vendor
   string (must be explicit regex); any fallback to `new Date()`/`now()` for a missing stamp; **viewer-
   timezone dependence** (re-render under a changed `TZ` → must be identical); **negative `spanDays`**; an
   overnight 22:00→06:00 that jumps ~24 h instead of ~8 h; DMY-vs-MDY mis-disambiguation.

3. **Fabricated absence — a guess in a measurement’s clothes.** A missing input must surface as
   `null`/`usable:false`+`reason`, never as a number. Hunt: any composite that **seeds an input to `0`/a
   default and then computes a plausible value** (the zero-default-composite class — e.g. a welfare/EFC score
   that evaluates to `0` on a raw recording because its subjective inputs were `0`, not absent); any `|| 0` /
   `?? default` / default-profile substitution that converts ABSENCE into a value. Gate composites on “inputs
   *present*”, not “inputs `!= null`”.
   **3a — the per-epoch SERIES variant (the one that keeps recurring).** A time-series that feeds a fusion
   must be **TRI-STATE** — `true` / `false` / **`null` = the sensor was not recording** — and null epochs must
   leave the **DENOMINATOR**, not just the numerator. This variant is nastier than the classic form because
   nothing looks null: the epoch returns a perfectly plausible measurement. Ask of every series: *what does
   this field say when the sensor was off?* If that equals a real reading, it is wrong. Instances found so
   far, all the same shape: `EVENT-COUPLING` §2's ×0.72 artifact (apneas during oximeter downtime scored as
   MISSES); MotionDex `actigraphy()` scoring an epoch with **zero ACC samples** as `counts=0 → moving=false
   → immobile` (a recording gap fabricating *stillness*, which then inflated a motion-gated HRV confidence);
   and the effort/posture series feeding apnea typing, where “no chest-ACC” must read UNTYPED, never CENTRAL.
   Consequence in each case is a **manufactured clinical finding**, so treat it as top severity.

4. **Silent fallbacks.** A failure that degrades quietly instead of reddening is worse than a crash. Hunt:
   `catch{}` that swallows; a parse failure that returns an empty/default result instead of
   `{usable:false,reason}`; a gate that falls back instead of failing (the `FIXPROV=null`-silently-falls-back
   precedent that was fixed). Every degrade should be **visible** (a `reason`, a warn, a red).

5. **Differential drift across the redundant HRV paths.** PulseDex, ECGDex, HRVDex (and PpgDex) all derive
   HRV — feed the **same RR/beat truth** through two paths and assert `rMSSD`/`SDNN` agree within tolerance.
   A divergence = an estimator or threshold drift (the real `SDNN` `÷N` vs `÷N−1` bug the differential oracle
   caught). Check `std()`, the spectral path, and artifact-rejection bounds are consistent where they must be
   — and *intentionally per-signal* where the code documents it (don’t “unify” a deliberate difference).

6. **Spectral honesty.** Confirm no *surfaced* spectral value uses a crude proxy (e.g. `hf ≈ rmssd²`) instead
   of the real Lomb–Scargle path; ambiguity on a surfaced frequency-domain number is a real risk.

7. **Evidence honesty** (`CLAUDE.md` §Evidence badges). EVERY surfaced number carries an evidence badge — a
   bare KPI/metric/chart-series/table-row is a **bug** of the same severity as a wrong unit. A **derived/
   black-box input** (Welltory’s proprietary Stress/Energy/Focus/Coherence) must read **lower-tier**
   (heuristic/experimental), never “measured”; a node must stand on its raw math when those inputs are absent.
   Hunt: an unbadged number; a `heuristic`-tier value sitting in the headline grid; a composite built on
   proprietary inputs graded as if measured.

8. **Cross-node contract drift.** The `ganglior.node-export` JSON is the *only* seam (nodes never import each
   other). Hunt: a node that drops a field a consumer (the Integrator / `crossnight-envelope.js`) reads; a
   change that claims to be additive but broke an old shape; the Integrator mis-reading or silently dropping a
   node it doesn’t recognize. Contracts live in `tests/dex-tests.js` — they are the public surface.

9. **Provenance integrity.** `manifestHash` is the executed-code identity; each `FIXTURE-PROVENANCE.json`
   fixture is a content-addressed known-answer (`hash(input)+manifestHash→hash(output)`). Hunt: a committed
   fixture the **current code no longer reproduces** (run the Dex-Test-Suite equiv gate — `env.equiv.*` re-runs
   `compute({input}) ≡ committed export`); a `BUILD-MANIFEST.json` drift; a hand-edited fixture (the gate
   forbids hand-editing).

10. **DSP edge cases — your strength; the equiv fixtures are all ~6-min clips, so large/odd inputs are
    under-tested.** Feed adversarial inputs and check graceful, honest handling: an electrode-settling
    multi-kµV transient (ECG R-peak seed/stall — does detection recover, or silently collapse to <1 min of a
    7 h night?); all-zero HR; a header-only / stamp-less file; a clipped CGM (Abbott Lingo clamps 55–200
    mg/dL — are clip-floor hypos flagged, not counted as real?); a mixed-device folder (does routing set
    aside foreign streams, or analyze a magnetometer file as ECG?); a ≥7 h overnight (full-coverage, no
    silent truncation); `O(N²)` paths (sampEn caps) on a long record.

11. **Fabricated redundancy — a consensus statistic over inputs that are not independent.** *(Added
    2026-07-18: this class was missed by a 16-hunter audit that was explicitly hunting evidence honesty.)*
    Any statistic whose meaning is **agreement** — n-of-m consensus, channel agreement, inter-estimator
    concordance, cross-validation between two paths — is honest **only if its inputs are independent**. When
    an upstream producer replicates one source into many, the statistic measures a value against *itself*,
    renders as a perfect score, and is graded `measured`. **Hunt:** any `nAgree` / `agreementPct` /
    `nOf3` / `consensus*` / `concordance` metric — then go **upstream of the file** and confirm the channels
    are physically distinct. Check the honest early-return (`nCh < 2` and friends) actually fires for
    degenerate input. **Canonical example:** `capture-host/capture.py` writes the O2Ring's single-photodiode
    pleth as `write_ppg(ph, ns, 0.0, (v, v, v), 0)` — one 8-bit sample replicated across three PSL channels
    — so `ppgdex-dsp.js consensusBeats` sees `nCh = 3`, never takes its `nCh < 2` return, and reports
    `ledAgreementPct: 100` at **`measured`** tier across five surfaces, for hardware that has one photodiode.
    ⚠️ **Why the badge sweep cannot find this:** the number *is* badged and its tier *does* match the
    registry. What is false is the registry's own claim. Checking badge-vs-registry consistency will report
    green forever. You must read the producer.

12. **Filename-derived semantics — unanchored regexes over names.** A surprising amount of meaning is
    extracted from *filenames* (date, device id, stream kind, night grouping), and a regex that is correct
    on a synthetic name silently matches the wrong digits on a real one. **Hunt:** every regex applied to a
    filename — is it **anchored**? Execute it against **real corpus names**, not invented ones. **Canonical
    example:** `signal-orchestrate.js:397` `fnameStampMs` is unanchored, so on
    `Polar_H10_02849638_20260617_010616_ACC.txt` it matches the **8-digit device serial** before the date
    and returns year 0292 — collapsing two nights three days apart to an identical stamp and silently
    disabling a nearest-stamp tiebreak. Device-shape-dependent: the Verity id contains letters and parses
    fine, so a single-device test proves nothing. **Note the anchored sibling one file over
    (`dex-ingest.js:42-47`) — see class 14.**

13. **The missing instance — what ISN'T there.** A per-file sweep is structurally blind to an *absent*
    one: you cannot grep for the cross-night envelope a node never emits, the regen tool that was never
    written, or the registry entry a rendered number lacks. **Hunt by building a matrix** — every node in
    the roster × every cross-cutting surface (crossnight envelope · `tools/regen-<node>-goldens.mjs` ·
    registry entry per surfaced metric · equiv/GATE-C leg · render-coverage rig · adapter) — **and report
    the empty cells.** Precedent: three nodes emit no crossnight envelope; MotionDex has no regen tool and
    no registry entry for a number it renders; four surfaces have zero behavioural coverage. Each was found
    by enumeration, none by reading code.

14. **Sibling divergence — the in-repo precedent is your fix AND your proof.** This is a fleet of near-clone
    nodes, so almost every function has 3–8 siblings doing the same job. **When you find a defect, grep the
    siblings immediately: if they differ, one of them is wrong, and if one is right you have a correct
    implementation to port plus proof the fix is achievable.** Conversely a lone divergent implementation is
    itself a strong lead. **Canonical examples:** PpgDex derives `fs` from the **median** sensor-ns delta
    (correct) while ECGDex infers it from a **single** ms delta (parses 130 Hz as 143/167) — the fix is a
    port, not a design. `dex-ingest.js` anchors its filename stamp regex; `signal-orchestrate.js` does not.
    `actigraphy` got a coverage fix (`3e9792f`) that `bodyPosition` never received. `d_pns_eff` gates
    `_pnn50 >= 1`; its neighbour `d_otr` gates `>= 0` and `null >= 0` is `true`. **A divergence between
    siblings is the single highest-yield grep in this codebase.**

15. **The label that does not travel with its number — an artifact authoritative in FORM, unkeyed to its
    CONTENT.** *(Added 2026-08-17 after four independent instances in ONE day, across four sessions.)* A
    wrong value is survivable: it looks wrong, or it looks like nothing. **A wrong *label* on a right value
    is not**, because it converts a search into a **confident wrong search** — absence makes you look, a
    wrong pointer makes you *stop* looking. Hunt any place a **measurement** is printed beside a
    **reference, unit, device, corpus, path or hash** that is **not selected by the same variable**.
    **Measured instances:** `ppi-jitter-vs-ecg.mjs` labelled its device correctly at the top of the output
    and printed `[Verity wrist reference: 5.92 ms]` at the bottom while defaulting to `--device o2ring` —
    read through `| tail -20`, the top label was discarded, a **finger** median was compared to a **wrist**
    reference, and the conclusion **inverted** (a written-up "non-reproduction" was actually the Verity
    beating its own reference, 4.98 vs 5.92 ms at a 100 % beat-match rate) · `tools/build-docs.mjs` printed
    a `git add` remediation of **nine paths, zero of which had changed**, omitting the one file it had just
    rewritten · `tools/rebase-safe.mjs` printed **`verDex.html`** for `OverDex.html` — a remediation naming
    a path that does not exist (a `.trim()` on porcelain) · after a rebase, `provenance/*.json` takes
    main's copy wholesale, so a **`verifiedUnder` you just earned silently reverts to an unproven claim**
    with the file's shape unchanged and every gate green.
    **Three properties make this class expensive:**
    (a) **A label at the top does not protect a number at the bottom.** Summaries are read through `tail`,
    `grep`, and a glance at the last block, so a correct header is routinely discarded by the reader — this
    class and `CLAUDE.md` §👥.4b's truncation trap **compose**, and each alone is survivable.
    (b) **It survives self-review by construction** — the wrong label *is* the thing you would check
    against. The 2026-08-17 instance was caught only when a **peer challenged a number already written into
    a brief**; no gate, no re-read and no amount of care by the author would have surfaced it.
    **And it PROPAGATES, because a summary is the natural reading surface.** Reviewers read PR bodies,
    headers and abstracts rather than files — so an unkeyed summary hands the wrong label to everyone
    downstream, and they reason from it correctly. Measured, inside the change that added this class: a PR
    body compressed this very entry's hunt section to a parenthetical, and a peer — who had spent that day
    telling three sessions to check the artifact rather than the label — proposed adding a recipe **already
    present in the file**. Neither author nor reviewer was careless; both read a surface. **The only defence
    is mechanical: before acting on any summary of an artifact, open the artifact** — `git show
    HEAD:<file> | grep -n <the claim>`. That single habit caught the instance above; nothing else did.
    (c) **It is not the same as a stale value.** The form is intact, so integrity checks, schema checks and
    diffs all pass; only the *binding between label and value* is broken, and nothing in this repo checks
    bindings.
    **How to hunt:** grep tools for format strings holding a **hardcoded** device/unit/corpus next to an
    **interpolated** value; check every remediation line (`git add …`, "now run X") against
    `git status --porcelain` or the filesystem rather than believing it; after any rebase re-verify fields
    whose form is stable but whose content is authoritative (`verifiedUnder`, `manifestHash`, fixture
    hashes) with `git show HEAD:<file> | grep -c <identifier>`; and ask of any report **"if this were
    truncated to its last 20 lines, would a number lose its qualifier?"**
    **DISTANCE IS THE RISK, and it is the one criterion you can measure mechanically.** A label three
    lines above its number survives; the same label at the top of a 40-line report does not, because
    readers arrive by `tail`, by `grep`, or by a glance at the last block — so **flag any header naming a
    mode, device, corpus or unit that sits more than a screenful above the numbers keyed to it**, even
    when it is correct today. That distance is what turns a right label into a wrong one at the moment
    someone truncates, which makes it a defect *before* it has produced a wrong answer.
    **The fix is always the same and it is not 'add a label':** make the label **travel with the number** —
    repeat the device/unit/corpus on the line carrying the value, select the reference by the same variable
    as the measurement, and if a reference cannot be keyed that way, **do not print it**.
    **NOT to be confused with its sibling family, which is already named canonically — see
    `CLAUDE.md` §👥.4b: *"the check ran, and reported success about something it never examined."*** That
    is about **execution paths** (a truncated verdict, a pipeline exit code, a `grep -q`, an `npx` no-op,
    a `-k` filter matching nothing); this class is about **labels**. Deliberately kept as a pointer rather
    than restated — a second copy would drift from the first, and §👥.4b is the better statement. **When
    auditing, note that §👥.4b's own examples are all commands, while the same shape reaches further:** a
    **parameter** (a correct guard whose only caller omits the argument that switches it on, so it never
    fires) and an **identifier** (four functions whose names agree and whose jobs differ, so a grep
    over-reports a capability that does not exist) are the same defect off the command line. The check
    that covers both: **ask who calls it and with what arguments — never whether the name appears.**

---

## ⚡ PROVEN 2026-08-31 — six classes, each with a receipt

Added because each was found *and fixed* on one day, so an auditor can pattern-match against a real
instance rather than an abstraction. **The receipts are the point**: every claim below names the PR that
proved it.

**A · The hollow-pinned oracle — a test that asserts the bug.** `cpap_stream.py` registered
`PatientFlow` as `L/min` for `L/s` data, and
`test_registers_both_channels_and_pushes_each_batch` **asserted the buggy `"L/min"`**. The test was not
missing; it was *defending* the defect, so every run was green and the pin was the thing to fix (#2009).
**Hunt:** a constant asserted in a test and nowhere derived. Ask *what would this test say if the code
were right?* — if the answer is "it would fail", the oracle is hollow.

**B · Two representations, one tested.** The same physical channel existed on the bus and in the EDF
writer. The EDF side was tested to be `L/s` (`test_cpap_edf.py:62`); the bus side had **no** unit test at
all, so the two disagreed silently (#2009). **Hunt:** any value with two encodings — bus/file,
export/render, registry/crossnight. **Fix shape: a DIFFERENTIAL oracle** (`assert bus_unit == edf_unit`),
which needs no third source of truth and fails loudly the moment they part.

**C · The instrument that cannot see — a parse failure rendered as a clean zero.** `loadSurvivors`
parsed NDJSON only; handed a pretty-printed `.sweep.json` every line threw, `catch { continue }` swallowed
all of them, and the empty map printed **"0 with a SURVIVING mutant"** — a total failure reported as an
all-clear by the tool whose job is finding promises nothing checks (#2008). Siblings the same week:
`clean_run_seconds` captured pytest's output and discarded it, so a refusal named no test (#1995) and
then named it without the body (#1997). **Hunt:** every `catch {}` that continues; every `|| []` /
`|| {}` default on parsed input; every count that could be zero because *nothing was examined*.
**Fix shape: REFUSE on an empty result** — "no findings" and "nothing loaded" are indistinguishable to a
caller and only one is an answer.

**D · A status field is not a verdict.** `canary: STALE` on a sweep means **unguarded**, not **wrong**. A
re-sweep of `clock.js` reproduced the "stale" data almost exactly — 145 killed vs 144, 33 of 34 survivor
lines identical, zero new survivors — and still reported `STALE`, because re-running does not re-learn a
canary (#2008). `mutate.mjs` states the rule the field must be read against: *a high kill rate is its own
positive control; a low one is not.* **Hunt:** any decision taken off a status/flag field without reading
what the field's owner says it means. Two siblings from the same day: *a tool exists* ≠ *it works*
(#2008), and *a gate is RED* ≠ *it found something* — `REFUSING` meant **could not measure** on #1954/#1959,
where no survivor list ever existed (#2005).

**E · The gate that cannot see the thing it guards.** `mutation-source-scan` flagged a line only if it
carried a quoted module filename, so `inspect.getsource(capture)` — the most natural way to write the
offence — was invisible; and its `SANCTIONED` exemption was checked **per FILE**, so one routed read
anywhere cleared every other read in the largest test file (#1982). Root cause of the same outage:
`_all_scripts()` walked mutmut's generated `mutants/`, seeing 48 shell scripts where the tree has 24
(#1998). **Hunt:** a guard whose matcher is narrower than the property it names, and any file-walk that
does not exclude generated trees.

**F · A brief marked DONE with a diagnosed defect still open.** `CPAP-EDF-WRITER-FOLLOWUPS §1` diagnosed
the `L/min` label and the fix was never a Done-when item; the brief went DONE without it (#2009). The
inverse also runs: three briefs described work as pending that was already built — one of them
(`MUTATION-PROGRAM-FOLLOWUPS §6`) told the reader to build an optimisation that exists and is
**quarantined for fabricating SURVIVED findings** (#2002, #1994, #2005). **Hunt:** cross-check a DONE
header against its own Done-when list, and any "worth building" item against `tools/` **by concept, not
by name** — the tool that answered one of these was called `guarantees.mjs`, matching no search for
"mutation".

---

## How to verify (use these — don’t eyeball)

- **Contracts-as-tests:** `tests/dex-tests.js` (one assertion lib, two runners — `node tests/run-tests.mjs`
  + `Dex-Test-Suite.html`). **Add a failing assertion to PROVE a finding**, then it becomes a regression gate.
- **🔴 VERIFY YOUR OWN SWEEP BEFORE YOU BELIEVE IT — a clean report is a claim about a SET, and you have not
  checked the set.** Any script you write to audit the tree is itself unaudited code, and it fails in two
  directions that need opposite responses. Measured 2026-08-17, same tool, ten minutes apart: v1 flagged
  **~100** unsurfaced metrics because it matched ids and the alias table but not each entry's own `label:`
  field (rendering here is *"zero-touch … auto-wired by label"*), and v2 then reported **`0 missing`** for a
  node whose entry-block regex had captured **16** of its entries — the metric under investigation was
  never examined. **The over-report announced itself; the `0` looked exactly like success.** So:
  **(1) PRINT THE DENOMINATOR on every run** — "checked N of M" — because a filter matching nothing, a
  parser capturing a fraction, and a genuinely clean tree all print the same `0`.
  **(2) ANCHOR ON A QUANTITY WHOSE CORRECT VALUE YOU KNOW INDEPENDENTLY OF THE CODE.** A sibling session's
  tap detector read x/y/z by **column position** without reading the header; what actually validated the
  choice was that baseline magnitude came out **998 and 1023 mg — 1 g**. Wrong columns, no gravity. A
  physical constant, a known total, a conserved sum: prefer the check the data can fail. A registry count
  has no such anchor, which is why `100`-vs-`24` was the only tell available and `0` had none.
  **(2b) AND CHECK YOUR WORLD, NOT ONLY YOUR QUERY — `git rev-list --count HEAD..origin/main`, one
  second, before any measurement you intend to report.** A correct query against a stale tree returns a
  confident wrong answer that nothing inside the result can reveal. Measured 2026-08-17: the shared root
  checkout was **267 commits behind** with **180 dirty paths** — and it had been **255** behind twenty
  minutes earlier, so the drift is not a state but a **rate**. Three individually-correct things compose
  into it: the sync timer **refuses to sync over uncommitted work** (right — clobbering a peer's only copy
  is the worse failure); in a checkout several sessions share **something is always dirty**, so the refusal
  is permanent rather than occasional; and its skip exits 2, mapped to `SuccessExitStatus`, so the unit is
  green and the journal shows successful runs. **No component is wrong and the failure is unbounded.**
  It produced **six** wrong answers across two sessions in one afternoon — a "9 stale `verifiedUnder`"
  report whose true value was 0 stale / 14 current, a tool declared to lack a flag it has, a field declared
  unwired that was wired. **The structural fix is to never measure in the shared root:**
  `git worktree add ../wt-<task> origin/main` is current by construction — which is why PR work never hit
  this and only *investigations* did.
  **(3) PREFER AN EXPLICIT ALLOWED-LIST TO A BARE ZERO.** `capture-host/find_unwired.py` reports
  **`0 unexplained, 10 allowed`** with a written reason per allowance — the allowed-list is what makes the
  zero mean something, because it distinguishes *nothing found* from *nothing looked at*.
- **Reproduce a metric:** re-run the node’s `compute()` on a committed input and diff vs its fixture — the
  equiv gate already does exactly this (volatile-stripped). A finding that survives this diff is real.
- **Metric truth** = each `*-registry.js` (label/unit/good-direction/evidence; kept honest by `cohesion-badges`).
  **Provenance** = the two gates + `manifest-gate.js`. **Event vocabulary** = `docs/EVENT-LEXICON.md`.
- **Trace end-to-end:** pick one real `uploads/` recording, follow it **producer (`capture-host/`) →** raw →
  adapter (`adapters/*.js`) → `SignalFrame` (`signal-frame.js validateFrame`) → `compute()` → export →
  `integrator-dsp.js` fusion. At each hop: units? clock? `null` vs fabricated? badge? **and does the file's
  shape honestly reflect the hardware?**
- **Run the mutation harness — `node tools/mutate.mjs --file <module>.js`.** This is the fastest way to
  find a hollow gate, and it replaces the by-hand pass that produced `TEST-AUDIT-FINDINGS`' 42. It breaks
  one line at a time and reports the mutants the suite did **not** notice; a survivor is proof that
  nothing tests that line, whatever coverage says. It runs only the groups tagged for that module, so it
  is seconds, not minutes (`--jobs` is parallel by default, `--full` runs the whole suite per mutant).
  **A survivor is a lead, not a finding** — some are legitimately untestable (unreachable defensive
  branch, log string, float boundary). Triage them, and file the ones that name real behaviour.
  It is **JavaScript only**: `capture-host/` is Python under pytest and remains un-mutation-audited
  (`TEST-AUDIT-FINDINGS` §34 — use `mutmut`/`cosmic-ray` there).
- **Build the coverage matrix** (class 13): roster × cross-cutting surface, and report the empty cells. This
  takes ten minutes and finds defects no amount of reading will.
- **Grep the siblings** (class 14) the moment you find anything. Divergence between near-clone nodes is the
  highest-yield signal in this repo.

### Declare your scope — and name what you did NOT cover

Both 2026-07-18 audits skipped the same three things while reporting confidently on everything else. State
explicitly, in the report, whether you covered: **(a)** the browser lane (`Dex-Test-Suite.html?full`,
`verify-provenance.html`, render-coverage rigs — a headless `node:vm` audit covers **none** of it); **(b)**
`capture-host/` (Python, out-of-suite, its own pytest CI); **(c)** the **Integrator's fusion arithmetic** —
the noisy-OR posterior, `effConf`, the Poisson null models, the event-coupling surrogate machinery. (c) in
particular has now been left unaudited by two consecutive passes that both examined the Integrator's *ingest
and presentation* and stopped there. **A green area you did not look at must not read as a verified one.**

---

## Out of scope — do NOT file these (known/intentional; filing them wastes everyone’s time)

- **Frozen names** — `Ganglior`, the `ganglior.node-export` schema, all `ganglior.*` identifiers, `DexKernel`,
  and the **`fascia` input alias** (a *deliberate* read-side back-compat seam in `integrator-dsp.js` /
  `crossnight-envelope.js`; nothing emits it — not dead code).
- **`buildHash`** — RETIRED as a provenance signal (Phase 7); no gate reads it; it is inert legacy export
  metadata stamped by `ganglior-provenance.js` *by design*. Do not flag it as “unused” or “dead.”
- **`parseTimestamp` duplicated in every `*-dsp.js`** — intentional per the Clock Contract. Not a DRY
  violation to “fix”; do not propose a shared util.
- **No `@font-face` / `*.woff2` / CDN** — system font stacks by design (the `'Inter'`/`'IBM Plex Mono'` names
  fall through). PulseDex’s locally-bundled IBM Plex Mono is intentional.
- **Test pass-/group-COUNTS drift run-to-run** — only the **all-green pill** is the signal (render-coverage
  legs are timing-sized). Don’t treat a count change as a regression.
- Anything on the **`CLAUDE.md` “Known non-issues”** list, or already tracked **open** in `DOCS-INDEX.md`
  (cite the brief instead of re-finding it).

---

## Reporting (one entry per finding)

For each finding, give:
- **Severity** — top = *mis-states a surfaced number* or *fabricates absence*; then *silent failure*; then
  *contract/provenance drift*; then *robustness / code-health*. Say which.
- **Symptom** — what’s wrong, in one line.
- **Reproduction** — the failing assertion / triggering input / re-run diff. (No repro → mark **HYPOTHESIS**.)
- **Root cause** — the actual line(s) + why.
- **Fix sketch + gate cost** — the change, and what it triggers: which bundles re-bundle (`*-dsp/-cross/-app.js`
  edits → that node), whether a fixture must regenerate, which gates must re-run. Respect the gate-cost rules
  in `CLAUDE.md` (edit `.js`/`.src.html`, never the bundled `.html`; one gated change at a time).

Group findings by node/module. End with a short **prioritized punch-list** (correctness first).

### Also report what you REFUTED — this section is mandatory

A claim you investigated and **disproved by execution** is a deliverable, not a discard. Add a
**"What NOT to chase — investigated and REFUTED"** section listing each dead claim with the evidence that
killed it. Without it the next auditor spends a day re-deriving a bug that was fixed six days ago — which is
exactly what happens here, because stale comments and premature DONE stamps keep re-seeding the same false
leads. Give the refutation the same evidentiary standard as a finding.

Two cautions learned from doing this:
- **Refute the claim, not the underlying concern.** State precisely what was disproved. A row reading "false
  — X does affect Y" can be literally true while the *mechanism* is itself a defect (see MISSION, "verify the
  mechanism"). If you refute a claim but find something adjacent, say so in the same row.
- **A refuted claim is not a cleared area.** "This specific bug is not real" never implies "this code is
  correct."

### Cross-check against concurrent audits before filing

Several audits may run in the same week against different slices. Before finalising, `grep` `briefs/` and
`audits/` for passes dated within ~a week and reconcile: **(1)** does anything you filed appear in *their*
REFUTED list (resolve it — one of you is wrong); **(2)** did you each find a **different half of one bug**
(the 2026-07-18 pairing defect was found from both ends by two audits, neither seeing the other's half —
merge them or a partial fix ships); **(3)** does their evidence *demonstrate* one of your findings under a
different reading. Convergence between independent passes is the strongest signal available here — and
**where two passes overlapped in 2026-07-18 they agreed, with zero contradictions across 72 findings.**

**⚠️ But convergence counts ONLY when the passes are METHODOLOGICALLY independent — two runs of one method
are not two passes.** The 2026-07-18 agreement was strong because the passes came at the tree from
genuinely different directions (JS compute paths vs the Vigil↔suite seam). Contrast 2026-08-17, measured:
two sessions independently searched for a metric by its **registry id and labels**, both got zero, and
both concluded it was unsurfaced — while `oxydex-render.js:2711` was rendering a titled section of
**eight `metric()` cards** from it under the accessor `n.desat`. The parent id genuinely reaches no
surface; its *members* are separately registered, rendered and badged, so the object was on screen the
whole time and no search for the parent's own name could see it. **The agreement was correlated method, not corroboration**, and it was worth nothing: one
name-keyed grep run twice returns the same blind spot twice. What surfaced it was a *third* session whose
**count** disagreed — and, separately, one of the two greps had in fact found the render lines and
discarded them through `| head -12` (§👥.4b, committed inside an investigation *of* method failure).
**So: when two of you agree, ask what METHOD each used before treating it as evidence — and rank a
disagreement that comes from a different instrument above an agreement that comes from the same one.**
**COUNT DISTINCT METHODS, NOT DISTINCT REVIEWERS: unanimity among passes sharing a technique is ONE vote.**
Independence of *reviewers* is not independence of *technique*, and it is the technique that bounds what
is visible. The cheap operational half: **grep the ACCESSOR, not the identifier** — a rename at the
consumer boundary (`desatProfile` → `n.desat`) defeats every name-keyed sweep *simultaneously*, which is
also why any gate asserting "this metric reaches a surface" must walk accessors or it reproduces this
failure inside the gate built to prevent it. And when two passes conflict, **adjudicate by re-deriving
the answer yourself, not by weighing whose report reads better** — that is the step that recovered this
one, and unlike being lucky in method it is repeatable.
