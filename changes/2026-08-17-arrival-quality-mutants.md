---
bump: patch
type: fixed
---

**12 mutants survived on `arrival_quality`: every one of those lines could be changed and the whole
suite stayed green.** They were covered — just never observed.

The diff-scoped gate raised them on #1405 (advisory, so it did not block). All 12 are now killed, each
verified by applying the mutant by hand and watching the specific test fail.

| survivor | what nothing asserted |
|---|---|
| `int(host_ms / 1000.0 / bin_s)` → `* bin_s` | the bin operator. Every existing grid test used a `bin_s` where `*` and `/` agree closely enough to pass. |
| `jit = host_jitter(diffs)` → `None`, `host_jitter(None)` | that the jitter summary reaches the row at all. |
| `stab = allan.stability(...)` deleted | that the stability curve reaches the row at all. |
| `tau_s=(stab or {}).get("optimal_tau")` → `None` (×3) | the **wiring**. `timing_uncertainty` is tested directly and knows a missing tau makes `free_run` None; nothing checked that `arrival_quality` hands it the tau its own curve chose. |
| `streams.sort(key=...)` → `key=None`, `+len`, `s[1]` tie-break | that the transport pair is the two **densest** streams, tie-broken by **name**. |
| `continue` → `break` (both sites) | that a device which cannot be paired does not abandon the devices after it. |
| `first = xs[0]` → `xs[1]` | see below. |

## The one that was nearly filed as equivalent

`first = xs[0]` → `xs[1]` in `device_stamp_constant` survives **4006 probes** at the default `min_n`,
and the whole-domain argument says why: if `xs[0] == xs[1]` the two are identical by substitution, and
if they differ **both** return `False`. No input at `min_n=200` can separate them.

`min_n` is what separates them. It is a **parameter**, and at `min_n=1` a one-element series is
trivially constant — the original says so, the mutant reaches for a second stamp the guard never
promised and raises `IndexError`. So it is killable, and an equivalence entry would have been a false
claim in the one file whose false entries can hide a real defect. The ledger is untouched.

## Two gate behaviours worth recording

⚠️ **A same-length mutant can be masked by cached bytecode.** `s[0]` → `s[1]` is byte-identical in
length, and after restoring the original the suite still reported the mutant's failure. Every
verification here clears `__pycache__` and runs `python -B -p no:cacheprovider`; without that, "killed"
and "restored" are both unreliable.

⚠️ **`mutate_diff.py` on a tests-only branch reports `no capture-host/*.py changed — nothing to check`
and exits 0.** Correct behaviour, and it is *not* evidence the mutants are dead — it examined nothing.
The evidence here is the by-hand application of all 12, not that run.
