---
bump: patch
type: fixed
brief: none
---
`parseDevicePPI` read the Verity's **nanosecond sensor stamp as the PP-interval**, so four days of box-captured nights had no device cross-validation at all.

Two layouts exist and both are first-class inputs:

```
SELF / PSL    Phone Data RX timestamp;PP-interval [ms];error estimate [ms];blocker;contact;…
BOX           Phone timestamp;sensor timestamp [ns];HR [bpm];PP-interval [ms];error estimate [ms];blocker;skin contact;…
```

Reading position 1 as the interval is correct for the first and reads the sensor clock for the second. Measured on the real file (`…/2026-08-04/Polar_VeritySense_0C301E3F_20260804225118_PPI.txt`): **194 rows, zero intervals in band, every `ppi` 0** — while the real **365 ms interval sat unread in `blocker`**. `validatePPI` then reported `usable:false, nDevice:0`.

**That is why it never surfaced: nothing was fabricated, so no gate could fire.** A present measurement reported as absent — the mirror of §∅, which is about absence reported as a measurement.

Columns now resolve **by header name**, falling back to the positional layout only when there is no header, and **refusing with a named reason** (`ppi-header-names-no-interval-column`) when a header exists and names no interval column. Falling through is exactly how this happened: an unknown layout read as a known one. The Clock Contract already says regex the explicit format and never assume position — this applies that to vendor *columns*.

**Scope, measured rather than assumed.** All **7 distinct box-layout recordings** fall in 2026-08-02 → 2026-08-05; the current writer emits the PSL layout, and the newest Verity captures (09-22, 09-23) confirm it. So this is a **corpus-recovery fix for 7 historical nights, plus a guard against the next writer change** — not a live capture defect. All 7 flip from 0 usable intervals to in-band (78/78, 740/742, 193/194, 144/144, 51/51, +2), and the 08-04 night's `validatePPI` goes `{usable:false, nDevice:0}` → `{usable:true, nDevice:137, devMean:980, devRMSSD:49.3}`.

⚠️ **The fix opens a door the zero rule must also guard.** Reading the box columns correctly surfaces `HR [bpm]` for the first time, and the Verity writes 0 there for whole nights (the documented all-zero device HR). 0 bpm is not a measurement, so it takes the same 20–260 band `ecgdex-dsp parseDeviceHR` applies and becomes null. Measured: that row's `hr` went `1 → null` once the columns were right — and the `1` was the skin-contact flag.

⚠️ **Method note, because my first count was wrong.** I first swept one corpus root and reported 7; that was right by luck — the second root holds 366 more PPI files, and my loop had silently broken on a path containing a space. The corrected two-root, null-delimited sweep: 449 files, 391 PSL / 32 box copies / 26 header-only, the 32 being the same **7 distinct recordings** duplicated across roots. A count from one root is not a corpus count.

No golden moves: the 7 files are gitignored corpus, so the committed twin — real rows from the 08-04 file, values as-is — is the only thing that can hold this.
