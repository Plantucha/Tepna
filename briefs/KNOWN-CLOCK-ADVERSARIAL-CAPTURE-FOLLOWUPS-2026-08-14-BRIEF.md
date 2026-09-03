<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** DONE — 2026-09-02 (all four Done-when items closed: 2026-08-20 · 2026-08-18 · 2026-08-15, and the genuinely BLIND second-operator run executed 2026-09-02 — Kestrel `--blind-prepare` over `/srv/data/tepna-corpus/smoketest-captures`, 437 streams, key + `TRUTH.json` held sealed by Kestrel; Magpie analysed `blinded.json` alone under the pre-stated rule `report ppm only when hostAxis ok && independent`, 429 reported / 8 refused (`implausible host/device rate`); Kestrel scored: `answered 379/437  inapplicable 58  med|err| 0.001 ppm  worst 1.829  FALSE POSITIVES on null draws: 0`, exit 0. Decomposition of the 58 inapplicable: the analyst's 8 refusals are EXACTLY the 8 streams where the harness's own baseline `hostAxis` also refused, and the 50 remaining are EXACTLY the 50 zero-device-span (drawn-axis) streams, on every one of which the analyst reported `0.00`; 0 refusals on applicable streams. **Residue, named here, no new file:** a drawn-axis stream returns `ok:true, ppm≈0, independent:true` from `hostAxis` — `spreadMs` is huge there (median ~56 min), so the `independent` gate (built for the 0.13–1 ms derived-host case) is inert on it; the discriminator is CLAUDE.md §7's last bullet (inter-sample deltas ≥99 % on one value ⇒ drawn), which lives in node `quality.timingSource`, not in `hostAxis`. Magpie flagged this from the blinded side BEFORE scoring, unprompted — the protocol worked. Whether `hostAxis` should refuse a zero-span axis itself is a one-unit compute-path change (moves computeHash on 5 bundles) — owner's call on timing, not opened here. No follow-up file.) · **Residue:** 2026-09-02-hostaxis-accepts-drawn-axis · **Created:** 2026-08-14

# What the known-clock experiment could not finish, and why more tooling will not fix most of it

The parent brief ran four phases in one day and produced a paper. **It is not DONE, and this brief
exists so that is visible rather than implied.** Three of its seven "Done when" items are genuinely
unmet, and the reason matters: two of them are not analysis problems at all. Nothing in the parent's
toolchain can close them, so continuing to run analyses would produce more results while leaving the
same holes open.

## 1 · Honest state of the parent's acceptance list

| # | item | state |
|---|---|---|
| 1 | `acceptance.json` committed before the first run, hash recorded | ✅ `b061d279…`, committed, hash in the brief |
| 2 | ≥1 **null night** in the blind set, no perturbation recovered from it | ⚠️ **partial** — a null *control* ran on all 61 streams (max err `0.00e+0`), but no blind set with a hidden null *night* was ever constructed |
| 3 | all eight targets reported, with span/anchor count where a rate is quoted | ✅ including target 3 reported as **not recoverable** |
| 4 | the O2Ring leg **refused** on every clock-recovery target | ⚠️ **partial** — it refuses whole-file, but on the monotonic segment a node actually parses, `independent` still reads `true`; `deviceDrawn` is published but does not gate it |
| 5 | target 1 evaluated on an **aperiodic marker**, not beat alignment | ❌ **unmet** |
| 6 | adapter assignment recorded per night and held fixed | ❌ **unmet** |
| 7 | written up whether it passes or fails | ✅ `papers/known-clock-recovery.html` |

## 2 · The two that need a CAPTURE change, not an analysis

**§2.1 · Target 1 has never been tested (item 5).** The parent measured that a constant offset is
*unrecoverable by construction* — `hostAxis` subtracts `r0`, so a 5 s injection moves the rate by
exactly 0.000 ppm on all 61 streams. That is a real result about the estimator, and it is **not** a
test of offset recovery: it establishes that this instrument cannot answer the question. Testing
target 1 needs an **aperiodic marker present in two devices at once**, because beat trains align only
modulo one RR interval (`beat-trains-align-only-mod-rr`). ⚠ **The mechanism matters and this brief
first got it wrong**: a tap or any impulse applied to ONE device must travel through tissue to reach a
device on another body segment, and measurement shows it does not survive that path. The marker must
be shared by **CO-LOCATION**, not by transmission — see §2.1a. No such marker exists in any recording on disk, so
this is a **capture protocol change**: someone must produce the marker at capture time.

