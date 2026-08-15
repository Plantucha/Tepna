---
bump: minor
type: fixed
brief: NODE-EXPORT-DURATION-SEMANTICS-FOLLOWUPS-II-2026-08-09-BRIEF.md
---

PulseDex stops claiming 100 % coverage on a stream it cannot place in time, and `durationMin` stops
silently changing meaning between branches.

`beatTimes` has two branches: with timestamps it returns a wall SPAN, without them it cumulates RR. So
`durMin` meant ENVELOPE on one branch and DATA on the other under one field name. Worse, `coverage` was
initialised to **100** and only ever overwritten on the timestamped path — a completeness claim made
from the ABSENCE of evidence, which is the failure the Clock Contract §2.6 and this brief family exist
to prevent. Both are live on real input, not latent: an untimed RR file is a whole input class
(`parseRRInput`'s vals-only path).

The fix follows HRVDex's sparse block, the in-tree template: **the envelope and the data get different
names**, and the one that cannot be known is `null` rather than estimated.

| field | means | untimed RR |
|---|---|---|
| `spanMin` | ENVELOPE — wall span | **null** (no wall clock ⇒ no envelope) |
| `recordedMin` | DATA — what the beats account for | the beat sum |
| `coveragePct` | data ÷ envelope | **null** (needs an envelope) |
| `durationBasis` | which of the two `durationMin` is | `"beat-sum"` / `"envelope"` |

⚠️ **`durationMin` deliberately keeps its value, and that is a decision rather than an oversight.** It
is not only a publication: `classifyRecording` does arithmetic on it, and `adaptEnvelopeNode` builds
this node's Integrator fusion window from the exported `durationMin`. Nulling it would collapse that
window to a POINT — which is precisely the DEEP-AUDIT-III §6.2 regression HRVDex already paid for, where
a 29-day export overlapped nothing and dragged every other node's `intersectionMin` to 0. So the
ambiguity is resolved by **labelling** rather than by deletion: the two meanings are published under
their own names, and `durationBasis` says which one `durationMin` equals. A consumer can now tell the
branches apart, which it could not before.

The alternative — requiring timestamps — is explicitly rejected by the brief and would be wrong: untimed
RR is a real input class, and the fix is to stop claiming what it cannot support.

**The characterization pins did their job.** The gate carried two `KNOWN DEFECT (FOLLOWUPS-II §1)`
assertions pinning the wrong values so a fix could not silently satisfy them. Fixing the DSP reddened
the group exactly as designed and forced the assertions to be rewritten. They are now CONTRACT, and the
timestamped branch is asserted to carry the same three keys with the opposite verdicts — otherwise the
discriminator would be half-wired and a consumer still could not tell the branches apart.

**Compute-path, computed not claimed** — `computeHash e8f4070fe122 → 67624a697ce1` (MOVED ⇒
re-verification owed), `manifestHash b0b504918c87 → 1c57b2ca0b66`. All three PulseDex fixtures
regenerated with `tools/regen-pulsedex-goldens.mjs`: **exactly the three new fields moved on each**, no
existing value changed. `verifiedUnder` re-stamped after a green corpus run — run, not asserted. The two
orchestrator bundles were rebuilt too (they inline `pulsedex-dsp.js`), and `docs/PulseDex.html` with
them.

GlucoDex (§2 of the same brief) is a separate node, a separate re-bundle and a separate PR; its pin
stays red-capable and untouched.
