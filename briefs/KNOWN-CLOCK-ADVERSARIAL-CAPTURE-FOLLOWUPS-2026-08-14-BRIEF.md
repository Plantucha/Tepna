<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED · **Created:** 2026-08-14 · **Follows:** `KNOWN-CLOCK-ADVERSARIAL-CAPTURE-2026-08-14-BRIEF.md` · **Affects:** `capture-host/`, `clock.js` §7, `integrator-dsp.js`, `pat-gate.js`, `ecgdex-dsp.js`

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
target 1 needs an **aperiodic marker present in two devices at once** — a tap artefact, a commanded
LED event, a motion impulse visible in both ACC streams — because beat trains align only modulo one
RR interval (`beat-trains-align-only-mod-rr`). No such marker exists in any recording on disk, so
this is a **capture protocol change**: someone must produce the marker at capture time.

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

- [ ] An aperiodic cross-device marker exists in at least one captured night, and target 1 is
      evaluated against it.
- [ ] Adapter assignment is written into night metadata and held fixed across a capture set.
- [x] **DONE 2026-08-15** — `integrator-dsp.js` (#1274) and `tools/pat-host-offset.mjs` (#1278) read
      `deviceDrawn`; `ecgdex-dsp.js` and `pat-gate.js` deliberately do not, on measured zero exposure
      (§3). The parent's `KNOWN HOLE` assertion stands unchanged and correct: `hostAxis.independent`
      is still spread-only — the consumers moved off it rather than the flag being redefined.
- [ ] One experiment in this family is run with injection and analysis in **different sessions**.

## Cross-references

- `KNOWN-CLOCK-ADVERSARIAL-CAPTURE-2026-08-14-BRIEF.md` — the parent; phases 1–4, all measurements.
- `papers/known-clock-recovery.html` — the write-up, including §3.6b's withdrawal.
- `HOSTAXIS-STABILITY-2026-08-13-BRIEF.md` — made and withdrew a span-gate claim first; §3.6b
  independently reproduced the reason it was withdrawn.
- `ALLAN-DEVIATION-2026-08-12-BRIEF.md` — σ_y(τ); validated against `allantools` to 4.78 × 10⁻¹⁴.
