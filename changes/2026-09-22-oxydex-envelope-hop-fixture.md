---
bump: minor
type: added
brief: MEASUREMENT-PROVENANCE-ROADMAP-2026-08-26-BRIEF.md
---

A fourth OxyDex fixture — a stored O2Ring .dat night WITH its acquisition envelope — makes the measurement block's envelope hop real: evidence.envelopeRef is a session_id the DSP joined (decode → computeNight → _attachAcqEvidence → buildNightElement, no DSP change, computeHash unmoved). measurement-walk re-derives the hop from the envelope on disk (session_id in the filename, artifact_sha256 vs the bytes), pins every ledger input, and emits one tepna.verdict/1 per fixture under --json. Committed-bytes gate pins the ref in CI; the equiv leg re-derives it locally; a corrupted session_id reds the hop by name.
