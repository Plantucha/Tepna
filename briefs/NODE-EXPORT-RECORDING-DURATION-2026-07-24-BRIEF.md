<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-27 · **Created:** 2026-07-24 · **Followed-by:** `NODE-EXPORT-DURATION-SEMANTICS-2026-07-27-BRIEF.md` (what the declared length MEANS) · **Follows:** `CAPTURE-HOST-INTEGRATOR-FOLD-2026-07-24-BRIEF.md` (§4, the ECGDex instance) · **Related:** `INTEGRATOR-BUILD-BRIEF.md`

# A node's export must DECLARE its recording length — or the Integrator drops it on an event-sparse night

> **The class.** The Integrator places each node on the fold's shared clock via
> `integrator-dsp.js adaptEnvelopeNode`, which derives a recording's `endMs` from — in order —
> `recording.endEpochMs` → `durationMin`/`durMin` → `durationSec`/`durSec`, **else the last event's `tMs`**.
> A node that declares **none** of those duration keys is placed **only by its events**. So on a night where
> that node emits **zero events**, its window collapses to a **zero-length point at `t0Ms`**, and
> `recWindow` → `overlapInterval` **excludes it from the fold's overlap intersection** — the node silently
> drops out of fusion even though it recorded a full night that genuinely overlapped the others.

## 1 · How it surfaced

The 32-night full-fleet fuzz run (25 June tri-device nights + 7 July capture-host nights, folding
ECGDex·PpgDex·OxyDex·MotionDex·PulseDex·CPAPDex through the Integrator; see the FOLD brief) flagged
**CPAPDex excluded from overlap with a zero-length window** on the event-sparse nights — e.g. **2026-06-11**,
a **2-minute** mask-on session (`therapyHours 0.03`) with **0 scored events**. The Integrator could not place
it, so the machine's own therapy/AHI data dropped out of the fold. This is the **same defect class** as the
ECGDex one fixed in the FOLD brief §4 (`durSec` added to `ecgBuildNodeExport`) — a *second* instance, which is
why it now gets its own brief and an audit of the whole fleet.

## 2 · Fleet audit — who declares a duration key the adapter reads

| Node | Reads-a-key? | What its `recording` carries |
|------|:---:|---|
| OxyDex | ✅ | `durationMin` |
| MotionDex | ✅ | `durSec` (DEEP-AUDIT-II §7.6) |
| ECGDex | ✅ | `durSec` (FOLD brief §4) |
| **CPAPDex** | ❌ | `therapyHours` + `sessions[].durMin` + `startEpochMs` — **none read by the adapter** |
| **PpgDex** | ❌ | `startEpochMs` + `sessions` (a **count**, not durations) — event-only window |
| **PulseDex** | ❌ | `startEpochMs` (sometimes **null**), no duration — event-only window |

- **CPAPDex** — CONFIRMED live failure (event-sparse night excluded). Fixed in this brief.
- **PpgDex / PulseDex** — LATENT: they folded in the fuzz run only because they had events; an event-sparse
  PPG/RR night would collapse identically. Follow-up (§4).
- An Integrator-side "read `therapyHours`" shortcut would fix only CPAPDex — PpgDex's `sessions` is a count and
  PulseDex has nothing — so the consistent fix is **node-side `durSec`**, matching OxyDex/MotionDex/ECGDex.

## 3 · Fix (this brief) — CPAPDex declares `recording.durSec`

`cpapdex-fusion.js cpapBuildExport` stamps `recording.durSec` = the **wall-clock span** from the night anchor
(`night.t0Ms`, first session start) to the **end of the last session** (`max(sessions[].t0Ms +
durMin·60000)`). This is the recording's true `[start, end]` for overlap — not `therapyHours` (which is
mask-on *usage*, excluding within-session off-mask gaps, and would understate the span). Additive, back-compat,
uses the key the adapter already honors. Behavioral for CPAPDex: re-bundle CPAPDex + orchestrators, regenerate
the 5 CPAP goldens (`tools/regen-goldens.mjs --node CPAPDex`), run the gates, drop a changeset.

**Done when:** an event-sparse CPAP night folds with a real (short) window instead of `nodesExcluded:[CPAPDex]`;
`build --check` clean · `run-tests` green · `verify-manifest` GATE A+B · CPAP equiv/golden legs green.

## 4 · Follow-ups

1. **PpgDex** — stamp `recording.durSec` in its node-export builder (session span). Latent sibling.
2. **PulseDex** — stamp `recording.durSec` (RR-tachogram span) AND investigate the **`startEpochMs: null`**
   observed on the real-`_RR.txt` legs (the Polar RR export's timestamp column may not be parsed by
   `parseRRInput`, leaving the node un-anchored on the clock — a separate anchoring bug worth its own check).
3. **Gate the class** — consider an Integrator test that asserts every KNOWN_NODES export carries a
   duration key the adapter reads, so a fourth instance can't ship silently.

---

## 5 · Execution — 2026-07-27

All three §4 follow-ups are closed. Verified, not assumed:

1. **PpgDex** — declares `recording.durSec`. ✅
2. **PulseDex** — declares `recording.durationMin`, which `adaptEnvelopeNode` reads (§4 asked for `durSec`
   specifically; the adapter's contract is *a key it reads*, and `durationMin` is one, so the node is
   anchored). The second half of that item — the suspicion that *"the Polar RR export's timestamp column
   may not be parsed by `parseRRInput`, leaving the node un-anchored"* — is **REFUTED**. Run against a real
   capture-host `Polar_H10_02849638_20260726005143_RR.txt` (`Phone timestamp;RR-interval [ms]`, 672 KB):

   ```
   t0Ms      1785027114806  → 2026-07-26T00:51:54   (row 1 is 2026-07-26T00:51:54.806 — exact)
   nRaw 23655 · nUsable 23654 · usable true · sourceFormat rr · 23655 stamps anchored
   ```

   `parseRRInput` parses the stamp column through the Clock-Contract `parseTimestamp`, anchors `t0Ms` and
   captures `offsetMin`. The observed `startEpochMs: null` therefore came from an input whose stamps did not
   parse (`tsValid` false) — which is the contract behaving correctly (§2.6: null, never fabricate), not an
   anchoring bug. **No fix was needed; the hypothesis was wrong.** Recorded so it is not re-investigated.
3. **Gate the class** — built. `tests/dex-tests.js` group **“Every node declares a recording length the
   Integrator can read”** (13 assertions, both lanes): all 8 node-export builders are brace-matched for a
   duration key, AND the five keys are pinned against `integrator-dsp.js` itself so the gate cannot silently
   under-test if a sixth is added. Structural on purpose — every instance of this class was invisible until a
   real night happened to be event-sparse.

   Mutation-checked: deleting `durSec` from `motiondex-dsp.js`'s `recording` block reds it with
   *“NONE — this node collapses to a point at t0Ms on an event-sparse night”*.

Fleet state at close — `ECGDex endEpochMs+durSec · PpgDex durSec · OxyDex durationMin · PulseDex durationMin ·
HRVDex durSec · GlucoDex durSec · MotionDex durSec · CPAPDex durMin+durSec`.
`run-tests.mjs` 4098 green.
