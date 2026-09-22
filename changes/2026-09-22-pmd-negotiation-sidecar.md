---
bump: minor
type: added
brief: DEVICE-RATE-TRUTH-2026-08-05-BRIEF.md
---

Every PMD START negotiation is written into the night as PMDNEG.csv — the menu the device reported, the rate chosen from it, the ack and whether the start was negotiated or fixed, refused starts included — and nightqc.rate_reality reads it, so a stream's rate is compared config vs device vs file instead of config vs file.
