<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Build Brief — Unify Clock Handling Across All Dex Apps

> **Goal for the AI coder:** make **OxyDex, HRVDex, PulseDex** handle dates/times the
> exact same way **GlucoDex** and **ECGDex** already do, so every app — and every
> module inside an app — agrees on a single source of truth for time and can sync
> records to the millisecond. **This is the only intended behavior change:** time
> parsing/representation becomes canonical. Computed *metrics* must not otherwise drift.
>
> **Why:** the five apps currently use four different time models. Cross-app overlay,
> sync, and "same night / same minute" alignment are impossible because some apps key
> on locale-parsed `Date` objects, one collapses time-only rows to the year 2000, and
> one falls back to *now()*. Unifying on **one canonical numeric clock** fixes all of it.
>
> **Canonical unit (read this first):** the canonical value is a **UTC-normalized
> "floating" wall-clock**, stored in milliseconds — i.e. the recording's *local* civil
> time, encoded as if those components were UTC (`Date.UTC(y, mo-1, d, h, mi, s)`), and
> always displayed back with the **`getUTC*`** getters. It is **not** a real UTC instant.
> See §1a for the rationale; this choice is deliberate and the coder should not "fix" it
> back to real-UTC epoch.

---

## 0. Current state — how each app handles time today

| App | Representation | Parser | Known problems |
|---|---|---|---|
| **GlucoDex** ✅ ref | numeric ms anchor `t0Ms` + `tMs[]` | one `parseTimestamp()` (ISO → `±HH:MM` offset → local fallbacks) | closest to target; see §1a note on display getters |
| **ECGDex** ✅ ref | **`t0Ms` anchor** + relative seconds (`fs`/sample index) | normalizes header start-time once | closest to target |
| **OxyDex** ❌ | **`Date` objects** per row (`row.t`) | `parseTime()` w/ multiple formats, but **time-only `HH:MM:SS` → Jan 1 2000** | loses the date; needs the `+86400000` midnight-wrap hack; no `t0Ms`; can't align to other apps |
| **HRVDex** ❌ | **`Date` objects** (`r._date`) | bare `new Date(r['Date']||r['Time'])` — **locale-dependent native parse** | `MM/DD` vs `DD/MM` ambiguity; no canonical anchor; NaN on some vendor strings |
| **PulseDex** ⚠️ | `tsEpoch[]` (ms) **+ string `firstTs`** | `Date.parse()` with a **`new Date()` (NOW) fallback** | inconsistent; NOW-fallback fabricates time when a stamp is missing |

**Shared root cause:** there is no single, shared, well-defined "parse a vendor timestamp
→ canonical numeric clock" function, and no agreed per-recording **anchor**. A secondary
trap (even in the reference apps): formatting a *real-UTC* value back with **local**
getters couples the displayed wall-clock to the *viewer's* timezone — §1a removes that.

---

## 1. The target convention

### 1a. One canonical representation: UTC-normalized "floating" wall-clock (ms)
Everywhere a time is stored or compared, store a **`Number` of milliseconds** that encodes
the recording's **local civil time as if it were UTC**:

```js
wallMs = Date.UTC(year, month-1, day, hour, min, sec, ms);   // canonical
```

Display always derives from it with the **UTC getters** (never `getHours()`):

```js
const d = new Date(wallMs);
d.getUTCHours(); d.getUTCMinutes(); d.getUTCFullYear(); …       // reads back exactly as recorded
```

**Why floating wall-clock, not real-UTC epoch (do not revert this):**
- These devices speak **local civil time with no zone** (O2Ring time-only, Welltory
  local). The wall clock *is* the ground truth; a real UTC instant is unknown/guessed.
- Storing real UTC and rendering with local getters makes the displayed time depend on
  the **viewer's** timezone — a New-York night reads 03:00 in London. Floating wall-clock
  + UTC getters is **viewer-timezone-independent**: a recording always reads back at the
  clock it was recorded at, anywhere.
- Two devices that record the **same wall-clock minute** produce the **same `wallMs`** by
  construction → "sync exactly" holds without anyone being in the same timezone. This is
  the property the project needs.

Never store a `Date` object or a formatted string as the source of truth.

- Per record: **`tMs`** = floating wall-clock ms (as above).
- Per recording/night/session: anchor **`t0Ms`** = `tMs` of the first valid sample.
- Relative position when needed: `relSec = (tMs - t0Ms) / 1000` (ECGDex style).
- **Optional true-offset** (only when the input actually carried one — a zoned ISO
  stamp): store **`offsetMin`** (minutes east of UTC) alongside. The real instant is then
  `utcMs = tMs - offsetMin*60000`. Use `utcMs` **only** for genuine cross-timezone
  simultaneity; default all sorting/aligning/display to `tMs`. When no offset is known,
  `offsetMin = null` and you simply never compute `utcMs` — graceful degradation, no guess.

