<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
brief: MUTATION-FLEET-EXPANSION-2026-08-25-BRIEF.md
---
Owner-directed: the local model never idles, and keeps working with NO Claude session alive.
`tools/dsp-review-qwen.mjs` — function-by-function DSP review against the HOUSE rules (Clock
Contract, honest-null, signal-flow/units, per-sample efficiency; never style), each finding with
model-WRITTEN draft-fix code, plus `--mode adversary`: an attack persona producing concrete
falsifiable attacks (fabrication, poison propagation, clock attacks, boundary exploits, guard
evasion) with the literal attacking input and a minimal defeating guard. Resumable by
function-content hash; yields to pipeline work between functions; 16 selftests. Every output is
an untriaged MODEL PROPOSAL for coordinator triage — the §0 invariant (model widens what is
searched, never what decides) is stated in the tool and in every report header.
`tools/qwen-idle-driver.sh` + a user systemd timer (30 min, flock, Nice=10): when no sweep/crawl/
probe/draft is running, drives drafts for crawl-complete files → review fleet → adversary fleet,
all journaled — so a token-quota outage produces a triage pile, not an idle GPU.
