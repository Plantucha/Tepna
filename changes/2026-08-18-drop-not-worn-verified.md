---
bump: patch
type: fixed
---

**`POLAR-ONBOARD-BACKUP-FOLLOWUPS`'s preamble said a safety setting was "holding disabled on the live
box". It is not — verified on the box 2026-08-18.** `/opt/tepna/capture-host/config.yaml` carries
`power.drop_not_worn_sec: 180.0` and `not_worn_recheck_sec: 90.0`.

**Config presence is not behaviour, so the journal was checked too**, and it fires:
`not worn for 180s — dropping`, **91 events in 7 days** (H10 7, Verity 84). The claim is retired on
evidence rather than on the setting merely appearing in a file.

⚠️ **Check the SYSTEM journal, not the user one.** `journalctl --user -u tepna-capture` returns **0 lines**
— the unit is a system service — and a zero from the wrong journal is indistinguishable from a setting that
never fires. That misread happened once during this verification; it is recorded in the brief so it does not
happen twice. Same family as the repo's standing warning about checks that report cleanly having examined
nothing.

The original sentence is left standing in the brief rather than rewritten, per the house pattern: it was
true when written and the reason it changed is the part worth keeping.

Gate: docs-ledger, release-ledger.
