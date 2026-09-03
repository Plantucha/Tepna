<!--
  PAT-RESIDUAL-ATTRIBUTION-2026-08-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (PARKED 2026-08-28 — n=0 clean nights measured, and the sole acquisition route is owner-DECLINED; this experiment is UNRUNNABLE AS DESIGNED, see §6. Deliberately *not* worded "deferred": nobody should retry this.) · **Created:** 2026-08-28 · **Spawned by:** `PAT-ROOT-CAUSE-FORENSICS-2026-08-27-BRIEF.md` (campaign boundary declared 2026-08-28) · **Interlocks:** `PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md`, `PAT-FORENSICS-WINDOW-REGIMES-2026-08-28-BRIEF.md` · **DRAIN 2026-09-02 (Osprey) — restamped, blocker unchanged and NOT re-litigated.** The sole acquisition route is owner-DECLINED and n=0 clean nights was a measurement, not an estimate; nothing since 2026-08-28 changes either. **Owner: the OWNER** (only a route decision reopens it). **Next step:** none available to the fleet — this stays parked until the owner reopens the route or accepts a different design. · **Residue:** 2026-09-02-pat-applied-works-by-accident · **RE-VERIFIED 2026-09-03 (Osprey): the parked wording is correct and deliberately not "deferred" — leave it.** n=0 clean nights measured and the sole acquisition route is owner-DECLINED, so this is UNRUNNABLE AS DESIGNED rather than queued. Confirmed it holds no table the published-number sweep could attribute to a tool, so nothing here rests on a drifted number. **No stamp change is the correct outcome**; re-verified so the next triager does not re-derive it.

# What spends the last 20–40 ms — the one PAT question the current corpus cannot answer

> **Why this brief exists:** the PAT root-cause campaign answered its charter and then stopped at a
> boundary rather than past it. One term survived every elimination, and the experiment that would
> settle it **exists, is sound, and is not powered by the data we hold.** This brief records the
> question, the validated design, and the exact n it needs — so it is picked up when the corpus
> supports it and not re-derived from scratch.

## 1 · The state, by reference not by copy

The campaign's error budget and its full eliminated-candidates table live in
[`PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md`](PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md)
§6c. **Do not duplicate that table here** — a second copy is a second thing to keep true, and this
repo has already paid for divergent duplicates. In one line: no sensor-side term exceeds ~11 ms, the
acceptance window is the limit where it dominates, and after an out-of-sample window a residual of
**20–40 ms** remains, against a **~11 ms** measured sensor floor.

That residual is a **slow trend** — established on 8/8 nights, shuffle-controlled, with white noise,
respiratory oscillation, HR coupling and the **inter-device clock** all eliminated.

## 2 · The two surviving candidates

| candidate | what it would mean |
|---|---|
| **Slow physiological variation** — blood pressure, vasomotor tone, posture, sleep stage | The residual is **SIGNAL**: the quantity PAT exists to measure. The budget has no hole and the term should be reported, not removed. |
| **An instrumental effect the host axis cannot see** — sensor warming, contact/wear drift, coupling change | The residual is **ERROR**. The budget has a hole and a hardware or wear-protocol remedy applies. |

These are not near-neighbours: they point at opposite remedies, and one of them makes the term a
feature. **Recording the residual as either without evidence would be the campaign's worst possible
inversion**, which is why the campaign declined to choose.

## 3 · The design — validated as non-circular and non-confounded

**Two PPG sites against one ECG reference.** A systemic physiological trend moves **both** sites
together; a contact or wear artifact is **site-local**. So the correlation of the two sites' lag
trends discriminates the two candidates directly.

**Why the obvious alternatives fail** (each checked during the campaign, recorded so they are not
retried):

| alternative | why it fails |
|---|---|
| cross-device lag vs each device's internal intervals | **CIRCULAR** — `lag_n − lag_0 ≡ Σff − Σrr` is an algebraic identity, true whatever the cause. Asserted in `tools/pat-drift-attribution.mjs`'s selftest so it cannot be re-derived as a measurement. |
| per-LED comparison | **COMMON-MODE** — three LEDs share one housing, one skin contact and one clock, so both candidates move them together. |
| amplitude / DC-level covariance | **CONFOUNDED** — perfusion is itself physiological, so the predictor and one hypothesis are the same thing. |
| **two sites, one ECG** | **SOUND** — two sites share neither housing nor contact, and the clock cancels within each site's own lag series. |

