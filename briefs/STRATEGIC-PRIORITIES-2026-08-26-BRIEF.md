<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — the competitive agenda; items flip state as they ship or their gates open) · **last-verified:** 2026-08-26 · **Created:** 2026-08-26 · **Relates:** `EXTERNAL-LANDSCAPE-2026-08-20-BRIEF.md` (sibling projects), `MEASUREMENT-PROVENANCE-ROADMAP-2026-08-26-BRIEF.md`, `PAPERS-ROADMAP-2026-06-24-BRIEF.md`

# Strategic priorities — what makes Tepna first in its class, owner-dispositioned

> The comparison classes: OSCAR (CPAP community breadth) · NeuroKit2/PhysioNet (algorithmic
> credibility) · Kubios (HRV validation standard) · LSL (sync architecture) · consumer apps (reach,
> the anti-model). Tepna's standing moat, per the landscape survey: **nobody combines local-first +
> privacy-as-CI-gate + content-addressed provenance + evidence-graded numbers + published negative
> results + this depth of clock metrology.** The survey found no public counterpart for the RTC
> readback, the vibration fiducial, the raw dual-wavelength stream, or overnight BLE sync residuals.
> The gaps are REACH and EXTERNAL CREDIBILITY; every item below serves one of those without trading
> the moat away.

**Owner dispositions recorded 2026-08-26, verbatim intent per item.** Order below is the OWNER'S
execution order, not the original proposal order.

## P1 · INTEROP IMPORT — first, as the acquisition funnel *(owner: "should probably go first to attract people from other tools")*
Import adapters for the formats existing communities already hold, so OSCAR / PhysioNet / LSL users
can drop their data in and see the evidence-ladder treatment applied to it: **WFDB records** ·
**XDF** (LSL's interchange) · broader **EDF** beyond CPAP · candidate: OSCAR session data. Import
attracts users at community scale; device breadth (P2) grows them one device at a time — hence the
inversion of the original ordering. Enters the Data Unifier through the existing `SignalAdapters`
spine (one adapter each, no new architecture). First step when picked up: a survey brief — format
by format, what maps cleanly, what refuses honestly (a foreign file with no timing provenance gets
UNKNOWN fields, never fabricated ones). Export mapping stays the measurement roadmap's §11 doc.

## P2 · DEVICE BREADTH — the Unifier/adapter spine IS the path *(owner: "isn't unifier on path to that?" — yes)*
Confirmed: no new machinery; each vendor = a parser + adapter + registry entries in the spine that
already routes dropped files. Vendor queue by user-base × effort: **Garmin / Fitbit / Apple Health /
Oura file exports** (file-drop, zero BLE work) → **Philips and other CPAP vendors** (OSCAR supports
dozens; we support one) → native **Libre / Dexcom** CGM exports → further oximeters. Each adapter is
a small dated brief; the LITERATURE-USE and evidence-tier rules apply to every vendor's derived
fields (a vendor's black-box score imports at `heuristic`, never above).

## P3 · "CHALLENGE THIS NUMBER" — the provenance bundle export *(owner: "excellent idea")*
One click on any surfaced metric → a self-contained evidence bundle: value, measurement block,
provenance chain (envelope ref, input hash, code identity), window/clock domain, quality facts,
limitations. This is the USER FACE of `MEASUREMENT-PROVENANCE-ROADMAP` §3/§4 — sequenced right
after that roadmap's reference path lands; no comparable project offers anything like it.

## P4 · LONGITUDINAL CHANGE DETECTION with honest uncertainty *(owner: "excellent idea")*
"Your rMSSD shifted on this date — effect size, confidence, evidence chain." Builds on OverDex
(archive fusion, shipped) + the ICC papers (which metrics are traits vs states — the prior that
makes change detection honest). Consumer apps fake this; nobody does it locally with provenance.
Sequenced after P3 (it consumes measurement blocks). Change-point method choice gets its own brief
with pre-stated nulls (the treatment-response step-R²-under-null lesson applies).

## P5 · PUBLIC-BENCHMARK VALIDATION — GATED *(owner: "not until we have some 2 weeks without errors, possibly after PAT works — that will probably proof there is not processing errors")*
MIT-BIH (QRS) · CinC sets · NSRR/MESA — the credibility currency. **Gate, owner-set: ~2 weeks of
error-free operation; possibly PAT producing credible output as the internal no-processing-errors
proof.** Honest note carried with the gate: the published PAT wall is *physiological* (PTT
variability, `PAT-UNDER-PERBLOCK-ALIGNMENT`), so "PAT works" is read as the pipeline demonstrating
integrity, not as beating the wall — the two-clean-weeks condition is the operative trigger. When it
opens, the §5 oracle harness points at public data; nothing new to build first.

## P6 · SDK — DOCUMENTATION ONLY *(owner: "documentation only no expansion... possibly use guide to make eegdex")*
Write the "add a Dex from a manifest" guide over the existing codegen pipeline
(`codegen/dex-registry-gen.js` + `dex-gen.js`, proven end-to-end on `eegdex.manifest.json`). No
productization, no plugin system. EEGDex is the guide's natural test case **but stays PARKED per the
2026-08-04 owner decision** — the doc is written standalone; exercising it on EEGDex waits for the
owner to unpark.

## P7 · SLEEP STAGING — BLOCKED ON DATA *(owner: "waiting for data from NSRR")*
Honest cardiorespiratory staging validated against expert labels, shipped with its confusion matrix
— parked until NSRR data arrives. When it does: the papers-roadmap 3.2 re-sequenced path; the REM
stability-detector wall stays the cautionary prior (stability proxies are a priori wrong).

## Deliberately NOT pursued (the anti-moat)
Cloud/server anything · ML black boxes · coaching gimmicks · medical-device claims · notification
engagement loops. Every comparable that went there traded away the property that makes Tepna
defensible. The path to first is P1–P4 on top of the moat, not breadth-matching every rival.

## Sequencing summary
P1 survey brief next free JS-lane slot → P2 vendor queue runs continuously behind it → P3 after
measurement-roadmap §3/§4 → P4 after P3 → P5 when the owner's gate opens → P6 doc whenever idle →
P7 on data arrival. Items flip state here as they move; this file is the dashboard, per-item work
lives in dated executable briefs.
