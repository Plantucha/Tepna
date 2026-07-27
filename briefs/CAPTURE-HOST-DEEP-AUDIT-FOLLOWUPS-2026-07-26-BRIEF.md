<!--
  CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS-2026-07-26-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-07-26 · **Follows:** `CAPTURE-HOST-DEEP-AUDIT-2026-07-26-BRIEF.md`

# Capture-host deep audit — follow-ups

What surfaced while executing `CAPTURE-HOST-DEEP-AUDIT-2026-07-26-BRIEF.md` (all 27 findings shipped,
capture-host pytest 1391 → 1471 green), plus the scope that audit declared it did not cover. Nothing
here is a regression from the executed work; §1 and §2 are residues the fixes exposed, §3 is the
parent's own §G list, and §4 is a process lesson worth keeping.

**Scope inherited:** out-of-suite (`capture-host/`). No bundle, no `manifestHash`, no fixture. The gate
is `capture-host/.venv/bin/python -m pytest tests/ -q`.

---

## 1 · Residue the fixes exposed

### 1.1 The A3 warm-up error is real, bounded, and uncorrected — `capture.py O2PpgGrid`

The O2Ring's sample step cannot be measured until `_O2PPG_EST_MIN_S` (30 s) has elapsed, so the first
30 s of every session is written at the configured rate and that error is frozen into the accumulated
ns column. **Measured: a flat +0.227 s per session, unchanged from a 1 min session to a 10 h one** —
a one-off, not a rate, against a defect that accumulated +9.2 s every hour. Pinned by
`test_the_warm_up_error_is_bounded_and_does_not_accumulate`.

It is uncorrected because correcting it means rewriting samples already emitted, which would break the
strictly-increasing guarantee parsing depends on. **Options if it ever matters:** buffer the first
frames until the estimate lands (adds latency and a failure mode at session end), or persist the
last-measured rate per device address across sessions (the ring's oscillator is stable — the parent
brief measured a per-session spread of only ±0.12 %) so a warm session starts already calibrated. The
second is cheap and would take the residual to ~0. **Not done here** because it introduces
cross-session state, which is the exact bug class §A1 was about, and it deserves its own decision.

### 1.2 `Science.html` links to pages that must never be served — `deploy/sync-apps.sh`

§C7 narrowed the served set to the owned bundles + a whitelist, verified as 65 pages → 23 with all 11
owned bundles resolving every reference. Two residues remain, both pre-existing content issues rather
than deploy defects:

- `Science.html` links to 15 analysis harnesses and gate pages (`Dex-Test-Suite.html`,
  `verify-provenance.html`, `cohort-runner.html`, …). Those need the whole module tree and are
  deliberately NOT served, so they are dead links on a deployed box. Either drop them from the served
  copy of that page, or stop serving `Science.html`, or serve the harnesses with their assets —
  the third is a much larger deploy surface and probably wrong for an appliance.
- `index.html` references `feed.xml` and `sitemap.xml`, which **do not exist in the repo at all**.

Neither is measurable from inside `sync-apps.sh` — it can only copy what exists. A link-checker over
the SERVED tree is the honest gate, and would have caught both.

### 1.3 `capture.py` is 3159 lines and the pruner is one of several teardown paths

§C8 fixed the header-only pruner to use `StreamWriter.discard()`. The audit noted that only
`run_polar` can own an `hr` writer, so only that teardown could orphan a sibling — that is still true,
and the other teardowns were left alone. If a second two-file writer is ever added (a stream with its
own sidecar), every teardown that removes `wr.path` becomes wrong again. `discard()` exists; the
remaining sites should adopt it on contact rather than in a sweep.

---

## 2 · Deliberately not taken

### 2.1 §D5 — comment-preserving config writes

`ruamel.yaml` would round-trip the operator's comments. It was **not** adopted: a runtime dependency
purchased for a cosmetic gain is a SOUP entry on a 62304-aligned appliance (`docs/COMPLIANCE/`), and
the suite's runtime SOUP is empty by design. The loss is announced instead — a banner in the emitted
file and one journal warning per process — and `config.example.yaml` is named as where prose survives.
**Revisit only if** an operator-facing need appears that the example file cannot serve.

### 2.2 §D1 — the target-less disable path

