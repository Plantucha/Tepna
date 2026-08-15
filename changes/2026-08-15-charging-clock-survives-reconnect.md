---
bump: patch
type: fixed
---

**The charging guard was correct, wired, and structurally unreachable in the one scenario it was written
for.** Found live: a Verity streaming noise into its charger for over an hour while the monitor showed
`LIVE`, `106 bpm` and `worn: True`.

`full_battery_implies_charging` exists because a battery pinned at 100 % cannot *rise*, so the normal
charging rule is blind: 45 min of a flat full battery on a device that drains ~9 %/h means a dock. It
needs **45 minutes of uninterrupted connection**. The clock lived inside `run_polar`'s
`async with _connect(...)` block — i.e. **inside the reconnect loop** — so every dropped link reset it.

**A device sitting in a dock is precisely a device that keeps dropping its link.** Measured 2026-08-15,
the Verity's sessions ran **5.2, 3.1, 3.5, 21.4 and 22.1 minutes**. Across ~65 min of docked streaming
the clock never once passed 22, so the guard could not fire — and every guard downstream of `charging`
was disabled with it, including the 180 s not-worn drop that exists to end exactly this.

`prev` — the battery level the rule compares against — already read from module-level `STATUS` and **did**
survive reconnects. Half the rule persisted and half reset, which is why the asymmetry was invisible from
either half.

The clock now lives in a per-device module-level store, extracted as pure `telemetry.note_flat_battery`.
Its regression test runs five ~10-minute sessions and asserts the window is reached; a **counterfactual**
test clears the store each session — what the connection-scoped local did — and asserts it never fires, so
the regression cannot pass for an unrelated reason.

**Also: the optical vote was fooled in the same incident, and now is not.** `worn_optical` said
*"worn per ambient-stability"* — a dock has beautifully stable ambient light, so the vote meant to be the
honest one was a false positive in exactly the condition that matters. Both votes agreed, so the
disagreement warning could not fire either. `pulse_prominence_worn` asks instead whether there is a pulse
at all, and **overrules the ambient proxies** (a proxy loses to a direct measurement) while never
overruling the contact bit (a cold, poorly-perfused wrist can genuinely show no pulse, and a false
not-worn costs a night).

    worn night, 12 windows   prominence  1 985 .. 18 161 494
    docked,     10 windows                   4.9 .. 34.4      → 58x apart, nothing between

Threshold 250 = sqrt(34.4 x 1985), ~7x above the loudest dock and ~8x below the quietest worn beat.

⚠️ **The obvious fix was measured and rejected.** A motion veto does not work: a sleeping arm sits at ACC
SD **2.2 mg**, *quieter* than this dock's 3.4 mg. A motion threshold would veto real sleep — a worse
failure than the one it fixes. Do not re-propose it without re-measuring.

⚠️ Note also that the docked stream's spectral peak lands at 45–54 bpm, entirely plausible — which is why
the monitor believed 106 bpm. The peak's *location* carries no information; its *prominence* does.
