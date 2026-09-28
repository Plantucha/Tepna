---
bump: patch
type: fixed
brief: none
---

`tools/trio-power-headless.mjs` emits one `tepna.verdict/1` and **refuses instead of quietly substituting
the CPU pool** when the GPU it was asked for is not there.

**The silent substitution was the defect.** `requestAdapter()` returning nothing left `lane: 'cpu-pool'`
and the run CONTINUED — printing a worker-pool table under a tool whose whole purpose is the GPU
comparison, with the substitution visible only to a reader who happened to read the lane line. That is an
answer about a different machine than the reader thinks they are looking at. Now: **NOT_RUN** naming what
it tried · **FAIL** a software rasteriser refused without `--allow-software` · **SHORTFALL** a device that
never reaches the pre-stated ±0.15 half-width inside the N grid · **PASS** every device meets it. In every
case `result.basis` is named, never implied. `--cpu` is *not* a shortfall: the caller asked for the worker
pool, so the criterion still applies and the basis reads `cpu-pool`.

⚠️ **This guards a future state, not a live defect.** WebGPU works on rig-x870 today: a real run emits
`PASS` with `basis: "webgpu:amd/rdna-3"`, 200 trials in 2 s.

**And it withdraws the row that said otherwise, with the mechanism named.**
`2026-09-13-webgpu-absent-on-rig` reported `navigator.gpu` absent in three configurations and concluded the
GPU lane was dead and a shipped 5 M-trial/cell result unreproducible. Its observation reproduces exactly;
its inference is false. `navigator.gpu` is exposed **only in a secure context**:

```
about:blank                      -> isSecureContext:false, gpu:false
file:///…/OxyDex.html            -> isSecureContext:true,  gpu:true
```

The tool navigates to `file://` (a trustworthy origin), which is why it sees the real adapter where that
probe could not. The row's three "independent" configurations were one condition tested three times, so
their agreement read as corroboration. That finding is written into the tool's §2b as well as the ledger,
because §2 is where the next person reads the adapter ladder. **Not explained:** the row's reported 420 s
hangs did not re-observe (three launches completed well inside a 240 s bound); that is left unaccounted for
rather than dismissed.

**Census cost, paid in the same change:** the tool printed no verdict word before, so its absence from
`verdict-adoption.json` was *correct* rather than a hole — checked before claiming one. Printing status
words makes it join the enumerated population, so its `producers` row goes in as `adopted` with
`--verdict-sample`; the census stays at pending 0 (75 adopted / 133 exempt, `--check` green, 0 de-adopted).
Gated by `--selftest`: 15 assertions over the status map with no browser and no GPU, and `selftest-all`
discovers it (134 tools, 2108+ assertions, green).
