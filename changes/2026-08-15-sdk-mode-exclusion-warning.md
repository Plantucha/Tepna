---
bump: minor
type: added
brief: POLAR-ONBOARD-BACKUP-FOLLOWUPS-2026-08-11-BRIEF.md
---

The monitor's SDK-mode control now says what it costs, and `POST /api/settings` warns when the saved
config asks for a state the hardware cannot hold.

Enabling SDK mode on a Verity **disables PPI and HR**. The UI presented SDK mode and the stream
checkboxes as independent controls, so the config could express that impossible state and the only
symptom was two streams quietly absent — no error, no log line, just missing data.

**It cannot be derived, so it is stated.** Nothing in the PMD feature set announces the exclusion: the
device advertises SDK mode, advertises PPI, and says nothing about the two being mutually exclusive. It
ships as a Verity-family fact, which is what the brief allowed for where derivation is impossible.

**Three surfaces, because the UI one is the bypassable one:**

- the control's help text now ends *"**Costs PPI and HR** — a Verity cannot serve those in SDK mode, and
  they go quiet rather than erroring"*, visible whether or not there is a conflict;
- a red banner appears on the control when SDK mode is on **and** `ppi`/`hr` are configured, naming the
  streams — the half you see *before* the click, which is what the brief asked for;
- `POST /api/settings` returns a **`warnings`** array and the save message renders it in red. This is
  the load-bearing half: it is testable, and it fires for any client that never renders the banner.

**It warns; it does not refuse.** The exclusion is a family fact, so a hard refusal would block a
legitimate config written for hardware that does not have it. *"Silently winning"* was the defect, not
"permitting".

**The check is on the FINAL state, not on the `sdk_mode` edge.** The conflict arrives from both
directions, and adding PPI to a device already in SDK mode is the likelier one — an edge-triggered check
would miss it entirely. That case has its own test and its own mutant.

**`warnings` is always present, even when empty.** A key that appears only on trouble teaches a client
to read its absence as "no trouble", which is indistinguishable from a server older than the check.

Four tests, each DENY paired with an ALLOW (no conflict ⇒ empty array; disabling ⇒ never warns).
Mutation-verified: dropping the warning, making it edge-triggered, and warning on disable each red the
intended assertion.

**Also in this unit — a correction to the same brief's §0.** It opened by stating that
`power.drop_not_worn_sec = 0` on vigil, *"the not-worn drop is DISABLED and stays that way until §2
lands"*. Measured on the box today it reads **180.0**: the drop is restored and live. §2 was discharged
by work that landed after the brief was written — `optical_worn` already refuses outside its calibration
rate, and a *second* detector (`ambient_stability_worn`) now covers 176 Hz, because the pegging inverts
between the rates and each statistic is blind at the other's. A brief that states a live degraded state
is the one a reader trusts most, so a stale one is worse than a stale plan.

Capture-host only: no bundle, no JS lane, no fixture.