## 4 · 🔴 Why the current corpus cannot power it

Measured on `/home/michal/tepna-smoketest/captures`, 42 nights:

- 🔴 ~~**The clean pair exists on TWO nights**: 2026-07-25 and 2026-07-26.~~ **REFUTED — it exists on
  ZERO nights. See §4b.** This brief originally counted *filename serials*; there is only one
  physical Verity.
- **The plentiful pair — Verity + O2Ring, on most nights — is CONFOUNDED.** The O2Ring's axis is
  **DRAWN** (`index × assumed rate`, ≥99 % of inter-sample deltas on one value; see
  `o2ring-timestamp-is-drawn` and the Clock Contract §🔒.7). A drawn axis **manufactures its own
  linear drift**, which is precisely the quantity under test. Using it would not measure the
  discriminator; it would measure the O2Ring's synthesised counter.

**n = 0. See §4b — and the precedent below stands regardless.** The
clock-offset-versus-regime test was refused at **n = 11** because its 95 % CI on ρ spanned
`[−0.53, +0.67]` — both verdicts. Running a two-site test at n = 2 would be the same error with a
smaller sample, on a hypothesis the author would prefer to resolve. **The line holds in both
directions or it is not a line.**

## 4b · 🔴 STEP 1 EXECUTED — the clean pair does not exist. n = 0, not 2.

This brief's original claim counted **filename serials**, and two serials are not two devices.

**Refuted four independent ways:**

1. **One address.** The nights show two Verity filename-serials, `0C301E3F` and `AC0C301E`, but the
   night's link log carries exactly **one** Verity address — `24:AC:AC:0C:30:1E` — and *both*
   filename forms derive from it: `AC0C301E` is MAC bytes 3–6, `0C301E3F` is the MAC tail plus a
   suffix, the same scheme that yields the H10's `02849638` from `…02:84:96`.
2. **The sessions never overlap.** One physical unit cannot stream two sessions at once, so overlap
   discriminates without needing the link log at all. On 2026-07-25 the last `0C301E3F` session
   **ends 22:27:15** and the first `AC0C301E` session **starts 22:33:38** — a 6 m 23 s gap.
3. **They run in clean blocks, never interleaved.** 07-25 is `0C301E3F` 01:20 → 22:26, then
   `AC0C301E` 22:33 → 23:51; 07-26 is the reverse. That is a rename at a point in time, not two
   devices worn together.
4. **No third device produced files.** Exactly three prefixes exist on both nights: one H10, one
   Verity, one O2Ring. A second Verity would have written files under its own serial; none did.

**This is `ble-identity-is-address-only` applied to our own filenames** — the standing ruling says
identity is the address, never the local name, and a filename serial is just a local name with extra
steps. The two unidentified heavy addresses on those nights are not resolvable from the local tree
(it holds no link log; `CLOCK.csv` is NTP discipline, not device links), but they cannot rescue the
claim: any Verity that produced data would appear under its own filename serial, and only one device
did.

**What this changes, and it sharpens rather than weakens the brief.** The position moves from
*"underpowered at n = 2"* to **"n = 0, and no quantity of existing data helps"**. The confounded
Verity + O2Ring pair remains the only plentiful option and remains disqualified by the O2Ring's drawn
axis. So:

> **The two-Verity capture protocol stops being optional. It is the only route to this experiment,
> and it is a purchase and a wear-protocol decision — the owner's, not a task anyone can pick up.**

⚠️ **A methodological note worth more than the count.** The original claim was not careless — it was
derived from a real inventory. It was wrong because it measured the **name** and reported it as the
**device**, which is exactly the class of error the fleet already has a standing ruling about. A
count is only as good as the identity it counts, and *"two distinct filenames"* is not *"two distinct
things"* until something addresses-level says so.

## 5 · What it needs, and where that comes from

- **n ≈ 29 nights** carrying two *real-axis* PPG sites plus ECG — the figure the campaign derived for
  detecting ρ = 0.5 at 80 % power (ρ = 0.3 would need 85). **Existing corpora supply 0 of these**
  (§4b), so every one of the 29 must be newly captured.
