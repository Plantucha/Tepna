---
bump: minor
type: added
brief: SOLID-NIGHT-2026-09-23-BRIEF.md
---

The journal's clock-event lines now travel with the night. `LOSS-AUDIT.json` has always carried
`journal: "read"` — a STATUS, not the lines — so after the audit ran, "did the box record a clock event
at 04:08?" was unanswerable from the night's own files, and journald rotates. The journal-derived
CAUSES were already persisted per device (`by_cause`, `gaps`, `fragments`); what never survived is the
raw lines and anything nobody thought to bin at audit time.

`loss_audit.read_clock_events` reads the four phrases SOLID-NIGHT §A5 names — `off host (tolerance`,
`device clock JUMPED`, `re-sync busy`, `device clock unreadable` — in ONE pass for the whole night
rather than one per device, and `audit_night` writes them as `clock_events` with the devices each line
names. Kept deliberately separate from `KINDS`, which bins a line as the CAUSE of a gap: folding them in
would change loss attribution. `None` (journalctl unavailable) stays distinct from `[]` (read, and no
clock event happened), because only the second may license a consumer to conclude nothing was recorded.

Nothing reads the key yet. It is the record set §A5's unrecorded-shift tripwire needs, and the tripwire
is a separate unit.
