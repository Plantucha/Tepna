# CSV Export Audit — Tepna / Dex Suite

**Date:** 2026-06-21 · **Scope:** every `*-app.js` CSV exporter across the 7 nodes.
**Focus (per request):** correct **null vs 0** handling, plus the formatting hygiene that
makes a CSV look engineered rather than scraped.

> The unifying rule we adopt, consistent with the Clock Contract's *"null = not computed,
> never fabricated"*: a CSV field has **three** distinct states and must keep them distinct —
>
> | state | meaning | correct cell |
> |---|---|---|
> | **missing** | `null` / `undefined` / `NaN` / `±Inf` — not computed at this length/quality | **empty** `` |
> | **zero** | a real measured `0` | `0` |
> | **value** | a number/string | the value |
>
> Writing `0` for missing **fabricates data**. Writing `"null"` / `"NaN"` / `"—"` for missing
> dumps UI text into a data column. Both are wrong; they are the bulk of what looks "weak".

---

## 1. Inventory & verdict (null/0 lens first)

| Node · function | missing → | NaN/±Inf → | real 0 → | other defects |
|---|---|---|---|---|
| **OxyDex** `exportCSV` (report) | leaks literal `null`/`undefined`; many fields emit `—` | leaks `NaN` | `0` ✓ | em-dash in data cells; LF; no BOM |
| **HRVDex** `exportCSV` | `''` ✓ | `''` ✓ | `0.0000` ✓ | **naive quoting** `'"'+v+'"'` (breaks on embedded `"`); LF; no BOM |
| **ECGDex** `exportWelltoryCSV` | `''` ✓ | `''` ✓ | `0` ✓ | LF; no BOM |
| **ECGDex** `exportCSV` (`_tblCSV`) | DOM `—` → literal `—` | — | `0` | **scrapes rendered table**; quotes *every* cell incl. numbers; trend glyphs; LF; no BOM |
| **GlucoDex** `exportCleanCSV` | **`Math.round(null) → 0`** (coerces missing → 0) | `NaN` | `0` | ⚠️ worst-class null/0 bug; LF; no BOM |
| **GlucoDex** `exportSummaryCSV` | DOM `—` → literal | — | `0` | scrape; quotes every cell; LF; no BOM |
| **PulseDex** `exportCSV` (Welltory append) | `''` ✓ | — | `0` | LF; no BOM (escaping OK via `csvCell`) |
| **PulseDex** `exportSummaryCSV` | DOM `—` → literal | — | `0` | scrape; quotes every cell; LF; no BOM |
| **PpgDex** `exportCSV` (epochs) | `''` ✓ | leaks `NaN` | `0` ✓ | LF; no BOM |
| **CPAPDex** | — | — | — | **no CSV export at all** (button present, unwired) |

## 2. Cross-cutting findings

1. **null/0 conflation (primary).** Three different wrong behaviours coexist:
   - **fabricates 0** — GlucoDex clean-series `Math.round(s.gV[i])` turns an absent reading into a real-looking `0 mg/dL`. The most dangerous: it is indistinguishable from a true hypo.
   - **leaks UI tokens** — OxyDex bare concatenation prints `null` / `undefined` / `NaN`; PpgDex prints `NaN`.
   - **em-dash placeholder** — OxyDex `—` and all three DOM-scrape exporters carry the render-time `—` "no data" glyph into data cells.
   No node-independent convention exists; each re-invents it (or doesn't).

2. **No UTF-8 BOM.** Headers are full of `µ ² ° · ₂` (`SBII (%²·min/hr)`, `cmH₂O`, `meanRR_ms`…). Without a BOM, Excel mis-decodes them. Every exporter omits it.

3. **LF, not CRLF.** RFC 4180 specifies `\r\n`. All nodes join on `\n`.

4. **Inconsistent escaping.** Only OxyDex (`csvSafe`) guards against Excel **formula injection** (a cell starting `= + - @` runs as a formula). HRVDex's quoting is naive and corrupts on an embedded `"`. The scrapes quote *every* cell, so plain numbers arrive as `"42"` (text, not numeric in Excel).

5. **DOM-table-scrape summary CSVs** (ECGDex, GlucoDex, PulseDex). They serialize `#tblWrap table` `textContent` — i.e. a *picture of the rendered table*: trend arrows, fused units, `—` placeholders, every cell quoted. This is the single biggest "looks weak" smell.

6. **Filename-stamp drift.** `_exportTs()` is duplicated as `_hrvTs()` (byte-identical) in HRVDex — harmless but a smell.

## 3. The fix — one mirrored convention (no shared util; mirror like `parseTimestamp`)

Each node gets the same small toolkit (mirrored, not extracted — same policy as the Clock Contract):

```js
// missing(null/undefined/NaN/±Inf)→blank · real 0 preserved · RFC-4180 + Excel-formula-safe
function csvCell(v){
  if(v==null) return '';
  if(typeof v==='number') return Number.isFinite(v) ? String(v) : '';   // NaN/±Inf → blank; 0 → "0"
  v=String(v);
  if(v && '=+-@\t\r'.indexOf(v[0])!==-1) v='\t'+v;                      // formula-injection guard
  return /[",\r\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;          // quote only when needed
}
function csvDoc(rows){ return '\uFEFF' + rows.map(r=>r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }  // BOM + CRLF
// for the scrape exporters: strip trend glyphs + map UI placeholders → blank, then csvCell
function csvClean(t){ const s=String(t??'').replace(/[↑↓→↗↘⬆⬇]/g,'').replace(/\s+/g,' ').trim();
  return (s===''||s==='—'||s==='–'||/^n\/?a$/i.test(s)) ? '' : s; }
```

**Per node:**
- **OxyDex** — `—` placeholders → blank; BOM+CRLF; a final pass blanks any stray `null`/`undefined`/`NaN` token. (Report layout unchanged.)
- **HRVDex** — route through `csvDoc`; keep the 4-dp number formatting; drop naive quoting. null≠0 preserved.
- **ECGDex** — `_tblCSV` → `csvClean`+`csvDoc` (no over-quoting, no glyphs); Welltory CSV → `csvDoc`.
- **GlucoDex** — **fix the `Math.round(null)→0`** (guard finite); clean-series + summary → `csvDoc`/`tableToCsv`.
- **PulseDex** — upgrade in-place `csvCell` (add number/NaN + formula guard); Welltory append + summary via `csvDoc`/`tableToCsv`.
- **PpgDex** — epochs via `csvDoc` (kills the `NaN` leak; 0 preserved).
- **CPAPDex** — **new** per-night summary `exportCSV` (one row/night, longitudinal), wired to `btnCSV`, dates via `CpapDsp.fmtDate` (Clock Contract), all cells via `csvCell`.

## 4. Gates
CSV exporters are **not** covered by `tests/dex-tests.js`, so behaviour assertions are unaffected.
All edits are `*-app.js`-only → **`buildHash` does not move** → provenance fixtures stay reproducible
(no regeneration). Still run both gates after re-bundling: `Dex-Test-Suite.html` (green) and
`verify-provenance.html` (no red verdicts).
