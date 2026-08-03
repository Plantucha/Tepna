<!--
  CPAP-AUTOHARVEST-FOLLOWUPS-2026-07-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-03 · **Created:** 2026-07-28 · **Follows:** `CPAP-AUTOHARVEST-2026-07-26-BRIEF.md` · **Reference:** `EZSHARE-CARD-INTEGRATION-2026-07-28-BRIEF.md` · **Followed-by:** `CPAP-AUTOHARVEST-FOLLOWUPS-II-2026-08-03-BRIEF.md` · **Also carries:** the four unclosed `DEEP-AUDIT-III` punch-list items (§4)

# What executing CPAP-AUTOHARVEST surfaced — and the work it does not close

The parent is DONE: all four phases shipped, the harvest runs unattended at 13:00, and the box holds
197 nights / 529 MB with a clean steady state. This brief is the residue — what the execution taught,
what it deliberately left alone, and the items from other briefs that would otherwise live only in a
chat transcript.

---

## 1 · What execution taught (the part worth keeping)

### 1.1 The completeness model, not the transport, was the bug

Five days were spent treating a **rounding assumption** as a flaky card. Every symptom pointed at the
transport — files "truncating", `.part` residue accumulating, the same file failing repeatedly — and
every one of them was the listing's `ceil(bytes/1024)` meeting a symmetric tolerance. Five consecutive
fetches of the "failing" file returned identical bytes. **Measure before believing a transport story**:
one loop fetching the same file five times and comparing lengths would have ended it on day one.

Written up in full as `EZSHARE-CARD-INTEGRATION-2026-07-28-BRIEF.md`, which is the reusable artifact.

### 1.2 A promise in a docstring is not a behaviour

`cpap_poller`'s docstring said *"Zero files on a day the machine ran is an ALERT, not a silent no-op —
the `writers.IDENTITY_FIELDS` lesson"*. The code logged a warning, and the status it published was
`ok`, so the monitor painted a green `✓ 0 files` over a harvest that had found nothing. The lesson was
correctly identified, written down, and then not implemented — and the write-up is what made it look
handled. Fixed 2026-07-28 (`barren` state + webhook). **Grep the daemon for other docstrings that
describe a guarantee, and check each one has a test.**

#### ✅ SWEPT 2026-08-03 — 124 guarantee-bearing docstrings, and the sweep's own first answer was wrong

Every `def`/`class` docstring in `capture-host/*.py` carrying guarantee language (*never · always ·
must · cannot · guarantees · refuses · is an ALERT · not a silent · invariant*) was enumerated by AST:
**124** of them, across 30 modules.

Cross-referencing those against the test tree gave a comfortable answer — **only 3 of 124 are never so
much as *named* in a test** — and that answer is close to worthless, which is the part worth keeping.
Being named in a test is not being gated by one; `assertions-encode-shape-not-contract` is this repo's
own record of a test written from reading the code that passes while catching nothing. The question
§1.2 actually asks is *does anything go red when the promise is removed*, and only a mutant answers it.

So the three were mutated instead — each documented guarantee deleted in turn, suite re-run:

| mutant | guarantee removed | verdict |
|---|---|---|
| `rel_files` drop `onerror=_raise` | unreadable night walks to EMPTY ⇒ "contains nothing" ⇒ confirmed mirrored | **KILLED** (2 failed) |
| `rel_files` top-level only | a night holding a subdir reported fully mirrored, subdir never copied | **KILLED** (8) |
| `rel_files` drop marker exclusion | the marker enters the enumerated set | **KILLED** (4) |
| `rel_files` drop `sorted()` | enumeration order becomes `readdir` order | **SURVIVED** |
| `merge_sessions` end := start | cluster by start-stamp alone — the 7-h connection splits | **KILLED** (8) |
| `merge_sessions` drop `+ gap_sec` | adjacent files stop merging | **KILLED** (10) |
| `merge_sessions` drop the sort key | the merge no longer sees files oldest-first | **SURVIVED** |

**5 of 7 were already gated** — by tests that never name the function, reaching it through
`_mirror_matches` / `summarize` / `timeline.build`. Transitive coverage is real coverage; a name-based
scan would have condemned all seven.

**The two survivors are now gated, both verified RED by re-applying the mutant** (a green new test is
not evidence until it has been seen to fail):

- `test_rel_files_enumeration_is_SORTED_not_merely_readdir_order` — drives `os.walk` out of order on
  purpose, because a real filesystem's order is incidental and a test that relies on it gates nothing
  on the machine where it happens to sort. This one fails **safe** today (both callers iterate rather
  than diff two sequences), so it is a contract gate, not a bug fix — but "safe today, by the shape of
  two callers" is precisely the coincidence audit F1 removed from this very function.