### §2.1a · The co-location protocol — what a capture must actually do

Executable, so this stops being an open-ended "needs a marker":

1. **Both devices already streaming and both links established.** The marker is useless if either
   stream starts after it.
2. **Hold the two devices firmly together** — taped, or gripped in one hand so they cannot move
   relative to each other. They must be one rigid body for the next step.
3. **One sharp impulse**: rap the pair once, hard, against a table edge. Sharp matters more than
   strong — the correlation is driven by the rise, not the amplitude.
4. **Repeat 3–5 times, several seconds apart**, so the recovered lag can be checked for consistency
   ACROSS impulses rather than trusted from one.
5. **Don the devices** and record the night as usual.
6. **Repeat the impulse sequence at the end**, before doffing. Two brackets separate a constant offset
   from drift; one bracket cannot.

Then `tools/aperiodic-offset.mjs --a <ACC> --b <ACC>` over the bracket windows. **Accept only if
`locked` is true AND the lag agrees across impulses AND it is invariant to `--max-lag-s`.** Any one of
those alone is satisfiable by noise — §4b is the demonstration.

**Why this works when a tap on a worn device does not:** during step 3 the two accelerometers
experience *literally the same acceleration*, because they are one object. Nothing has to propagate
between body segments. That is the entire difference, and it is why the earlier "tap artefact" wording
was wrong rather than merely optimistic.

### §2.1b · The evidence that no natural marker exists — lags that disagree

Beyond the prominence figures in §4b, the decisive check is whether the windows that *do* clear the
lock bound agree on a lag. Scanning all **285** one-minute windows of the paired night:

| | |
|---|---|
| median prominence | **0.0092** |
| windows above the 0.05 lock bound | **5 of 285** |
| their recovered lags | **+200, −50, −1700, +2800, −1300, +550 ms** |

Five exceedances out of 285 under a max-over-lag search is about what noise yields, and the lags
**spread over 4.5 seconds**. A genuine constant offset would give the SAME lag in every locking
window. So the failure is not "the windowing was too coarse" or "we needed a better detector" — there
is no shared marker to find, and no amount of re-analysis will produce one.

### §2.1c · 🔴 THE O2RING ALREADY HAS A COMMANDED SYNC — and it reframes §2.1a

**Owner, 2026-08-15: "o2 has sync beat".** Correct, and it is confirmed on hardware in
[`O2RING-OPCODE-SURFACE-2026-08-03-BRIEF.md`](O2RING-OPCODE-SURFACE-2026-08-03-BRIEF.md):

| opcode | effect | status |
|---|---|---|
| **`0x83`** | **vibration motor** — fired 5×, felt 5×, contact held throughout | confirmed |
| **`0x03`** | drains the PPG buffer — an exact sample **count** between two host-timestamped reads | confirmed (truncates >250 samples ≈ 2 s, silently) |

**Why this beats §2.1a's co-location for this device.** `0x83` is a mechanical impulse the ring
*generates itself* at an instant the host chose and stamped. Nothing has to propagate and nothing has
to be strapped together — the marker originates inside the device whose axis needs anchoring.

**And the framing correction that matters more than the opcode.** §2.1a assumed the marker must be
shared *between devices*. It need not be. **If each device is independently anchored to the common
capture host, the device↔device offset follows by subtraction** — the host is the shared reference,
and on a box night it is disciplined to 0.008 ppm. A cross-device marker is only required when there
is no common host, which is the phone-capture case, not the box case. My co-location proposal solved a
harder problem than the corpus actually poses.

**`0x03` is the stronger of the two for the axis problem**, and the opcode brief already says so: a
drain gives an exact sample count between host-timestamped reads, so *"the host clock becomes the axis
and the ring supplies only counts … it converts 'no timestamps at all' into 'host-stamped batches of
known size', and the residual is bounded by one batch rather than accumulating across a night."* That
is exactly the fix for the drawn axis this brief has been treating as unfixable — the O2Ring is the
device whose `deviceDrawn` flag we added guards for, and this removes the cause rather than refusing
the symptom.