### 1b. One shared parser (the SAME code in every app, duplicated locally)
Add a single function — **`parseTimestamp(raw, opts)` → `{ tMs, offsetMin }` or `null`**
— and use it for **every** timestamp in that app. `tMs` is always floating wall-clock ms
(§1a). Resolution order:

1. **Already numeric?** If `raw` is a number (or all-digits string) in a plausible epoch
   range, treat as a real instant (ms, or ×1000 if clearly seconds): convert to floating
   wall-clock for the **local** zone at parse time — `tMs = inst − tzOffset(inst)`,
   `offsetMin = −tzOffset/60000` — so it lines up with the no-zone exports. (Numeric
   epochs are rare in these files; this keeps them consistent rather than special.)
2. **ISO-8601 with explicit zone** (`…Z` or `…±HH:MM`): the zone is authoritative.
   Compute the real instant, capture `offsetMin` from the stamp, then **re-express as the
   recording's local wall clock**: `tMs = Date.UTC(localComponents…)` using that offset.
   Result: a Polar ISO stamp and an O2Ring local stamp for the same moment in the same
   place produce the same `tMs`.
3. **ISO-8601 / `YYYY-MM-DD[ T]HH:MM:SS` with NO zone:** take the components verbatim →
   `tMs = Date.UTC(y, mo-1, d, h, mi, s)`, `offsetMin = null`.
4. **Explicit known vendor formats** (regex, never locale `new Date(str)`) → same
   `Date.UTC(components)`, `offsetMin = null`:
   - `HH:MM:SS DD/MM/YYYY` and `HH:MM:SS MM/DD/YYYY` (O2Ring)
   - `DD/MM/YYYY HH:MM[:SS]` and `MM/DD/YYYY HH:MM[:SS]` (Welltory etc.)
   - `YYYY/MM/DD HH:MM:SS`
   - Disambiguate `DD/MM` vs `MM/DD` with the rule in §1c.
5. **Time-only `HH:MM[:SS]`** (OxyDex's problem case): **do not** invent Jan 1 2000.
   Combine with the recording's **`dateAnchorMs`** from `opts` (§1d) →
   `Date.UTC(anchorY, anchorMo, anchorD, h, mi, s)`, then roll the **date** forward one
   day each time the clock wraps past midnight (monotonic). `offsetMin = null`.
6. **Fallback:** return `null`. **Never** fall back to `new Date()` / now() — a missing
   stamp must be visible (null), not silently fabricated (PulseDex's bug).

`opts = { dateAnchorMs, preferDMY }`. Keep the helper **duplicated locally inside each
module that needs it** (mirror how ECGDex duplicates `mean/std/…`) — do **not** add a
shared util module in this pass.

> Implementation note: a tiny `tzOffset(instantMs)` helper = `new Date(instantMs).getTimezoneOffset()*60000`
> is all step 1–2 need. Everything else is pure `Date.UTC` + regex — no `Date.parse` on
> vendor strings anywhere.

### 1c. DMY vs MDY disambiguation (one deterministic rule)
- If any row has day-component > 12 → the file is unambiguous; lock that order for the
  whole file.
- Else honor an explicit `preferDMY` (default **true**, since O2Ring/Welltory exports in
  this project are DMY). Lock the chosen order for the entire file once decided — never
  switch order mid-file.

### 1d. Per-recording anchor `t0Ms` + `dateAnchorMs`
- `dateAnchorMs`: the calendar date the recording **starts**, as a floating wall-clock ms
  at 00:00 (`Date.UTC(y, mo-1, d)`). Sources, in priority: (1) a full date present in the
  data; (2) a 14-digit `YYYYMMDDHHMMSS` run embedded in the **filename** (OxyDex already
  does this for `.bin` — reuse it); (3) the file's `lastModified` (as floating wall-clock,
  via the §1b step-1 conversion); (4) `null` → show "date unknown", do **not** fabricate.
- `t0Ms` = `tMs` of the first valid sample. Store on the night/session object, plus
  `offsetMin` if known.

### 1e. Display helpers (derive with UTC getters, never store)
Add tiny formatters used by all render modules so wall-clock output is identical **and
viewer-timezone-independent**. They MUST use the `getUTC*` family (because `tMs` is
floating wall-clock per §1a):
- `fmtClock(ms)` → `HH:MM` (24h, zero-padded) from `new Date(ms).getUTCHours()/getUTCMinutes()`.
- `fmtDate(ms)` → `YYYY-MM-DD` from `getUTCFullYear()/getUTCMonth()/getUTCDate()`.
- `fmtDateTime(ms)` → `YYYY-MM-DD HH:MM`.
Using `getUTC*` guarantees a recording reads back at the exact clock it was recorded at,
on any machine in any timezone. (If GlucoDex/ECGDex currently use local getters on a
real-UTC value, switch them to this floating-ms + `getUTC*` pairing too, so all five
agree — verify their displayed times are unchanged for same-zone data.)

---

## 2. Per-app changes

### 2a. OxyDex — biggest win
- In `oxydex-dsp.js`, replace `parseTime()` internals with `parseTimestamp()` returning
  **floating wall-clock ms** (§1a). Carry `dateAnchorMs` from the CSV's first full date,
  else the filename's 14-digit run (the `.bin` path already computes this — factor it so
  CSV uses it too).
