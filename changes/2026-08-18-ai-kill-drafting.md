<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: []
brief: MUTATION-SUITE-FOLLOWUPS-2026-08-17-BRIEF.md
---
`mutation-suite.mjs --draft` — the local model drafts a killing assertion for every killable mutant,
and is structurally prevented from stating anything that could be wrong.

**The crawl had already done the expensive half and was throwing it away.** For 346 of the 363
killable mutants the probe recorded a concrete `(callPath, input, orig, mutant)`: an input that
provably distinguishes the real code from the mutant, plus what each returned. Writing the test was
never a search — it is transcription. Only the count reached the report; the triples sat unread in
`*.crawl.json`.

**This does not overturn `MUTATION-SUITE-FOLLOWUPS` §5b, it routes around it.** That section recorded
model-drafted assertions as a NON-GOAL on a measured **0/4 at judging code correctness** — a
plausible-but-wrong assertion passes, is quoted as evidence, and could never have failed. Still true.
So the model is never asked for a judgement. It supplies exactly two things:

- **PROJECTION** — which field to compare. **Machine-checked**: `projectionDiscriminates` evaluates it
  against the two *recorded* outputs and requires them to differ. Pure function over committed JSON —
  no model, no test run, no opinion. A wrong projection cannot survive.
- **PROPERTY** — an English sentence naming the behaviour. Not checkable, which is why every draft
  lands in a review file and never in the suite.

The **expected value is copied verbatim from the real code's recorded output**. The model cannot
state a falsehood about behaviour; its only failure mode is a field that does not discriminate, caught
in microseconds.

**`think: false` is load-bearing.** qwen3.6 is a reasoning model and, left to deliberate, spends its
whole budget inside `<think>` and returns `response: ""` with **HTTP 200** — no error, no warning.
Measured: **0 of 3 usable at 130–202 s** with thinking on, **3 of 3 correct at 20–24 s** with it off.
An empty reply is therefore a refusal to retry and report, never "the model had nothing to say" — the
same shape as every other check here that ran and examined nothing.

**Validated against ground truth.** The first case drafted is the `tsValid && → ||` mutant killed by
hand last session, where the discriminator (`tsMs: null` vs `[]`) was found by diffing every returned
field. The model reached `out.tsMs` independently, with the property named correctly.

**What it still cannot do, and why nothing is auto-committed:** a projection can discriminate and
still pin the *wrong* behaviour — asserting what the code does rather than what it should. No
verification detects that, because the mutant dies either way. The output is a proposal queue.

**Model and context are measured, not chosen**, scored by that same objective verifier over a fixed
10-case sample across five files:

| config | accepted | s/case | tok/s | accepted drafts/min |
|---|---|---|---|---|
| `qwen3.6:35b-a3b` ctx16384 | 7/10 | 17.4 | 1.8 | 2.4 |
| `qwen3.6:35b-a3b` ctx1024 | 7/10 | 13.9 | 2.2 | 3.0 |
| `qwen3.8:27b` ctx1024 | 8/10 | 1.6 | 35.5 | 30.0 |
| **`mistral-small` ctx1024** | **8/10** | **1.1** | **40.8** | **43.6** |

⚠️ **The 18× is a VRAM-fit cliff, not model quality, and the direction is counter-intuitive: the
BIGGEST model is the slowest by an order of magnitude.** This box has a 20 GB RX 7900 XT;
`qwen3.6:35b-a3b` is 23 GB, so ~17 % spills to CPU and it runs at **1.8 tok/s** — absurd for a
3B-active MoE, and that absurdity is the tell. MoE suffers most from a spill because expert weights
scatter across the bus. Every model that *fits* runs 30–41 tok/s regardless of family.

⚠️ **"Give it a bigger context" was measured as the wrong lever.** This lane's prompts are 216–509
tokens (p50 253); 16384 → 1024 bought 20 % and moved the split only 83 → 84 %, because it is the
**weights** that do not fit, not the KV cache. A larger context would take VRAM back from the weights.

**Retries now fire on any rejection, and change the sampling.** At temperature 0 the model is
deterministic, so re-asking is a re-run, not a second try; attempt 1 is greedy and retries move to
Qwen's published sampling. On the real lane this took the pilot from **2.9 → 35.2 drafts/min with 0
rejected** (was 1 of 8).

101 selftests; **10/10 planted mutations caught**. Two were only caught after the assertions were
strengthened: the charset allowlist had no test of its own (every escape case was also caught by the
denylist *backstop*, so deleting the *primary* defence survived), and the model-written label was
escaped **then** truncated — a cut landing mid-escape leaves a trailing backslash that swallows the
closing quote. That second one is the `mdCell` defect already fixed once in this same file, ten lines
away. Proximity is not protection.
