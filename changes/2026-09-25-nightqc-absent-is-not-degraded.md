---
bump: patch
type: fixed
brief: none
---

`night-qc` no longer stamps **FAIL** on a night nobody wore the devices. Every zero-row stream lands in
`missing`, and ANY `missing` entry was a FAIL — so a kit sitting on its dock convicted the box of a fault
belonging to nobody. **"Never started" and "recorded badly" are opposite findings**, and only the second
is this gate's business; the SOLID-NIGHT band says so directly (a no-wear night is NOT_APPLICABLE, never
FAIL, and the consecutive counter SKIPS it).

Measured live on **SOLID-NIGHT night 1**, 2026-09-24 at 21:33 EDT: `status: FAIL`, criterion
`stream_coverage >= 0.5`, seven of nine streams at 0.46–0.48, on a night whose primary waveform was zero
because the Verity answered `in_charger` on every PMD negotiation and the H10 and ring never connected.
The radio was demonstrably alive — the Verity linked at RSSI −47, battery 100.

**A device that produced nothing is now EXCLUDED, not failed**, and the witness is read here rather than
borrowed:

- **some devices recorded, others did not** → the recording siblings PROVE the radio worked, so each
  absent device is declared-but-not-judged. Its streams move to `excluded`, its `missing` entries stop
  convicting it, and the verdict comes from the devices that did record.
- **every expected device is absent** → nothing witnesses the radio, so no-wear is indistinguishable
  from a dead adapter and the answer is **UNKNOWN**, naming the two states it cannot separate. Never
  NOT_APPLICABLE on absence alone — that is the band's own rule, and the upgrade needs the per-radio
  ADAPTERHCI witness, which is a different producer's fact. `absent` and `absent_witnessed_by` are
  published so the SOLID-NIGHT composer can apply it; this verdict does not reach across and guess.

The population stays an **equality**: an absent device was declared, so `checked + excluded == eligible`
and a PASS over `checked: 0` remains invalid by schema. A device with SOME streams missing is **not**
absent — that is a partial failure and stays FAIL.

⚠️ **What this does NOT fix, stated because the evidence is gone.** Night 1's 0.46–0.48 came with
`missing: []`, so those streams had rows and the absent-case guard would not have fired on them. Every
stream read `span_basis: "session"` with `span_sec: None` — the documented fallback of
`2026-09-24-qc-coverage-device-span` firing because no device span could be bounded — and
`stopped_early_s` was 18,766 s for the H10 beside a 0.52 coverage. That looks like a second defect in the
fallback (it hands an unbounded device the union span and mints a number for it), but the kit was strapped
on at 21:49 and the night directory now holds real data, so the 21:33 state cannot be re-read. Recorded
rather than guessed at, and the fixture here is **synthetic** — which the corpus rule requires anyway.

Five new tests: three plants and one plant-mislabelled-as-control (all four fail against `origin/main`),
plus one true control — a device that recorded and lost packets still reads FAIL at 0.47, which passes on
both sides and shows the refusal did not blind the gate.
