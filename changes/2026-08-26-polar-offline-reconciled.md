---
bump: patch
type: changed
brief: POLAR-OFFLINE-DOWNLOAD-2026-07-17-BRIEF.md
---

Docs-only reconciliation of the three Polar onboard/offline briefs against the code, oldest first.
No behaviour changes; every Done-when clause was re-measured rather than re-read.

**`POLAR-OFFLINE-DOWNLOAD` (IN-PROGRESS since 2026-07-17) — status correct, follow-up 3 is not.**
Its follow-up 3 asks to automate the SDK offline-recording button "so the raw-PPG `.REC` gets written
… the raw waveform PpgDex wants, without holding the link all night". The **mechanism** it was waiting
on has since landed — `polar_pmd.py` carries `OFFLINE_BIT = 0x80`, `as_offline()`, `is_offline_cmd()`,
measured on hardware 2026-08-02. But two facts measured *after* this brief make its aim unavailable:

- the raw-PPG `.REC` **does not fit** — ~2 MB of flash against ~297 B/s gives ~1.96 h, not a night.
  Polar's "up to 600 h" is the same ceiling read from the HR end (`600 × 3600 × 1 Hz × 1 B = 2.16 MB`),
  i.e. a 1 Hz figure; two independently-derived ratios agree to 3 % (297x vs 306x).
- offline PPG is **exclusive with live PPG** — `ERROR_ALREADY_IN_STATE`. Automating the button does not
  add a backstop beneath the live capture; for PPG it replaces it.

So the two follow-ups swap places: what the flash supports is exactly the HR-rate offline recording the
`.BPB` files already are, making **follow-up 1 (the `.BPB` decoder) the one carrying the value**, and
follow-up 3 collapses into it. Verified absent while checking: there is no `.BPB` decoder anywhere in
`capture-host/` or `tools/` — `BPB` occurs only as filenames (PII, bonding table, listings). Also
verified that the web-pull clause is still unexercised: `/api/polar/pull` is contract-tested, but every
one of those tests is **mocked**, and a passing endpoint test is not a demonstrated pull.

**`POLAR-ONBOARD-BACKUP` — stays PROPOSED, and the note explains why it looks otherwise.** Its rule is
"flips to IN-PROGRESS when the probe has run and §6's three questions are answered". The probe HAS run
and Q2/Q3 are answered, so checking only the first half flips it wrongly. §6 Q1 (does the H10 accept
`SampleType.RR`) is still open — no start command was ever sent, because that needs an `_ALLOWED_QUERIES`
widening the brief deliberately gates. The blocker is now stated beside the rule that depends on it.

**`POLAR-ONBOARD-BACKUP-FOLLOWUPS` — no change.** Its header is already accurate (§2 SUPERSEDED,
§3 EXECUTED, §4 open, §5 needs no code).

`DOCS-INDEX.md`: date synced, and two stale facts in the row corrected — it still named the pre-merge
routes `/api/recordings`/`/api/pull` (renamed to `/api/polar/*` when the O2Ring took `/api/pull`), and
still listed automate-the-button as a live follow-up.

⚠️ Nothing here was refuted by a new experiment. Every number was already measured, in briefs written
*after* the one that needed them — the answers existed where the next reader of this brief had no
reason to look. That is the argument for reconciling briefs on a schedule rather than on suspicion.

**`CAPTURE-HOST-FOLLOWUPS-II` (2026-07-16) — PROPOSED → IN-PROGRESS.** The header had stayed PROPOSED
while the body recorded the opposite: §1 is titled *"ALL THREE EXECUTED 2026-07-18"*, §3 R1 is **DONE
(verified 2026-07-18)**, §4.2 closed on its own "executed or re-homed" clause, and §5's clock/NTP work
*"has since landed on `main`"*. Its Done-when — *"what remains before this brief can flip DONE:
everything left is hardware-gated"* — has named the remaining work since 2026-07-18. Nothing is newly
measured; the flip only makes the one-word status agree with the sentence below it. `DOCS-INDEX` row
synced with the same correction.

Note the shape shared with `POLAR-ONBOARD-BACKUP` above, in opposite directions: one brief read as
flippable and was not, the other read as unflippable and was. Both are only decidable by reading the
brief's own criteria against the code — the one-word status is the least reliable field on the page.
