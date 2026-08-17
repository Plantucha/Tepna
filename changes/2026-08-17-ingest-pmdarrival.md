---
bump: patch
type: fixed
---

**The per-packet arrival sidecar was admitted as a PRIMARY WAVEFORM in both ECGDex and PpgDex.**
Measured against the real routers, `Polar_H10_..._PMDARRIVAL.csv` returned `ecg` from `ecgKind` **and**
`ppg` from `ppgKind`, because it matches no companion suffix and falls through to the bare-name
default.

    Polar_H10_02849638_20260813_PMDARRIVAL.csv   ecgKind: ecg    ppgKind: ppg     <- before
    Tepna_20260731000024_LINK.csv                ecgKind: skip   ppgKind: skip
    QC-SUMMARY.json                              ecgKind: skip   ppgKind: skip

This is **§6.4b a generation later, and the same defect for the same reason**: the file postdates the
guard. `nonSignalName` was written after a real night folder admitted *40 of 67 "ECG recordings"* that
were the host's own telemetry. The arrival sidecar began **2026-08-11**, days after that set was
fixed, so nothing covered it — and a real night folder carries **7–341 of them** (341 on 2026-08-13,
245 on 08-16). One drop queued every sidecar as a recording, each dying later inside `analyze()`.

## The fix names the file, not the container

`.CSV` is deliberately **not** added to the extension set. A genuine waveform legitimately arrives as
`.csv` — `recording.csv` still defaults through to the node primary, which is the reason the
bare-name default exists at all. Excluding by extension would set those aside too, trading one
fail-open for a fail-closed.

Four assertions join the existing §6.4b set-aside list, pinning **both device spellings** (the H10 and
the Verity each write their own; a vendor-prefixed name is the one that reaches the default). They
**fail 4/4 without the fix** and pass 130/130 with it.

⚠️ **NOT export-inert.** `dex-ingest.js` is inside the compute closure, and `computeHash` moved on
both bundles — ECGDex `a9b2b198f69f → 1eee209e9a78`, PpgDex `16583a17082c → bf9e1d1f8bd8`. So
`build.mjs` re-stamping ten fixtures' `manifestHash` is exactly the step §🔏 warns about, and the
fixtures were re-verified against the real corpus rather than left on that re-stamp. ECGDex, PpgDex
and both orchestrators re-bundled; `docs/` served copies rebuilt.
