---
bump: patch
type: changed
brief: none
---

Four residue rows re-verified against current `main`. **All four stay OPEN** — their premises hold — and
two material corrections are recorded as new rows rather than edits, because a row is closed by changing
only its state cell and a wrong row gets a new row that says so.

## The primary question was "is the premise still true?" — and for all four it is

**`2026-09-02-hostaxis-accepts-drawn-axis` — true, but its REMEDY is obsolete.** Verified by *calling*
`hostAxis`, not reading it: a drawn axis (`devMs = i*1000`) returns `ok:true, independent:true, ppm
2013.2` — a confident rate for a device with no oscillator. So the core claim stands.

But the row says the drawn-axis test *"lives only in node `quality.timingSource`"*, and that is now
false: `clock.js` computes `deviceDrawn` against a measured `CK_AXIS_DRAWN_SHARE = 0.67` and **publishes
it from `hostAxis`** — my drawn axis returned `deviceDrawn:true`. The remedy changed from *build a
discriminator* to *migrate the consumers*, which is a different unit.

⚠️ **And folding it into `independent` was tried and reverted** — `clock.js:555-566` says so in its own
words: a synthetic fixture legitimately uses a uniform device axis, indistinguishable by construction
from a fabricated one, so gating on it reds **11 assertions** including ECGDex's planted-drift recovery.
A picker-up must not re-discover that. New row records it.

**`2026-09-02-box-detector-lacks-bandpass` — true.** `monitor.html` has **0** occurrences of
`bandpass|biquad|iir|highpass`, and `detectRs(sig, st.fs)` runs on `sig = st.buf.map(...)`, the raw
buffer. ⚠️ But **reading the code beneath the claim changes what kind of defect it is**: `detectRs`'s own
comment records that a pathological baseline wander returns **no beats** — *"an honest dash, not the old
detector's fabricated ~205 bpm"*. So this is an **enhancement**, not a correctness bug; the current
failure mode is a refusal, not a wrong number. Still true, still parked, and now parked knowingly.

**`2026-09-07-drain-stamp-asserted-a-count-it-never-read` — true, and I re-counted rather than trusting
it.** `tools/mutate-equivalence.json` gives **cpapdex 26 · glucodex 48 · hrvdex 71 · motiondex 100**,
exactly as the row says, against the stamp's asserted **0**. The specific instance is resolved — the
brief now reads `DONE — 2026-09-07` with both residue keys. The **procedural** claim stands and has no
mechanism: nothing verifies that a triage stamp's state was re-measured rather than recalled.

## ⚠️ The one I could NOT verify — and deliberately did not act on

**`2026-09-05-respacc-run-is-not-unavailable`** asserts the committed path runs in 74 s, which would
withdraw `2026-09-02-papers-remedy-unavailable` (still OPEN). **I could not reproduce it from this box,
so I did not withdraw anything.**

- the tool has changed **3 times** since that measurement — including #2207, *"resp-acc-headless exits 0
  having written no figure — the guard counted the wrong thing"*, which is a fix to what *"runs to
  completion"* even means;
- the corpus is not here: **3 `*_ACC.txt` and 7 `*_BRP.edf`** in the primary checkout, against the 192+
  night superset at `/srv/data/tepna-corpus/uploads/` per `docs/CORPUS-LOCATIONS.md`.

**Withdrawing a row on a 15-day-old measurement I cannot reproduce would be a wrong closure** — it
deletes a live claim and leaves nothing to contradict it. Re-verification needs the box that holds the
corpus.

## An incidental finding, recorded but not acted on

**Playwright launches again on rig** — `chromium.launch() → newPage() → goto()` completes cleanly, while
`2026-09-05-playwright-blocked-by-apparmor-userns` is still OPEN. **The new row does not withdraw it**: I
measured a *launch*, not the tool surface that row describes, and did not inspect the AppArmor/userns
cause it names — a working launch is equally consistent with the cause being removed, masked, or
intermittent. Its owner should re-run the tools it actually names.

## Nothing was edited

No state cell changed and no existing row's text was touched. Two rows appended; `docs-ledger` 75/75.
