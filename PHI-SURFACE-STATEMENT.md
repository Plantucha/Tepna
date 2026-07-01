<!--
  PHI-SURFACE-STATEMENT.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** REFERENCE (living — re-verify when any export shape or `provenance` pipe changes) · **Created:** 2026-06-29 · **Supports:** `EXPORT-IDENTITY-FOLLOWUPS-II-2026-06-29-BRIEF.md` §4(b)

# Tepna — PHI / data-handling surface statement

The evidence pack a compliance reviewer signs off **on**. It enumerates, per export channel, exactly what
each Dex node emits versus what is scrubbed at the ingest boundary. This statement records the *engineered*
data posture; it is **not** a legal determination (see §4 — that is the external sign-off this supports).

## 0 · Operating posture (the one-line truth)
**100% local.** Every analyzer runs entirely in-browser from the dropped file(s); there is no network, no
CDN, no telemetry, no server (CLAUDE.md; `AUDIT.md`). Nothing a node computes or exports leaves the device
unless the **user** saves a file and shares it themselves. Intended use is research / personal insight, NOT
a certified medical device — every user-facing surface carries the health intended-use disclaimer
(LICENSING-BRIEF §6.5).

## 1 · What a `ganglior.node-export` contains (per channel)
| Field | Content | PHI? |
|---|---|---|
| `recording.contentId` | identity-free content digest (12-hex), folds **signal payload + floating `t0Ms`** only — never a name/serial/DOB | **No** (EXPORT-IDENTITY §2.1) |
| `recording.startEpochMs` / `t0Ms` / event `tMs` | **floating** wall-clock ms (Clock Contract §1) — civil time encoded as UTC, viewer-timezone-independent; not a real UTC instant, so not geolocatable to a zone | No |
| `recording.*` summary (durations, counts, AHI/ODI, mode, sessions) | derived clinical metrics | No (aggregate physiology) |
| `ganglior_events[]` | impulse + conf + `t`/`tMs` + metric meta | No |
| `schema.provenance.files` | source filename **scrubbed** → vendor family + lane tag + ext only (`SignalFrame.scrubFilename`) | **No** — name/serial/dates/hex-ids dropped |
| `schema.provenance.inputs[].name` | **scrubbed** through a byte-faithful mirror of the same algorithm (-II §2) | **No** |
| `schema.provenance.inputs[].bytes / lastModifiedMs / sha256` | file size, mtime, content hash | No — identity-free, were never PHI |
| `kernel.{version,hash}` | physiology-rulebook stamp | No |

## 2 · What is explicitly NOT emitted
No patient name, no device serial / MAC, no date-of-birth, no raw vendor filename, no geolocation, no
account/login identifier, no free-text. The user profile (age/sex/height/weight, used only to derive
VO₂/Karvonen zones) lives in the operator's local store and is **never** written into a node-export.

## 3 · Identity arc that produced this posture (traceability)
- **Content-addressed handle** instead of a serial counter or patient/device id (`recording.contentId`,
  EXPORT-IDENTITY §2.1) — same recording → same id, deterministic, identity-free, now surfaced by **all
  emitter nodes** (OxyDex · PulseDex · ECGDex · PpgDex · GlucoDex · HRVDex · CPAPDex) and **consumed for
  dedup** by the Integrator (EXPORT-IDENTITY-FOLLOWUPS-II §1).
- **PHI scrub on BOTH provenance pipes** — `provenance.files` (parent) and `inputs[].name` (-II §2).
- **Floating wall-clock** time model — display is viewer-timezone-independent (Clock Contract §5).

## 4 · What this statement does NOT do (the open item — §4(b))
This documents that the data was made *more minimal and traceable*; it does **not certify** the suite for a
real-subject deployment under HIPAA / GDPR / MDR. That applicability is a **compliance call, not a design
one**, and remains **OPEN pending external sign-off** before any deployment on identifiable real subjects.
Until then the posture stands as: research / personal, local-only, disclaimer-stamped.
