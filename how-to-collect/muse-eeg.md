<!--
  how-to-collect/muse-eeg.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# How to collect — Muse EEG (overnight)

**Device:** InteraXon **Muse S** (the sleep band; Muse 2 also works for shorter sessions).
**Signal:** raw **EEG** (`eeg`) ~256 Hz, 4–5 channels (TP9/AF7/AF8/TP10 + ref) → **EEGDex** (the only
node that does *real* sleep staging — Wake/N1/N2/N3/REM + band powers).
**Adapter / path:** **Mind Monitor CSV** is the EEGDex default input (`EEGDEX-BUILD-BRIEF.md`); the
host reshapes its stream to that layout. Open **`EEGDex.html`** directly, or route via the `eeg` path.

## ⚠️ Raw EEG is BLE-stream-only
The Muse app exports *staged sleep*, not raw EEG; raw needs a live BLE capture.

**`muse-lsl` covers every current model.** Gen 1–2 have always worked (the `bleak` backend, clean on
Linux) → LSL → CSV. **Athena (Gen 3) is supported from v2.5.0**, and **`--ppg` maps to the Athena
optics stream from v2.5.2**.

**`OpenMuse` is an alternative, and a stale one.** It was purpose-built for the Athena when nothing
else handled it, and that gap is closed. Last push **2026-01-28**, **10 open issues**, including
**#27 OPTICS/PPG channels flatlining (null data)** and **#24 incorrect optical channel mapping** —
both untouched since May/June 2026, and both in exactly the optics path a PPG capture depends on.

🔴 **THIS SECTION SAID THE OPPOSITE UNTIL 2026-09-19, AND THE ERROR IS THE INSTRUCTIVE PART.** It
claimed *"muse-lsl and BlueMuse fail on it — use OpenMuse"* and told you to **confirm your model
before buying into a toolchain** because *"it flips muse-lsl ↔ OpenMuse."* That was true when written
on 2026-06-30 and **upstream fixed it the same day** (`74fcb916`, released as v2.5.0 on 2026-07-01).
So for eleven weeks this guide warned about a constraint that no longer existed — and the cost of
believing it was buying the *worse* toolchain, or avoiding the better device, for an expired reason.

⚠️ **A claim about a third-party project is a SNAPSHOT, and it needs a date and a version or a reader
cannot tell what it is a snapshot OF.** A local doc can tell you which tools exist; it cannot tell you
what they support today. **Currency is not inheritable** — not from a doc's recency, and not from its
having been right last time. Every toolchain claim above carries the version and the date it was
checked, so the next reader knows exactly how stale it may be.

⚠️ **AND IT CAN BE MACHINE-READABLE BUT NOT MACHINE-CHECKED, WHICH IS THE LIMIT.** The claims below
carry a SHA, a version and a date, so a reader — or a tool — can see exactly what they are a snapshot
of. **No gate can verify them**: checking an upstream repository needs network, and no gate or bundle
in this suite may have it. So the honest form is a dated claim a human re-checks, not a check that
reds when it goes stale. Saying which of those you have is the point; a dated claim reads as verified
long after it stops being true.

**Verified 2026-09-19** against the upstream repositories: muse-lsl `74fcb916` (2026-06-30, Athena
support) and `c5a327b4` (2026-09-08, `--ppg` → Athena optics); releases 2.5.0 on 2026-07-01, 2.5.2 and
2.5.3 on 2026-09-08. OpenMuse last push 2026-01-28.

## Capture
`tepna-capture` runs the right tool as a child process, captures LSL → CSV, and reshapes to the Mind
Monitor column layout EEGDex expects. **Battery:** streaming *raw* EEG drains faster than the app's
sleep mode — confirm the band survives ~8 h (Muse S is the one to use overnight).

## File layout & naming
Mind Monitor CSV; name device-id + 14-digit stamp:
`Muse_S_<DeviceId>_YYYYMMDDHHMMSS_eeg.csv`.

## Clock Contract
Mind Monitor stamps look like `2026-05-12 23:55:00.400` (no zone) → parser branch 3 (`Date.UTC` of
components verbatim, `offsetMin=null`) → floating `tMs`; some exports carry `±HH:MM` → branch 2 (zone
authoritative). Parsed by **explicit regex**, never `new Date(str)`; a stamp-less row → `null`.

## Evidence grade (do not inflate)
Single-channel automated staging is `emerging` (literature-backed, **not PSG-validated**); band powers
`measured`; ratios `emerging`; spindle/SWA `experimental`. The capture path changes none of this.

## Where it goes
Drop the CSV into the **Data Unifier** / **OverDex** → routes to the `eeg` path → EEGDex computes a
`ganglior.node-export` (a real hypnogram + stage events onto the Ganglior bus). EEGDex's staging is what
the other nodes' "stages are HR/SpO₂ heuristics, not EEG" apologies point at — it anchors sleep
architecture for the whole fused night.