- Store `row.tMs` (ms) instead of `row.t` (Date). Compute `night.t0Ms` once.
- **Delete the Jan-1-2000 fallback and the `+86400000` midnight-wrap hack** — the
  monotonic time-only roll-forward in §1b.5 handles overnight recordings correctly.
- Duration becomes `lastTMs - t0Ms` (no special-casing).
- Any `getHours()`-based "is this an overnight sample" logic now reads from
  `new Date(tMs).getUTCHours()` consistently.
- The `.bin` decoder currently emits an ISO string with **local** components; that string
  flows through `parseTimestamp` step 3 → `Date.UTC(components)`, so `.bin` and CSV land on
  identical `tMs`. Keep it that way (verification §3.2).

### 2b. HRVDex — remove locale-dependent native parse
- In `hrvdex-dsp.js`, replace `new Date(r['Date']||r['Time'])` with
  `parseTimestamp(r['Date'] + ' ' + r['Time'], {preferDMY:true}).tMs` → store `r._tMs`.
- Sort rows by `_tMs`. Keep `_date` only if other code reads it — set it as
  `new Date(r._tMs)` **and read it back with `getUTC*`** for compatibility, but make
  `_tMs` the source of truth.

### 2c. PulseDex — kill the now() fallback
- In `pulsedex-dsp.js`, route the "Phone timestamp;RR" and Welltory paths through
  `parseTimestamp()` → `tsMs[]` (floating wall-clock ms) + optional `offsetMin` (Polar RR
  stamps are zoned ISO — capture it). Replace string `firstTs` with `t0Ms` (Number).
- **Remove the `new Date()` fallback**: if a row has no parseable stamp, leave `tMs =
  null` and exclude it from time-based series (RR magnitude metrics still compute).

### 2d. GlucoDex / ECGDex — align to the floating model
They are already numeric-ms + single-parser, so the structure stays. The only change:
make their `parseTimestamp` produce **floating wall-clock ms** and their formatters use
**`getUTC*`** (§1a/§1e), so all five apps share one clock. Snapshot their rendered times
on a same-timezone file before/after and confirm **no visible change** for that case.

---

## 3. Verification (non-negotiable, after each app)

1. **Same-file round-trip:** load a real file (project `uploads/` has O2Ring CSV + the
   native `.bin`, Welltory CSV, Polar RR). Confirm the first/last sample wall-clock
   shown matches the raw file's first/last timestamp **exactly**.
2. **Bin == CSV alignment (OxyDex):** the `.bin` and its sibling CSV for the same night
   must produce **identical `t0Ms` and per-sample `tMs`** (they already match on values;
   now they must match on time too).
3. **Viewer-timezone independence (the key new test):** render a file's first/last clock,
   then re-run with the environment's timezone changed (e.g. emulate via `TZ` or by
   temporarily overriding `getTimezoneOffset`). The displayed wall-clock must be
   **identical** in both — proving display reads `tMs` with `getUTC*`, not viewer-local.
4. **Overnight crossing:** a recording that starts 22:00 and ends 06:00 must show ~8 h
   duration and a continuous, monotonic time axis — no 24 h jump, no negative deltas.
5. **Zoned == local for the same moment:** a Polar ISO stamp `…+02:00` and an O2Ring
   local stamp for the same wall instant in that zone must resolve to the **same `tMs`**.
6. **DMY/MDY:** a file with `13/05` (unambiguous DMY) and one with `05/13` must both
   resolve to **May 13**.
7. **No fabricated time:** a stamp-less PulseDex row yields `null`, never today's date.
8. **Metric parity:** aside from corrected/newly-valid timestamps, all numeric metrics
   on a clean file match the pre-change output (snapshot before, diff after).
9. **Re-bundle** each `Foo.src.html` → `Foo.html` and confirm the standalone matches.

### Done criteria
- All five apps represent time as **UTC-normalized floating wall-clock ms** with a shared
  `parseTimestamp()` + `t0Ms` anchor, and display via `getUTC*` formatters.
- OxyDex's Jan-2000 fallback and midnight hack are gone; overnight recordings are correct.
- HRVDex no longer uses locale `new Date(str)`; PulseDex no longer falls back to now().
- Displayed wall-clock is **identical regardless of the viewer's timezone**.
- Two apps loading the *same* recording agree on `t0Ms`/`tMs` to the millisecond.
- Standalones rebuilt under their unified names (`OxyDex.html`, `HRVDex.html`,
  `PulseDex.html`).

---

## 4. Suggested order
1. **HRVDex** — smallest time surface (one `new Date` site); proves `parseTimestamp()`.
2. **PulseDex** — remove now() fallback; wire `tsMs[]`/`t0Ms`.
3. **OxyDex** — biggest; retire the Jan-2000 fallback + midnight hack last, once the
   shared parser is proven.