⚠ **Untested before use, both flagged by the opcode brief and not by me:** whether buzzing
mid-recording contaminates the ring's **own motion column** (already fragile —
`o2ring-motion-column-fault`), the battery cost, and that `0x03` **discards overflow past ~2 s with no
error and no gap marker**, so a drain cadence slower than that loses samples silently.

⚠ **This does NOT settle target 1 for the Polar pair.** H10 and Verity have no commanded marker of
their own; for them either the host anchoring above suffices (box nights) or §2.1a's co-location is
still the route. The ring was the hardest leg and is now the most tractable one.

**§2.2 · Adapter assignment is not recorded (item 6) — and it is not a logging change.** Checked
2026-08-15: `capture.py` carries a single global `ADAPTER` (config `adapter:`, one MAC used for
bonding), not a per-device assignment. BlueZ selects the controller, so which radio carried which link
is not currently a quantity the daemon holds — recording it means deciding how to obtain it (the BlueZ
object path `/org/bluez/hciX/dev_…` carries it at connect time) and then validating against hardware on
a box that captures every night. That is a design change plus a capture campaign, not a log line, and
it should not be made blind.

 The box has two BLE adapters for three
devices and the capture path uses the UB500 known to go deaf. §3.10 of the paper escaped the confound
*within* a device — Verity `acc` at 322.8 ppm σ_y against the same device's `ppg` at 42.0, same
adapter, same night, matched span, so the 7.7× gap cannot be an adapter term. It cannot escape it
*between* devices. To say "device A is noisier than device B" the capture host must **write which
adapter carried which stream into the night's metadata**, and hold the assignment fixed across a set.
That is a `capture.py` change plus a deliberate capture campaign.

## 3 · The consumer migration the parent left open, deliberately

`hostAxis` publishes `deviceDrawn` / `drawnShare` / `drawnReason`, and **does not** gate `independent`
on them. That was a decision, not an oversight: folding it in reds 11 assertions including ECGDex's
planted-drift recovery, whose fixture legitimately uses a uniform device axis and is by construction
indistinguishable from a fabricated one. The detector is right about real data and wrong to be
load-bearing against a fixture.

**So the hole is open and asserted as open** (`KNOWN HOLE · independent is still spread-only`). Four
consumers still read `independent`:

