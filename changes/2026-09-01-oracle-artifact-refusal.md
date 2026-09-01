<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [pat-tools]
brief: PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md
---
`pat-window-oracle` handed a quotable band verdict to nights whose recovered mode sits outside the
physiological band — a 25 ms or 1245 ms "PAT" is not a transit time, and `modeInPhys` was computed but
gated nothing (a bracket suffix on the line, ignorable by every consumer). The recorded refusal-class
candidate is now decided (owner's deputy: refuse, not flag) and built:

- **`oracleVerdict()`**: mode outside PHYS [200, 650] ⇒ **ARTIFACT REFUSAL**, with the mode quoted as
  diagnostic and no band verdict — the `hostAxis` bound-exceeded discipline applied to alignment
  artifacts. Keys on the PHYS band deliberately, not the 200–500 acceptance rail (that stays the
  acceptance layer's sanity band; this is physical impossibility).
- **The verdict line carries the mode + its invariance status** beside the w-dependent band label:
  the mode is w-invariant by construction, plus a per-night first-vs-second-half mode agreement
  diagnostic (`halves ≡` / `halves A→B ⚠`). #2029's consumer hazard — a night reading NO RECOVERY at
  w=300 while recovering the identical 215 ms — is now answered on the line itself.
- Corpus effect, measured against a same-corpus pre-change baseline run: the refusal invariant holds
  exactly — all 6 out-of-window nights (07-22 125 · 08-01 165 · 08-02 185 · 08-06 895 · 08-10 815 ·
  08-31 655 ms), and only them, move to ARTIFACT REFUSAL; every mode identical; the four signal
  nights (07-24 405 · 08-12 315 · 08-17 215 · 08-18 355) keep mode and verdict; zero other verdict
  changes. The brief's recorded five-night candidate list was stale (membership moved with #2034's
  overlap-split fix, before this change) — deviation reported in the brief stamp, with the failed
  halves-agreement expectation on the signal nights (the known offset wander, surfaced per-night).
- Selftest 8 → 15, including a both-sides plant: a tight 100 ms lag that the band layer alone WOULD
  quote as SIGNAL RECOVERED (asserted, proving the plant is seen) is refused; a slow-train 700 ms
  plant refuses high (a 1240 ms plant against RR≈900 aliases mod RR — beat trains align only mod one
  heartbeat — so the high plant rides RR 1500±300).

`oracleNight`'s existing return fields are untouched (consumers `pat-drift-attribution` /
`pat-residual-structure` import it unchanged); `modeB` is additive.
