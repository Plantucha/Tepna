# Tepna ↔ WFDB / PhysioNet — a concept mapping, and where the concepts do not meet

**Status:** REFERENCE (living — last-verified 2026-09-22) · executes `MEASUREMENT-PROVENANCE-ROADMAP-2026-08-26-BRIEF.md` §11.

§11's deliverable is **this document**, and it says so: *"Implement an export adapter only if it is
provably low-risk and somebody needs it; otherwise the doc is the deliverable. Tepna is not redesigned
around WFDB."* **No adapter is written here**, and that is a decision rather than an omission: the two
conditions are conjunctive and neither holds today — nothing in the tree needs a WFDB export, and the
non-correspondences below are exactly what make "provably low-risk" unavailable until someone answers
them for a specific use.

**What this is for.** Somebody will eventually want to read a PhysioNet record into Tepna, or hand a
Tepna recording to a tool that speaks WFDB. This page exists so that person starts from the places the
two vocabularies **disagree**, rather than from a table of look-alike field names. A table implying
equivalences the Clock Contract forbids would be worse than no page at all.

---

## 1 · What does correspond, with caveats worth reading

| WFDB | Tepna | note |
|---|---|---|
| record (`.hea` + `.dat` + annotations) | one recording / night (`recording` in a node export) | a WFDB record is a fixed set of signals over one span; a Tepna night may be a UNION of capture fragments (link drops open a new file), so one night is often several files |
| signal (a column in `.dat`) | a stream (`_ECG.txt`, `_PPG.txt`, a channel within it) | |
| `nsig` / per-signal descriptors | per-stream parse in each node's `*-dsp.js` | |
| annotation (`.atr`) | `ganglior_events[]` | **not** an equivalence — see §3 |
| `fs` (samples per second) | `rec.fs` | **not** an equivalence — see §2 |
| base time / base date | `recording.startEpochMs` (`t0Ms`) | **not** an equivalence — see §2 |
| gain, baseline (`zero`) | (no stored analogue — Tepna stores physical values) | see §4 |
| signal name (free text) | `sourceChannel` (`H10:ecg`) | see §5 |

---

## 2 · TIME AND RATE: two places where "maps to" would be false

**Start time.** WFDB's base time/date is a **wall-clock instant**. Tepna's `t0Ms` is deliberately
**floating civil time** — the recording's local civil time encoded as if it were UTC (Clock Contract
§1), *not* a real instant, because these devices speak local time with no zone and storing a real
instant makes displayed time depend on the viewer's timezone. An adapter therefore cannot simply copy
one into the other:

- **Tepna → WFDB** needs a zone to turn floating time into an instant. Where `offsetMin` is non-null
  the conversion is defined (`utcMs = tMs − offsetMin×60000`); where it is null — the common case,
  because most vendor stamps carry no zone — **there is no honest conversion**, and an adapter must
  either refuse or record the assumption it made. Writing local time into a field that means UTC is a
  silent one-timezone error in every downstream tool.
- **WFDB → Tepna** must convert the instant to floating time for the recording's own zone, or every
  Tepna view of it will be shifted for any reader in a different one.

**Sampling rate.** WFDB `fs` is a **nominal constant** per signal, a property of the header. In Tepna
`fs` is a **measured quantity that gets corrected**: Clock Contract §7 exists because a device crystal
is wrong by ppm and the capture host's clock disciplines it (`DexClock.hostAxis`), and a node may
publish a corrected `fs` with the evidence beside it. So the mapping is asymmetric:

- **Tepna → WFDB** must choose *which* rate to write, and the choice is lossy in a way the header
  cannot express: a corrected `fs`, an uncorrected one, or the nominal. Whichever is chosen, the fact
  that a correction existed — and its provenance — does not survive into the header.
- **WFDB → Tepna** gets a nominal rate with no second clock, so `hostAxis` correctly **refuses**
  (`independent:false` / fewer than 3 anchors) and the recording is honestly marked as having no
  independent timing. That is the right outcome and an adapter must not fabricate anchors to avoid it.

---

## 3 · ANNOTATIONS vs EVENTS: an index against a wall clock

A WFDB annotation is **a sample index plus a code** — its time is `sample / fs`, i.e. it is defined
*relative to the signal it annotates* and inherits that signal's rate.

A `ganglior_event` is **a wall-clock string** (`"HH:MM:SS"`, no date) plus an optional absolute
floating `tMs`, and it is defined against the recording's clock rather than a sample grid (Clock
Contract §6).

The consequences for an adapter are concrete: converting an annotation to an event requires the same
`fs` decision as §2 (and inherits its error); converting an event to an annotation requires a sample
index, which **does not exist** if the event came from a stream with a different rate, a gap, or a
clock seam. Tepna refuses a metric across a seam (`clock-seam`) rather than interpolating one — an
adapter that computes `round(tMs × fs)` across a seam manufactures an index into a grid that does not
run there.

---

## 4 · STORED UNITS: raw ADC with gain/baseline, against physical values

WFDB `.dat` stores **raw ADC counts**, with `gain` (ADU per physical unit) and `baseline`/`zero` in the
header; the physical value is `(raw − zero) / gain`. Tepna stores and computes in **physical units**
(CLAUDE.md §📏: metric, stored and computed in the canonical unit, converted only at the display
boundary).

