---
bump: patch
type: added
brief: none
---

`RUN_MIN_BY_STREAM` covered `acc`, `accraw`, `ppg`, `ppg1` and `ppg2w` — so **the H10's ECG had no run
sidecar at all**, and an H10 validity band could only ever read UNKNOWN by construction rather than by
measurement. §∅ requires the run-length detector on every device from day 1, keyed on run length against
the stream's own distribution and never on a value: an ECG in µV crosses zero on every beat, so a `!= 0`
rule is exactly inverted for this stream.

**The threshold is derived, and this is the measurement.** Whole H10 ECG corpus on vigil, 2026-09-24:
**304 files, 196,172,536 samples.** Run lengths of identical consecutive µV, split by whether the held
value is near baseline or at high amplitude (the file's own rail is ±19,165 µV; its modal value is 18 µV):

| run length | runs | held at \|µV\| ≥ 10000 |
|---|---|---|
| 05–09 | 226,661 | 455 (0.2 %) |
| 10–19 | 4,207 | 357 (8.5 %) |
| 20–29 | 172 | 167 (97.1 %) |
| 30–49 | 155 | **155 (100 %)** |
| 50+ | 312 | **312 (100 %)** |

Two populations, separating at 20–30. Below it a run is the ordinary quantization of a real ECG near
baseline; at 30 and above the corpus contains **no near-baseline run at all**. So `ECG_RUN_MIN = 30` is the
smallest threshold whose natural population is EMPTY over 196 M samples — zero false positives measured,
not argued — and it catches 467 runs. 20 would catch 639 and admit 5 near-baseline runs. `T_STUCK` (200)
would catch only 101 and miss 366 of the 467, which is why ECG does not simply reuse it.

⚠️ **The false negative, stated because a new gate owes one:** a constant episode shorter than 30 samples
(231 ms at 130 Hz) is not reported. And every run this rule catches today sits at \|µV\| ≥ 10000 — the
amplifier at or near its rail — so **in-band constant blanking has never occurred on this stream at any
length ≥ 30 in this corpus**. On the H10 this is a saturation/lead-off detector in practice, and it stands
as the tripwire that reds the day in-band blanking first appears, which is what §∅ asks for.

The longest run in the corpus is 1665 samples (12.8 s) holding 19164 µV — that file's exact maximum,
against a minimum of −19166. A rail, not an in-band level.

⚠️ **The feed is the half that is easy to forget, and forgetting it has shipped here before.** A stream
with a `RUN_MIN_BY_STREAM` key whose writer never calls `feed` produces `runs=0 examined=0`, which reads
exactly like "looked and found nothing" — the defect recorded at `_RunSidecar.close`'s `examined` counter,
where `acc` had a key and `write_acc` had no call. `write_ecg` feeds it, and a test asserts the
DENOMINATOR (`examined=12`) rather than only the finding.

**Three existing tests used `ecg` as their exemplar of "a stream with no sidecar" and are corrected, not
weakened** — each now DERIVES a sibling-less stream from the live tables and asserts that one exists, so
the next stream to gain a rule cannot silently turn a control into a no-op. A fourth asserted
`set(RUN_MIN_BY_STREAM.values()) == {T_STUCK}`, i.e. that every stream shares one threshold; its own
docstring asks for something else ("the FILE must carry the value that produced its rows"), so it now
checks that per stream, which is strictly stronger than one PPG file plus a set.

Sidecar filename `<base>_ECGRUNS.txt`, matching `_PPGRUNS.txt`; the header publishes `min_run=30`.
