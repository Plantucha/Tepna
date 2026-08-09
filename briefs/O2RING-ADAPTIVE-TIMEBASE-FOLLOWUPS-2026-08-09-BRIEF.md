<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-09

# O2Ring adaptive timebase — follow-ups

The timebase feature is shipped and DONE (`O2RING-ADAPTIVE-TIMEBASE`, PRs #1037/#1048/#1057/#1072 + the
bad-host acceptance #1089). This captures what execution surfaced that is NOT code-complete — one
operational step, one nice-to-have field confirmation, and the process gotchas that cost time.

## 1 · Deploy to vigil (operational — the feature is merged but not LIVE)

The capture-host half (Stage 1 label, 3a `timebase_decision` + CLOCK-sidecar column, 3b `# timebase=`
embed in the `ppg1` file) is on `main` but **the box runs the old code**, so no captured O2Ring file
carries the `timebase` stamp yet. A deploy is `git pull` on the box **plus** `sync-apps.sh` (git pull is
only half — see the deploy note). Do it between nights (no capture in progress) so the daemon restart
drops no data. After deploy, verify a fresh `ppg1` file's first line is `# timebase=device-crystal`
(or `host-disciplined` if the box is a genuine stratum-1) and that the CLOCK sidecar has a `timebase`
column.

**DONE 2026-08-09 — and it largely self-resolved.** The box auto-updates: `tepna-update.sh` pulled the
merged PRs and restarted the daemon at 08:14:16 EDT, 3 s after writing `capture.py` (08:14:13), so the
**running daemon already carried the whole feature**. Remaining steps performed by hand: `git pull
--ff-only` for one trailing docs commit (box now 0 behind) and `capture-host/deploy/sync-apps.sh`
(23 bundles: 19 current, 10 refreshed, 0 failed). The capture daemon stayed `active` throughout — no
restart, no data dropped. **Verified live**: the CLOCK sidecar being written now carries the two new
columns and the correct verdict —
`…;synchronised to stratum 1 via 192.168.0.123;0.028;host-disciplined`.
Still outstanding: the `# timebase=` line in an actual `ppg1` file, because PPG was idle that session
(the file exists at 0 rows). It will stamp on the next O2Ring PPG capture; `ppg` is enabled in the box
config, so no action is needed — just confirm it once.

Also fixed on the box while there: the gitignored `config.yaml:110` still pinned `ppg_fs: 125.738`
(the retired ROW rate). Set to `125.000` with an inline reason + a timestamped backup; YAML re-parsed
(`o2ring.ppg_fs = 125.0`); no restart (the value is the grid's starting guess and slews regardless, and
a capture was in progress). It takes effect at the next automatic daemon restart.

## 2 · A REAL bad-host ECG night (nice-to-have, NOT a blocker)

The bad-host acceptance (#1089) is synthetic (+2000 ppm injected) and corroborated on the real 2026-08-01
night — sufficient, because the crystal's invariance is magnitude-independent. A real travel/stratum-3
night with a paired H10 ECG would *positively* confirm it in the field, but the local corpus is all
home/stratum-1, so it waits for such a capture. Route any such night through `/tmp/badhost.mjs` (or a
committed variant) to compare host vs crystal vs ECG.

## 3 · RETRACTED — vigil ALREADY syncs to a real LAN stratum-1; no GPS hardware is needed

**This section originally proposed buying a Navisys GR-701W USB GPS (PPS over DCD, ~$45) to "give vigil a
real stratum-1". That was wrong, and it was wrong because it was written from a note instead of a
measurement.** The `vigil-box-clock-facts` note reads "chrony/local-stratum-1", which was taken to mean
chrony's **`local stratum 1`** directive — orphan mode, a *self-asserted* stratum with no reference clock.
It actually meant "a **LAN** stratum-1 server". Measured on the box 2026-08-09:

- `/etc/chrony/chrony.conf:49` — **`server 192.168.0.123 iburst prefer`**. There is **no `local`
  directive**, so orphan mode is not in play.
- `chronyc -n sources` — `^* 192.168.0.123 **Stratum 1**`, reach 377, offset +74 µs, err ±1514 µs.
- `chronyc -n sourcestats` — freq skew **0.007 ppm**, offset **−19 ns**, std dev 12 µs over a 90 min span.
- `chronyc -n tracking` — the box is Stratum 2 (⇒ **source**-stratum 1 after the documented
  `parse_chrony_tracking` normalisation), skew **0.008 ppm**, root dispersion 1.44 ms.

So **192.168.0.123 is a genuine stratum-1 reference on the LAN**, vigil is a legitimate stratum-2 client of
it, and the shipped `timebase_decision` gate is deciding `host-disciplined` on a **well-founded** stratum —
not a fiction. Confirmed live in the CLOCK sidecar (`…;0.028;host-disciplined`). Buying a GPS-PPS receiver
would add nothing: the box already clears both bars (source-stratum ≤ 1, skew ≤ 1 ppm) by a wide margin.

**The two things this DOES settle, so neither is re-raised:**

1. **The self-asserted-stratum risk is REFUTED for this deployment.** A `local stratum N` box would pass the
   stratum bar without a real reference, and the skew bar is the only thing standing behind it. That
   remains a genuine hazard *for any future host* — but it is not what vigil is doing.
2. **The crystal default is rarely exercised at home, BY DESIGN and correctly.** Because vigil earns
   host-discipline nearly every night, the 125.000 crystal path fires only when travelling or when NTP
   breaks — which is precisely the case it exists for. Under-exercise in production is not a defect here;
   it is why #1089 proves the crystal's invariance synthetically rather than waiting on field conditions.

The identity of 192.168.0.123 itself is unrecorded (no rDNS; MAC `86:20:f6:d6:c4:1d`, locally-administered).
Worth naming in `vigil-box-clock-facts` so the next reader does not repeat the misreading above.

## 4 · Process gotchas this pass (so the next timebase-adjacent change is cheaper)

- **§3 above is the headline one: a recommendation was written from a NOTE instead of a MEASUREMENT, and
  the note's phrasing was ambiguous.** "chrony/local-stratum-1" was read as chrony's `local` orphan
  directive; one `grep local /etc/chrony/chrony.conf` + one `chronyc sources` — thirty seconds, and both
  were run *eventually* — falsified it and made a ~$45 hardware recommendation moot. This is exactly the
  failure CLAUDE.md §2b names ("if you think two populations are inseparable, **run the query before
  writing that down**"), reached by a different road: not an impossibility claim, but a *purchase* claim.
  When a note is the only evidence for a recommendation, measure first — and if the note's wording could
  carry two meanings, fix the note (see the closing line of §3).
- **A DSP change re-bundles THREE build trees, and the analysis tree is the one that bites.** #1018 red on
  CI four times purely because `resp-acc-analysis.html` (inlines `integrator-dsp.js`) was never rebuilt —
  `build.mjs --check` (owned bundles) and `verify:docs` were green while `verify:analysis` stayed STALE.
  Run `npm run check` (all three) or explicitly `tools/build-analysis.mjs`; do not infer green from a
  hand-picked subset.
- **`biome ci` fails on FORMAT, not just lint.** Run `biome format --write` on an edited `.js` BEFORE
  re-bundling — formatting changes the inlined text, so the manifestHash moves and you must re-bundle
  again. (Cost this pass: a full re-bundle + re-verify redo.)
- **`verify-fixtures` re-stamps `verifiedUnder` for EVERY stale node**, not just the one you changed.
  Revert the non-target `provenance/*.json` fragments so the work-unit stays clean (§👥.2).
- **Bundle PRs churn each other DIRTY on every merge.** An open bundle PR goes DIRTY the moment another
  bundle PR lands; land them fast, and expect to rebase + regenerate (bundles usually come out
  byte-identical, so the redo is cheap once the analysis tree is remembered).

## 5 · Done-when

**§1 DONE** (deployed + verified live, incl. the `config.yaml` rate fix); its only residue is eyeballing a
`# timebase=` line on the next O2Ring PPG capture, which needs no action. **§3 RETRACTED** — measured away,
no purchase to make. **§2** stays open indefinitely by nature: it waits on a travel night that may never
come, and is a nice-to-have because #1089 already proves the property. **§4** is captured here; the two
durable entries (three build trees · measure-before-recommending) belong in the shared runbook if they
recur. **Nothing here is code owed against the shipped feature** — this brief can be stamped DONE once §1's
one-line confirmation lands, with §2 noted as deliberately-open.