This is a real adapter decision and not a naming difference. **Tepna → WFDB** must invent a gain and a
baseline, and the choice determines the quantisation the file appears to have had — a fabricated
provenance claim about the instrument. **WFDB → Tepna** applies the header's gain, which is
well-defined, but see §6: the same arithmetic is where an invalid sample becomes a plausible number.

---

## 5 · SIGNAL IDENTITY: free text against structured identity

A WFDB signal name is **free text** (`"MLII"`, `"V5"`). Tepna's `sourceChannel` is **structured** and
validated — `device:channel`, e.g. `H10:ecg` — and the fleet has a standing ruling that **BLE device
identity is by ADDRESS only, never by local name**, because a local name is advertised, mutable and
duplicated across devices.

So **WFDB → Tepna** cannot derive a device identity from a signal name: it may fill the channel half
and must not invent the device half from free text. **Tepna → WFDB** flattens structure into a string
and loses the distinction; an adapter should not encode an address into a signal name and call it
identity, because on the way back it is text again.

---

## 6 · ⚠️ ABSENCE: the two projects made OPPOSITE decisions, and this is the one that bites

**WFDB represents an invalid or missing sample with an IN-BAND sentinel.** From `wfdb.h`
(wfdblib 10.7.0):

> ```c
> /* getvec and getframe return a sample with a value of WFDB_INVALID_SAMPLE
>    when the amplitude of a signal is undefined (e.g., the input is clipped or
>    the signal is not available) and padding is disabled (see WFDB_GVPAD, below).
>    WFDB_INVALID_SAMPLE is the minimum value for a 16-bit WFDB_Sample.  In
>    a format 24 or 32 signal, this value will be near mid-range, but it should
>    occur only rarely in such cases;  if this is a concern, WFDB_INVALID_SAMPLE
>    can be redefined and the WFDB library can be recompiled. */
> #define WFDB_INVALID_SAMPLE (-32768)
> ```

Tepna's §∅ rule is the opposite and is non-negotiable: **a value that was not measured is `null`,
never a sentinel inside the value's own range**, at every layer. The reason is stated in the rule and
the standard's own comment concedes it — *"in a format 24 or 32 signal, this value will be near
mid-range"* — because **a consumer cannot null what it cannot distinguish**.

**⚠️ AND THE SENTINEL IS NOT IN THE FILE-FORMAT SPEC.** `SIGNAL(5)` describes every storage format
and does **not** mention it; it is a **library-level constant**, defined in `wfdb.h` and returned by
`getvec`/`getframe`, documented behaviourally in the Programmer's Guide §2.2 "Special I/O Modes". An
adapter author who reads only the format specification — the obvious thing to read — **never meets
it**. That is why this section exists rather than a line in the table.

**Both directions need a decision, and neither has a free one:**

- **WFDB → Tepna:** the sentinel MUST be recognised at the parse boundary and converted to `null`,
  with the count of dropped samples recorded. Otherwise it enters the DSP as a plausible extreme value
  — at a typical ECG gain of 200 ADU/mV, `−32768` becomes **−163.84 mV** of "signal". This is the
  O2Ring in-band-zeros failure with a different constant.
- **Tepna → WFDB:** a `null` has **no honest encoding**. An exporter must either refuse, or emit the
  sentinel *and record that it did so* — and it must then not be surprised when a reader that does not
  know the constant reads back a number.

**A specific trap for whoever fixes the read half.** `tools/ecg-physionet-differential.mjs` clamps
scaled values with `Math.max(-32768, …)` (line 416) when building the buffer it hands to `ECGDSP`, so
**within that one file the same constant is manufactured on one path and means "undefined" on the
other**. Nulling `−32768` at the parse boundary without touching the clamp would null values the
clamp produces on purpose. See residue `2026-09-22-wfdb-invalid-sample-not-recognised`.

**Format 212 is an open question, not a claim.** Whether WFDB maps the lowest expressible value of a
sub-16-bit format (−2048 for 212) to `WFDB_INVALID_SAMPLE` is **not established here**. The library
NEWS mentions such a mapping being repaired for formats 80 and 160, which makes it plausible and
unverified — and an unverified equivalence is exactly what this page refuses to write down.

---

## 7 · If somebody does build an adapter

The questions above are its specification. Each one must be **answered explicitly and recorded in the
export**, not decided silently:

1. Which `fs` was written, and did a correction exist? (§2)
2. What zone turned floating time into an instant, or was it refused? (§2)
3. How were events without a sample index handled — refused, or computed across what? (§3)
4. What gain and baseline were invented, and on what basis? (§4)
5. What went into the signal name, and what identity was lost? (§5)
6. How was `null` encoded, and is the fact that it was encoded recoverable? (§6)

**Sources.** `wfdb.h`, wfdblib 10.7.0 (PhysioNet, `physionet.org/physiotools/wfdb/lib/wfdb.h`) ·
WFDB Programmer's Guide §2.2 "Special I/O Modes" · `SIGNAL(5)` and `HEADER(5)` of the WFDB
Applications Guide. Tepna side: CLAUDE.md §🔒 (Clock Contract §§1,6,7), §∅, §📏.