| consumer | decides | measured exposure | state |
|---|---|---|---|
| `integrator-dsp.js:5338` | whether two devices sit on one timebase | one real O2Ring segment, **−22.83 ppm at 99.3 % drawn share**, passing both existing guards | ✅ **migrated** (#1274) |
| `tools/pat-host-offset.mjs:408` | per-night PAT refusal | its PAT target **is** the Wellue finger PPG — **O2Ring 20/20 drawn** | ✅ **migrated** (#1278) |
| `ecgdex-dsp.js:4301` | whether to apply the `fs` correction | **H10 ecg 0/6 drawn** — none | ⛔ **deliberately not gated** |
| `pat-gate.js:92` | whether PAT may run at all | **no live caller supplies `ax`** — `PAT Feasibility.html` calls neither `verdict(` nor `hostAxis(` | ⛔ **deliberately not gated** |

**MIGRATION CLOSED 2026-08-15, and two of the four were closed by declining to change them.** The
drawn-axis flag was worth wiring exactly where a drawn axis can arrive, and the corpus says where that
is: O2Ring 20/20 and Verity `ppi` 1/1, against H10 ecg **0/6** and Verity ppg **0/19**. Gating ECGDex
would have forced re-cutting a legitimate planted-drift fixture — whose uniform device axis is by
construction indistinguishable from a fabricated one — to defend against something that does not occur
in the data. Gating `pat-gate.js` would have defended a parameter nothing currently passes. Both are
machinery for a hypothetical, and adding them for symmetry would have made the guard look thorough
while teaching a reader that the flag matters in places it does not.

⚠ **If either premise changes, both decisions reopen.** ECGDex acquires exposure the moment a device
with a drawn axis feeds it ECG; `pat-gate.js` acquires it the moment any caller starts passing `ax`.
Neither is guarded against that, and neither should be silently assumed to stay safe.

**A gate written for this migration was itself vacuous and is recorded in #1278.** The source scan
matched `/deviceDrawn === true/`, which also matches the refusal *body*, so deleting the whole guard
left 4/4 green. It now pins the conditional; mutation-verified (clean 4/4, mutant 2 failing). A scan
matching an identifier rather than a construct is the text-gate form of the same absence-failure that
produced `stability.ok`, `correctRR`'s return shape, and a mutation that silently did not apply.

## 4 · A blind operator — the one this cannot self-fix

Criteria were preregistered and hashed before any run, which is more than any other paper in the set.
**The same agent still injected, analysed and wrote up.** §3.6b is the live demonstration: the parent
asserted a shipped span gate was "an order of magnitude too permissive", published that in a brief, a
changeset and a paper, and then withdrew it — because one further measurement showed the gate does
net good where it stands (correction helps on 82 % of cases at 2400 s, 100 % at 4800 s).

That retraction is a success of preregistration and a failure of blinding at the same time. It was
caught by the same operator running one more check, which is exactly the mechanism that cannot be
relied on. **The fix is procedural, not technical:** preregister, hand the injection log to one
session and the analysis to another, and let the second report before seeing the truth file.

## 4b · A trap worth more than the hypothesis: injecting a constant offset is a VACUOUS test

Testing an offset estimator by injecting a known constant offset **cannot fail**, and that is not a
strength. A constant time shift translates the entire cross-correlation surface rigidly, so the argmax
moves by exactly the injected amount whether or not the argmax means anything.

Measured on the night above, whose prominence is **0.0017** — i.e. no lock at all:

| injected | expected | recovered | error |
|---|---|---|---|
| −3000 ms | 6000 | 6000 | **0** |
| −1000 ms | 8000 | 8000 | **0** |
| +1000 ms | 10000 | 10000 | **0** |
| +3000 ms | 12000 | 12000 | **0** |

**Perfect recovery, four for four, from a method measuring nothing.** Had this been reported without
the prominence figure and the range test beside it, it would have read as a clean validation of target
1 — the exact shape of every other absence-failure in this work, and the most convincing one yet
because the numbers are flawless.

The discriminators that do work, both now asserted in `--self-test`: **peak prominence** against a
posture-only null control, and **invariance of the peak to the search range**.

## 5 · Smaller items, recorded so they are not rediscovered

- **Beat truth.** Phase 3 cannot separate "the corrector is biased" from "the raw train carries ~22 %
  artefact inflation it correctly removes" — that needs adjudicated R-peaks. Until then the −22 %
  figure must be cited as a *magnitude*, never as a bias.
- **`verify:docs` cannot see a new page.** `build-docs.mjs` walks `DEPLOY`, and `DEPLOY` *is* `docs/`,
  so a page never copied is "current" by construction. Measured: `docs/ current — 53 pages` while
  `docs/papers/papers.html` linked to a file absent from that tree. Seeded by hand; the gate would
  not surface the next one.
- **🔴 `TIMEBASE_MAX_STRATUM` — item WITHDRAWN 2026-08-15, its premise was an error.** The parent
  claimed the bound rejects the box it was written for. It does not: the box records
  `stratum=1 … timebase=host-disciplined`, because `chronyc`'s tracking-stratum (2) is normalised to
  the *server's* stratum (1) before the comparison — which `host_clock.py` documents in capitals and
  `test_chrony_stratum_is_normalised_to_the_SERVER_stratum` already gates. Nothing to re-derive.
- **The three-instance tool bug.** `stability.ok`, `correctRR`'s `{nn,…}` return, and a mutation that
  silently failed to apply — all the same shape: a check reporting about something it never examined.
  Both tools now assert their readouts are *populated*. Any new harness in this family should do the
  same before its first corpus run, not after.

## Done when

- [x] An aperiodic cross-device marker exists in at least one captured night, and target 1 is
      evaluated against it. **CLOSED 2026-08-20 with the DELIBERATE marker** — the natural-marker
      shortcut was TESTED AND FAILED 2026-08-15 (no usable shared posture transient: prominence
      0.0017–0.018 vs a 0.002 null, argmax riding the search boundary — 3850 ms at ±4 s, 5750 at ±6 s,
      9000 at ±9 s), which parked `tools/aperiodic-offset.mjs` as the instrument awaiting a deliberate
      marker. The commanded O2Ring buzz (`O2RING-BUZZ-FIDUCIAL-2026-08-19-BRIEF.md` §5) is that marker,
      and the parked instrument run over the 2026-08-19/20 buzz windows (H10 chest ACC vs Verity arm
      ACC) gives target 1's evaluation:
      **the lag STAYS PUT under the width test the 08-15 failure defined** — night 3-way window 100 ms
      at ±2/±4/±8 s identically; morning window 200 ms at all three widths — and a **+500 ms injection
      is recovered as exactly 700 ms** on a peak with real prominence (0.016–0.017, ~8× the posture
      null; r 0.60), unlike the 08-15 "perfect recovery measuring nothing". Convergent validity: three
      independent estimators land in one family (aperiodic-offset 200 ms · matched-filter xcorr
      +230 ms · threshold onsets +118–193 ms — `buzz-onset-extract.mjs`). Two bounds stated up front:
      the buzz command→artifact latency is ~0.1–0.4 s poll-quantized (the marker's ABSOLUTE placement
      inherits that bound; the cross-device lag does not), and the tool's formal `locked` flag reads
      **false** — its r−runnerUp ≥ 0.05 margin (calibrated on ambient whole-nights) is not met at
      0.016, because a 5-burst train's burst-vs-burst aliases produce near-tied secondary peaks in a
      2-minute window. A longer or gap-wider pattern would widen the margin; the stay-put + injection +
      convergence evidence is what "evaluated" requires, and the margin caveat travels with the number.
- [x] **SATISFIED ALREADY — MEASURED 2026-08-18. Both halves, and target 7's confound does not exist.**
      **Written:** every `Tepna_*_LINK.csv` opens with `# adapter=AC:A7:F1:29:9D:1D hci=hci0` — the adapter
      **MAC**, not merely the `hci` index. That is the right identity to record, because hci indices
      re-enumerate (the reason `adapter_hci()` exists at all), so an index-only record would silently
      re-label the same radio.
      **Held fixed:** across every capture in the corpus, **257 sessions on `AC:A7:…:9D:1D` (hci0)** and
      **1 on `C6:CF:3C:4E:75:F0` (hci2)**. No night contains two adapters.
      ⚠ **And the single outlier does not create the confound either** — `2026-07-26 14:56:03`, 16 rows,
      carries **all four devices** (COOSPO · H10 · Verity · O2Ring) on that one adapter. So adapter is a
      **between-session constant, never a within-session variable**, and target 7's *"sensor-specific noise
      confounded with adapter"* requires adapter to vary **with sensor**. It never does.
      **What remains true:** a comparison spanning that 07-26 session and any other is adapter-crossed. It
      is 1 of 258 and identifiable by header, so the mitigation is to name it, not to re-capture anything.
- [x] **DONE 2026-08-15** — `integrator-dsp.js` (#1274) and `tools/pat-host-offset.mjs` (#1278) read
      `deviceDrawn`; `ecgdex-dsp.js` and `pat-gate.js` deliberately do not, on measured zero exposure
      (§3). The parent's `KNOWN HOLE` assertion stands unchanged and correct: `hostAxis.independent`
      is still spread-only — the consumers moved off it rather than the flag being redefined.
- [~] **HARNESS BUILT 2026-08-15; the second operator is still owed.** `--blind-prepare` /
      `--blind-score` make it two commands: prepare writes `blinded.json` (anchors + opaque ids only —
      audited on the real 35.7 MB artefact, **zero** matches for device, night, draw name or magnitude)
      and a sealed `TRUTH.json`. Proven end-to-end on the corpus: **51 answered, 10 inapplicable,
      median |err| 0.000 ppm, worst 1.025, zero false positives on null draws** — reproducing the
      open-label §3.2/§3.4 findings blind. WARNING: I ran both legs myself, so this is NOT a blind
      result; it proves the mechanism and removes the excuse, nothing more.

## Cross-references

- `KNOWN-CLOCK-ADVERSARIAL-CAPTURE-2026-08-14-BRIEF.md` — the parent; phases 1–4, all measurements.
- `papers/known-clock-recovery.html` — the write-up, including §3.6b's withdrawal.
- `HOSTAXIS-STABILITY-2026-08-13-BRIEF.md` — made and withdrew a span-gate claim first; §3.6b
  independently reproduced the reason it was withdrawn.
- `ALLAN-DEVIATION-2026-08-12-BRIEF.md` — σ_y(τ); validated against `allantools` to 4.78 × 10⁻¹⁴.