- **Source: the vigil box** — `vigil:/srv/tepna/captures`, the freshest nights, reachable over
  `ssh vigil` (see [`docs/CORPUS-LOCATIONS.md`](../docs/CORPUS-LOCATIONS.md); note
  `corpora-live-on-the-box`). **Whether vigil actually holds two-real-axis-site nights is UNVERIFIED**
  — that check is step 1 below, and this brief does not assume the answer.
- If vigil does not hold them either, the honest outcome is that **this question needs a capture
  protocol change** (deliberately wearing two Verity units at two sites) rather than more analysis.
  That is a request to the owner, not a task.

## 6 · 🔴 TERMINAL — this experiment is unrunnable as designed

Two facts close it, and they compound:

1. **Step 1 measured n = 0 clean nights** (§4b). Not two, as this brief first claimed — one physical
   Verity under two filename serials. No existing corpus supplies a single usable night.
2. **The sole acquisition route is DECLINED.** A second Verity unit will **not** be purchased. The
   owner's words, recorded verbatim rather than paraphrased into neutrality:

   > *"won't be purchased for one dubious experiment."*

**Therefore: the two-site residual-attribution experiment cannot be run, and the residual's
physiology-vs-instrumental attribution stays OPEN INDEFINITELY.**

⚠️ **This is a PARK WITH A STATED REASON, not a deferral.** The distinction is the point. A deferral
says *"later"*; this says *the only known route is closed and no one should spend time proposing a
way around it.* The house convention's parking form is `PROPOSED (deferred …)`, and this brief
deliberately does not use that word.

**Before proposing a wear-protocol variant, read the owner's assessment above.** The cost-benefit
judgement — that this is one *dubious* experiment — is part of the record precisely so that future
sessions weigh it before designing a cheaper-looking substitute. The obvious substitutes are already
disqualified in §3 (circular, common-mode, confounded), and the confounded Verity + O2Ring pair is
the one that will keep looking tempting because it is plentiful.

**Revisit only if a second real-axis PPG source materialises by other means** — a different device
class with a genuine device axis, a loan, a collaborator's capture. Not by re-litigating the purchase.

## 7 · What still stands, untouched by this

The campaign's product is unaffected. The eliminated-candidates table, the error budget, and the
clock-elimination result live in
[`PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md`](PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md)
§6b–§6c and are evidenced independently of this experiment. What is parked is **one cell** — the
origin of the 20–40 ms residual — and only that cell.

## 8 · Steps (retained for the record; NOT a work queue)

1. **Verify the n exists before building anything.** Count nights on vigil with two non-drawn PPG
   sites + ECG. `quality.timingSource` / `hostAxis.drawn` decide "non-drawn" — never the filename.
2. **Pre-state the bands and the predicted signs** before computing, per the campaign's standing rule.
   State the power the actual n supports, and **refuse rather than report** if the CI cannot separate
   the two candidates.
3. Extend `tools/pat-drift-attribution.mjs` with a two-site arm (it already loads both legs and
   computes per-night lag slopes; the new part is the site-pair correlation).
4. Report the correlation with its CI, and label the outcome SIGNAL / ERROR / UNINFORMATIVE — the
   third being a legitimate result, not a failure.

## 9 · Done when

- [x] **Two-real-axis-site night count established: ZERO** (§4b). The prior count of 2 was filename
      serials, not devices; refuted by address, by session non-overlap, by block structure, and by
      the absence of any third device writing files.
- [x] The shortfall was reported and the protocol change was put to the owner. **DECLINED
      2026-08-28** — see §6.
- [ ] ~~The residual is labelled SIGNAL, ERROR, or UNINFORMATIVE.~~ **Not achievable as designed.**
      It remains explicitly UNATTRIBUTED — which is a stated state, not an implied one.
- [ ] ~~`PAT-FORENSICS-WINDOW-ORACLE`'s §6c table updated with whichever cell this closes.~~ No cell
      closes; the table already records the residual as UNATTRIBUTED and that entry is now permanent
      absent a new PPG source.

## 10 · What this brief must not become

⚠️ **Do not re-open the campaign's settled findings to make this one tractable.** The window
mis-specification, the fiducial bounds, the clock elimination and the regime table are landed and
evidenced. This brief owns **one** cell — the origin of the 20–40 ms — and nothing else.

⚠️ **Do not substitute a confounded proxy because the clean design is unavailable.** The O2Ring pair
is *right there* and it is wrong; that is exactly how a confounded result gets published as a clean
one. If the n does not exist, say so.