The parent brief's Fix text and its own verifier correction disagree: the Fix says `"target" not in
body` should leave the target untouched, the correction says that is the designed disable path used by
monitor.html and four tests. The correction was followed. **If the Fix text was the intent**, the UI's
`stBody()` (which always sends `target`) would need a companion change and those four tests would need
inverting — a UI-contract change, not a bug fix, and it needs the owner's call.

---

## 3 · Scope the parent audit declared it did NOT cover

Carried forward verbatim from its §G, so none of it is mistaken for verified:

- **~15 remaining swallowed `except` sites in `capture.py`** — lines 344, 359, 368, 422, 442, 507,
  943, 978, 1516, 1787, 1899, 1966, 2004, 2028, 2085. Same class as §C1/§C2, unexamined.
- **The backward NTP step measured but unfiled**: a backward step re-anchors and the written Phone
  column genuinely rewinds (≈ −30 s mid-session). Credible, reproduced, **needs a decision** — it is
  the mirror of §A1 and the honest answer may be that a backward step should be absorbed too while a
  file is open. Now cheap to implement: `open_sample_writers()` already exists.
- **No hardware exercise.** Every §A1 scenario is a simulated clock pair. A real NTP step, a real
  suspend/resume and a real DST crossing on the box are untested.
- **Frame decoders were not differentially diffed** (`polar_pmd` vs `oxyii` vs `viatom` bit-packing,
  delta frames, resync-to-lead-byte). A numeric-equivalence pass of its own.
- **`polar_psftp.py`, `oxyii.py` below the live-frame mapping, `bonding.py`'s session machinery,
  `diskguard`, `adapter_ab`, `probe_oxyii_ppg`** — read in passing, no executed repro.
- **`pull_session.py`'s partial-download path**: on a mid-transfer `asyncio.TimeoutError` the loop
  breaks and the short buffer is still written to the final `.dat`. Noticed, not reproduced — and it
  is the same defect §C5 fixed one module over, so it is likely real.
- **`monitor.html`'s client side** — XSS/escaping of device names and error strings, unaudited.
- **The real box's live host state** was never inspected: `/etc/systemd/system`, `/srv/tepna/app`, the
  installed Caddyfile, and which interface is actually `wlp1s0`. §C7 and §E5 are judged from the repo;
  confirming them on the box is outstanding.
- **`/run/media/michal/data/tepna-archive` is not mounted here**, so §C4's live shortfall could not be
  measured — only its reachability window.
- **`PPG_INVALID` (156 / 0x9C)** is still written raw into every O2Ring `_PPG.txt`; `oxyii.py:246-257`
  documents that "no consumer rejects it". Not audited downstream.
- **The browser lane entirely.** Nothing in the parent moves a `manifestHash`, so nothing required it —
  but `Dex-Test-Suite.html?full` and `verify-provenance.html` are **unverified, not passing**.

**Immediate operational item, unresolved:** the live box reported `cpap.state: "error"` at 2026-07-26
21:4x with `enabled: true`, `at_hour: 13`, dest `/srv/tepna/captures/cpap`. §E5 and §C5 are both
plausible causes and both are now fixed, but the box was not touched during execution. **Pull the
`detail` string off `/api/state` before assuming either fix covered it.**

---

## 4 · Process lesson: a test that re-implements its subject tests nothing

`tests/test_o2ring_ppg_gap.py` carried a faithful-looking port of the grid logic with a note saying it
was "kept deliberately in step" with `capture.py`. It was not, and could not be — and that is *why*
§A3's one-sided correction stayed green through a prior audit that specifically re-examined this code.
The port and the shipped code agreed about the safe direction, and neither was ever driven through the
other.

The same shape appeared twice more in this execution: `tests/test_ppg_grid_check.py`'s fixture
interpolated its ns column linearly, so every file it produced was uniform — including the one named
`..._an_inflated_grid_...`, whose "gaps" were ±1 ns rounding artefacts; and the §A3 verifier's own
"rows/wall" reasoning was right while the hunter's narrative about it was wrong.

**Worth a sweep of its own:** grep the suite for tests that reconstruct logic rather than import it.
`AUDIT-PROMPT.md`'s bug-class list has *sibling divergence*; this is its test-side twin, and the
`TEST-AUDIT-FINDINGS` species (a gate asserting the wrong thing) is the third member of the family.

---

## Done when

- §1.1 decided (persist per-device rate, or accept the +0.227 s and say so in the parent).
- §1.2 has a served-tree link checker, or the two pages are reconciled.
- §3's backward-NTP-step question answered — it is the only item there that is a live correctness
  question rather than unexamined scope.
- The live box's `cpap.state: "error"` detail pulled and explained.
- A follow-up spawned for whatever this one surfaces, or a note here that nothing did.