- `test_merge_sessions_does_not_depend_on_the_order_it_is_HANDED_the_files` (+ a separate-sessions
  control, so order-independence cannot be bought by merging everything). This one is **load-bearing**:
  the loop compares each file against `sessions[-1]` alone, so unsorted input splits one continuous
  connection across several sessions — and both consumers derive a coverage *denominator* from the
  session they pick (audit §A4a). `scan_night` hands them over name-sorted today; that is a property of
  one caller, and `summarize` already concatenates a previous day's scan onto the front of it.

Suite **2373 → 2376**, green. The third never-named function, `probe_pmd_surface._read_char`, was
deliberately **not** touched: it is a one-shot BLE developer probe requiring real hardware, and it sits
inside the scope of an in-flight worktree (`POLAR-PMD-COMMAND-SURFACE-2026-08-02`). Recorded, not
claimed — carried to the follow-up.

**The reusable finding is the method, not the two tests.** A guarantee-language grep is a cheap and
genuinely complete way to *enumerate* what the daemon promises; a name-based cross-reference is the
wrong way to check them, and would have reported this daemon 121/124 clean while missing both real
gaps. Mutate the promise.

### 1.3 Verifying outside the sandbox proves nothing

The `/tmp` control-directory fix was verified over SSH, where `/tmp` is writable, and failed on deploy
with `[Errno 30] Read-only file system` because the unit runs `ProtectSystem=strict`. An interactive
shell is not the sandbox that constrains the daemon. **Any privilege or filesystem question must be
answered from inside the unit** — `systemd-run --property=... ` or a test that reproduces the sandbox.

### 1.4 A claim of absence must be checked against a total

"~6 h of data lost" was reported off `ls | sort -k6 | tail`, which sorted a 179 MB ECG file *above* the
tail and hid it. Nothing was lost. **Never conclude absence from a sorted excerpt** — count, or sum,
against a total.

---

## 2 · Open work from this brief's own execution

### 2.1 The CPAP is recording its own oximetry, and nothing consumes it

`SA2.edf` carries `SpO2.1s` and `Pulse.1s` at 1 Hz for the full night, on every night on the card.
Tepna sources SpO₂ from the O2Ring alone, and `VIGIL-DEEP-ANALYSIS` records the ring spending **17 % of
nights below −85 dBm** with the resulting dropouts. This is a **second, wired, drop-free SpO₂ source
over the identical interval** — a real cross-validation opportunity for OxyDex and a gap-filler for
exactly the nights the ring loses. Flagged in the parent as out of scope; still unclaimed. Probably
deserves its own brief rather than a section here.

**✅ ROUTED 2026-08-01 → `CPAP-SA2-OXIMETRY-SOURCE-2026-08-01-BRIEF.md`.** The premise was verified before
routing rather than taken on trust, and the measurement both confirms it and corrects its shape:

| | |
|---|---|
| distinct `*_SA2.edf` (deduped by filename) | **250** |
| distinct nights | **194** |
| median SA2 coverage | **6.85 h/night** (p10 5.23 · p90 8.68) |
| nights under 4 h | 7 of 194 |

`SpO2.1s` and `Pulse.1s` are both present at exactly 1 Hz and parse with the **shipped**
`CpapEdf.readEDF`, unchanged — so the first step is small.

Two corrections worth carrying, because either would have skewed the routing:

- **A night can be several sessions.** 39 nights have 2 and 7 have ≥3. The first file sampled here reads
  2.50 h against a 7.35 h ring night (34 %) — generalising from it would have understated the source by
  ~3×. Sum a night's sessions; never read one `SA2.edf` as "the night".
- **The obvious agreement analysis is a trap.** A naive alignment of that night against the concurrent
  O2Ring gives r = 0.296 at a −79 min lag. That is not sensor disagreement: the CPAP clock runs ~39 min
  slow (`CROSS-DEVICE-CLOCK-SKEW`, which shipped `fitClockOffsetPooled` to fit it), and Pearson r is the
  wrong statistic for a trace that sits flat near 96 % all night. The routed brief carries Bland–Altman +
  ODI-4 agreement instead, and states explicitly that it claims an **opportunity, not a validated
  agreement**.

### 2.2 The harvest has never been observed failing in the field

Every failure path — barren, short read, deadline-capped partial, a refused association — is unit
tested, and none has yet fired on the box under real conditions. The alert path in particular has
never delivered a real webhook. Worth one deliberate fault injection (unplug the card mid-afternoon)
rather than waiting to discover it during an outage.

**✅ INJECTED 2026-08-01 — and it found a defect the unit tests could not.**

