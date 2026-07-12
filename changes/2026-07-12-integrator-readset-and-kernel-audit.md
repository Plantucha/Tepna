<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator, ECGDex, PpgDex, GlucoDex]
brief: DEEP-AUDIT-2026-07-11-BRIEF.md
---
Stop the Integrator fabricating agreement it never measured and silently dropping nodes whose data it simply could not read — a glucose⟷autonomic coupling with no glucose in it, an HRV consensus that excluded the HRV node, and a kernel-drift audit blind to 3 of 7 nodes.

**§12 — "Sources agree … reliable" when nothing was compared.** `spread()` correctly returns `null` for a
metric no two sources share (each node honestly nulls what it lacks — legal under the contract). `|| 0`
converted that ABSENCE into a measured **0 % divergence**, which drove `qc:'agreement'` and the surfaced
note *"Sources agree within 0 % … reconciled autonomic state is reliable."* With nothing comparable the
divergence is now `null`, `qc` is `incomparable`, and the note says so.

**§13 — a coupling with none of the coupled signal in it.** GlucoDex's LIGHT ganglior export — the one
users are told to drop into the Integrator — writes its metrics under `glucose{}`; the read-chain knew
only the RICH summary's `glycemic{}`. So `glucoseCV` was `null` on **every** ganglior export, and
`fuseAutonomicGlycemic`'s single-pair fallback still published a confident
`glucoseAutonomicCorrelation = 0.44` with `n = 0`, computed from the ECG slope **alone**. The key is now
read, and the fallback requires the pair to actually carry a glucose value — a coupling between two
signals cannot be estimated from one of them.

**§14 — the HRV node could never join the HRV consensus.** HRVDex writes per-reading HRV under
`measurements[]` (the 2026-07-04 SELF-INGEST enrichment); the chain knew only `hrv.time.*`, so its
`rmssd`/`sdnn` were `null` on 100 % of exports and `fuseHRVConsensus` dropped it every time — silently,
with its values sitting right there unread. They are now read (median across readings) and the window is
labelled **honestly**: a Welltory capture is a short spot reading, so their median is NOT an overnight
whole-record value. Tagging it `wholeRecord` would let R8's like-window guard compare a month of morning
readings against one night's ECG — a false comparison dressed as a consensus. It is
`measurementMedian`, which the guard reports as a REASONED, VISIBLE exclusion instead of a silent null.

**§15 — the apnea rule was keyed by node, not by impulse.** `EVENT-LEXICON.md` is explicit that impulses
are keyed by the EVENT, not the signal that observed it, and lists CPAPDex as a first-class `desat_event`
emitter — it was deliberately migrated `desat` → `desat_event` to join this pool. It could not: the pool
was `_byNode(recs,'OxyDex')`, so a CPAP+ECG night produced `fusion.apnea = null`. Metamorphic proof: a
byte-identical `desat_event` stream vanishes from fusion when only the emitting node's LABEL changes.
Now pooled by the events a record actually carries.

**§16 — the kernel-drift audit was blind to 3 of 7 nodes.** ECGDex/PpgDex/GlucoDex passed `opts.kernel`
straight through, exporting the RAW `DexKernel` object (`{K, VERSION, HASH}`), while the Integrator read
the lowercase keys. Those three therefore always resolved to `hash: null` → status `missing`. On every
real multi-node night the user was told *"Node ECGDex built against kernel (none) — thresholds may
differ"*, which is **false** (the export carries exactly the right hash, under `HASH`). Worse, a GENUINE
kernel drift produced the IDENTICAL `missing` verdict — the audit could not distinguish real threshold
drift from its own blindness. The reader now accepts both spellings (so exports already in the wild are
audited correctly) **and** the three emitters are normalized to the contract shape.

Export-inert on the equiv path (`compute()` is called without `opts.kernel`): no fixture output moved.
