---
bump: minor
type: added
brief: VERDICT-CONTRACT-2026-09-21-BRIEF.md
---

Two mutation-lane tools emit tepna.verdict/1 under the same mapping as mutate.mjs's diff gate: extreme-mutate's --baseline ratchet (PASS no newly pseudo-tested function · FAIL names them · NOT_APPLICABLE file not in the baseline · UNKNOWN canary survived) and mutation-suite's per-file canary decision (PASS canary died · UNKNOWN canary failed/voided/unreadable · NOT_RUN no canary). Both carry a --verdict-sample the adoption gate reads. stmt-delete is NOT flipped: it is a band-less measurement with no ratchet, recorded as such.