*Unplugging the card* is a physical act; the equivalent fault is the card being **unreachable**, which was
induced with zero blast radius: the real `cpap_harvest.harvest()` was driven in-process on the box against
**192.0.2.1** (TEST-NET-1, guaranteed unroutable) with a throwaway destination. No config was changed, the
running `tepna-capture.service` was untouched, and the destination was verified **empty** afterwards —
nothing fabricated.

**What the harvest does (correct):** `reachable()` returns `False` in 3.0 s, then `harvest()` **raises**
`RuntimeError: http://192.0.2.1/dir?dir=A:: <urlopen error timed out>`. The caller catches it
(`except Exception … # a harvest must never kill the task`), publishes `state=error`, logs a warning, and
the poller survives. That half is sound.

**What it did NOT do — the finding.** That exit `continue`s, so it never reaches the `barren` block
below it. And **`barren` was the only exit that alerted.** `barren` requires a walk that *completed*
having seen nothing; a card that is simply not there never gets that far. So the single most likely field
failure published `state=error` and **told the operator nothing** — even on a box with a webhook
configured. Precisely the shape the `barren` comment already records one branch over: a promise kept in
prose, honoured on one branch of two.

**A second, independent reason the webhook has never fired.** The deployed
`/opt/tepna/capture-host/config.yaml` has **no `alerts:` block at all** (top-level keys: root, adapter,
storage, web, devices, link, time, watchdog, pull, archive, cpap). So
`Notifier(_acfg.get("webhook_url"), enabled=bool(_acfg.get("enabled")))` constructs
`Notifier(None, enabled=False)`; `send()` returns `False` immediately without posting. Note `if notifier:`
is still **truthy** — the object exists — so every call site runs and silently no-ops. The transport is
off, not merely untriggered.

**Fixed (in-repo):** the `except` branch now notifies. Gated by
`test_a_RAISING_harvest_alerts_not_just_barren`, mutation-verified (removing the alert reds it), with
`test_a_healthy_run_still_never_alerts` as the control so the fix cannot trade a silent failure for a
daily false alarm. Short reads deliberately stay silent — `test_short_reads_still_outrank_barren` records
that decision and this change does **not** overturn it. capture-host suite 1716/1716.

**Still owed, and both are the owner's:**
1. **Configure `alerts:`** (`enabled` + `webhook_url`). Until then no failure can page anyone, and the
   journal is the only surface. Which endpoint is a decision, and the URL is a secret this session does
   not hold.
2. **Deploy.** The fix is committed, not shipped — the box still runs the old `capture.py`. Deploying is
   a deliberate two-step (`git pull` **and** `sync-apps.sh`) and was not done unprompted.

### 2.3 Backfill throughput was measured once, on one card

`130 KB/s` sustained (parent §5) and `1.65 MB/s` (reference brief §2) are the same card measured on
different days with different methods. Neither is wrong; they are not comparable, and the brief that
quotes 65 min for a full backfill is using the slower one. If backfill time ever matters again,
re-measure rather than trusting either.

---

## 3 · Deliberately not done

- **Station mode was never confirmed.** The card answers every path with a 219-byte catch-all `200`,
  so it cannot be probed over HTTP; `ezshare.cfg` serves as 0 bytes. It needs the vendor UI. Moot for
  this deployment (the 13:00 window costs nothing in AP mode), and `reachable()` means the same build
  serves a station-mode box with no association at all — so this stays unanswered on purpose.
- **A second Wi-Fi NIC** (parent §3.3) is unnecessary here: the box's uplink is wired and `wlp1s0` sits
  idle, so there is nothing to contend with during the daily window. `deploy/enable-cpap-wifi.sh`
  covers the Ethernet-less case by refusing rather than by adding hardware.

---

## 4 · Carried from `DEEP-AUDIT-III` — four punch-list items nothing else owns

`DEEP-AUDIT-III-FOLLOWUPS` is DONE for its own §1/§2/§3 scope, and the parent `DEEP-AUDIT-III` stays
**PROPOSED** because these four sections carry no fix stamp and were never in that brief's scope. They
are recorded here so they are not lost to a cleared context. **This brief does not claim them** —
whoever takes them should split them into a MotionDex brief of their own.

| Parent § | Site | Defect |
|---|---|---|
| **3.6** | `integrator-dsp.js:1902` | `Autonomic ⟷ glycemic` publishes an **ECG-only** number under a note that says otherwise |
| **4.1** | `motiondex-dsp.js:214/220` | `sampleHz` divides count by span, so **any gap mis-scales every window** |
| **4.2** | `motiondex-dsp.js:786` | `respiratoryRate()` reports a confident rate across epochs where **the strap was off** |
| **4.3** | `motiondex-dsp.js:174` | **No plausibility bound** on IMU samples |

Three of the four are MotionDex, and §4.1 is the one with the widest blast radius — a mis-scaled
`sampleHz` corrupts every windowed metric downstream of it, not just one.

