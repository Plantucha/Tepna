---
bump: patch
type: fixed
brief: none
---

**Every `SignalSpec` dsp resolver now reaches the node that owns the function, and every one of them has a reader**.

`signal-spec.js` keys a fact-set by signal type. Each entry carries a lazy `dsp` resolver to the node's compute entry point. Four of those resolvers looked their function up by a bare page-scope name. That bare name is what `__DEX_NAMESPACED__` suppresses. Both shipped orchestrators and the Node suite set the flag before they co-load PulseDex, OxyDex and HRVDex. 

So in every realm a consumer computes in, `rr.dsp()` gave back `{ parse: undefined, stats: undefined }` and `spo2.dsp()` gave back `{ parse: undefined }`. The `parse` member of `hrv.dsp()` came back undefined too, beside the two members a 2026-06-25 assertion pinned. I measured the Node realm before the fix, then again after.

**The resolvers now resolve through the node's own namespace** — the public surface first, then the `_bare` helper object each migrated node also exposes. The orchestrator's host shims read that same surface, as `root.PulseDex.parseRRInput` shows. Registry and shims now name one function instead of running two independent lookups.

**A bare global is opt-in rather than a fallback**, because most of these names belong to more than one node. `parseCSV` names OxyDex's SpO2 parser and HRVDex's summary parser. Five node DSP files each define a `compute`. On a classic page carrying two of them, a bare lookup returns whichever node loaded last. Handing a consumer the wrong parser beats a visible `undefined` in no reading. So the bare step opens only for `parseRRInput` and `_pdSeriesStats`, which belong to PulseDex alone across every DSP in the repo.

⚠️ **The defect is what an unread resolver drifts into**. `SIGNAL-ADAPTER-FOLLOWUPS-II-2026-06-24-BRIEF.md` §8 asked for one assertion per migrated signal type. A rename on either side would then trip the gate. The item closed with the `hrv` resolver pinned and no reader for the other six. The four members that had no reader are precisely the four that went stale. The namespaced co-load landed afterwards and moved the ground under them in silence, because nothing read them.

**The reader is now a table rather than a type**. One group pins each resolver to the function identity the node exposes. Two population assertions guard the table. A signal type the orchestrator can emit must carry an expectation in it, and the table may not name a type the orchestrator cannot emit. 

Each expected value comes off the node, never off the registry, or the check would compare the registry to itself. `hr`, `acc`, `eeg` and `flow` resolve to `undefined`, because no node owns them yet. That absence rides as a tripwire on growth.

**Both directions measured**. Against the unfixed registry the new group fails 8 of its 35 assertions, naming the four stale members and no others. With the fix all 35 pass in the Node lane and in the browser lane.

Only `Data Unifier.html` and `OverDex.html` carry these two files, and both are non-provenance orchestrators. No app bundle, ledger or fixture moves. This PR re-bundles both orchestrators.
