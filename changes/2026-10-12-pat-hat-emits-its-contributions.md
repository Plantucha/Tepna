---
bump: minor
type: added
brief: VERDICT-CONTRIBUTIONS-2026-10-04-BRIEF.md
---

The first of the five §2 figures publishes its attribution. `tools/pat-three-corner.mjs --verdict`
emits one `tepna.verdict/1` carrying the `contributions` block for one corner of the classic
three-cornered hat: each leg's signed partial of ½(V_ab + V_ac − V_bc), its share of the total
absolute movement, and the dominant leg. The object now answers the question the brief opens on —
which leg's variance drives the subtraction — so no reader has to open `analysis-stats.js` for it.

Status is UNKNOWN by design, through the shared band-less builder: a per-site sigma has no pre-stated
band, and a band written now would be a number rather than a test. The contract carries one block per
object, so `--corner` names the corner and the default takes the REFUSED one, which is single-valued
because at most one corner of the closed form can be negative.

The variances attributed are the ones the tool PRINTS — the squared median of the within-window IQRs,
not a plain across-window variance — so `analysis-stats.js` gains
`patHatContributionsFromVars(vAB, vAC, vBC, opts)` and the existing per-window spelling delegates to
it, the same split `tchSigmasPairwise` and `tchSigmasPairwiseFromVars` already carry. Handing the
windows to the per-window spelling would attribute a dispersion the printed hat never solved; the
suite now asserts the two routes are different quantities.

`--verdict-sample` plants 49 synthetic windows per leg, whose medians make the hat refuse the chest
corner. It reads no corpus, names no night, carries a fixed timestamp and says in its reason that it
judged planted legs — and it is what the adoption gate runs, so prose moves to stderr and stdout
carries the object alone. The correlated solve stays unattributed: its partials exist only as the inverse Jacobian
at the solution, and nothing publishes them.