> **CLOSED 2026-07-29 — and the premise above was wrong in an instructive way.** All four were
> **already fixed**, on 2026-07-27; the parent was simply never re-stamped, so "no fix stamp" read as
> "no fix". What was NOT already true is that they were gated. Mutation-checking each revealed that
> **§3.6 had no gate at all** and **§4.1's gate was pointed one function away from the defect** — it
> drives `respiratoryRate`, which never calls `sampleHz`. Reverting either fix reddened **zero**
> assertions, while the §4.1 revert moves a published `Effort amplitude` by 25 %. Both now have gates
> verified RED; §4.3's was already sound; §4.2's covers its reporting half but not its tracking half.
> `DEEP-AUDIT-III` is **DONE**. No MotionDex brief was needed — the residue is in
> `DEEP-AUDIT-III-FOLLOWUPS-II-2026-07-29-BRIEF.md`.

---

## 5 · Also open, fleet-wide (recorded here only so the list survives)

Not this brief's work, and each needs its own execution. Listed because they are otherwise carried
only in conversation:

1. **16 pending changesets, no release cut.** Several are compute-path changes (ECGDex staging,
   `ansBalance`, the Integrator's gap-aware hours), so per `CLAUDE.md` §🔒 `tools/release.mjs` will
   refuse until `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs` runs green on a machine holding
   the real corpus. **The version bump is an owner call.**
2. **Integrator gap-aware overlap, part 2** — ECGDex/PpgDex/OxyDex emitting `recording.coverage` with
   sparse segments, plus an adversarial committed fixture. `bump: minor`; published AHI values move.
3. **REM staging §3** (`REM-STAGING-REDESIGN-2026-07-28-BRIEF.md`) — the weighted-score detector. The
   conjunction rule yields **2 of 77 epochs** on real data, and the corpus median REM is **6.5 %**
   against a physiological 15–25 %.
4. **Fold by night key** — one folder per sleep *night* (`start − 12 h`) rather than per calendar date.
   Going forward only; never retroactive.

> **Status 2026-07-29.** §5.1 released (v1.19.0). §5.2 **DONE** — the three capture nodes emit
> `recording.coverage` and the fusion export publishes `apnea.overlapCoverage`; residue in
> `INTEGRATOR-GAP-AWARE-OVERLAP-FOLLOWUPS-2026-07-28-BRIEF.md`. §5.3 **part-done** — its prerequisite
> landed (the synthetic oracle breathed identically in REM and NREM, so §3's discriminator could not be
> built; it now does, and `epochs[].respCv` measures a 2.6× REM/NREM separation), but the weighted-score
> detector itself is **still open**: it reaches the physiological 15–25 % band on the corpus only by
> losing planted-truth recall, and §5 of that brief requires both. §5.4 untouched.

---

## 6 · Done when

- [x] §1.2 **swept** 2026-08-03 — 124 guarantee-bearing docstrings enumerated; the 3 no test names were
      mutation-checked rather than eyeballed; 5 of 7 guarantees already gated transitively, the 2 that
      survived are now gated and verified RED. Suite 2373 → 2376. The name-based cross-reference is
      recorded as the *wrong* check, because it read 121/124 clean over both real gaps.
- [x] §2.1 **routed** 2026-08-01 → `CPAP-SA2-OXIMETRY-SOURCE-2026-08-01-BRIEF.md` (premise verified first: 194 nights, median 6.85 h)
- [x] §2.2 **injection done** 2026-08-01 — it found that only `barren` alerted and the raising path did not; fixed + gated. The **webhook still cannot deliver**: the deployed config has no `alerts:` block, so the transport is off (owner: configure it, then deploy)
- [x] **§4 CLOSED 2026-07-29 — `DEEP-AUDIT-III` is DONE.** Not by splitting a MotionDex brief: all four
      items were already fixed, and what they actually lacked was gates. §3.6 had none, §4.1's was
      blind. Both added and verified RED by mutation. Residue → `DEEP-AUDIT-III-FOLLOWUPS-II-2026-07-29-BRIEF.md`.
- [x] **§5.1 DONE 2026-07-29 — verified AND released as v1.19.0.** Four fixtures (ECGDex, PulseDex ×2,
      Integrator) carried a `verifiedUnder` predating the ECGDex-staging, `ansBalance` and
      gap-aware-hours compute changes, so `tools/release.mjs` was refusing exactly as designed.
      `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs` on the corpus machine re-verified them; no
      export byte had moved, so nothing needed regenerating. 18 changesets folded into **v1.19.0**
      (MINOR — exports gain `recording.coverage`). **The tag is the owner's to push.**
      *Gotcha found on the way:* `build-docs.mjs` prints a 9-path `git add` line but the version badge
      moves in **51** files — stage what `git status` shows, not what the tool printed.
