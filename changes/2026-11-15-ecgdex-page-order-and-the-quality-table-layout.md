---
bump: patch
type: changed
brief: SIGNAL-QUALITY-TABLE-2026-11-14-BRIEF.md
---

Reorder the ECGDex page into reading order and repair what the signal-quality table and the three
clock-drift panels present.

The page order now runs: read the recording, read what it measured, read how well the node measured it,
read what it published. Signal Quality and the three device cross-checks move below the result
sections, and one badged line under Key Metrics carries mean SQI, beat coverage and the analyzable
share with a link down to the section that shows the work. Seven result cards sat loose in the page
with no heading over them; two headings now cover them, each shown only when one of its cards is.

Six defects of presentation go with it.

- A count printed with two decimals. The epoch population read `161.00` and the rail census
  `94.00`, because the cell formatter had one precision ladder for every quantity. Counts now print
  as integers, and the row declares that it is a count.
- The axis-rate row and the night-drift row print one number. `ecgdex-dsp.js` sets the axis cell to
  `hostAxis.ppm` and builds the night figure as `night.ppm = hostAxis.ppm`, so the two rows differ
  only in what they attribute the rate to. Two rates under two labels read as two measurements, and
  their agreement then reads as corroboration. The table states the identity. It states it only for
  the channels where the two numbers are in fact equal on the recording in hand.
- The Allan panel drew a log x against a linear y. The noise class under it is the slope of the
  log-log curve. Both axes are logarithmic now. A reader can hold the printed class against the line.
  A term whose σ is not positive has no logarithm, so the panel drops it, counts the drops, and puts
  the count in the caption.
- The noise class travelled with no fit behind it. The caption now carries the slope, its standard
  error and the τ count, and it says the class is unsupported when `clock.js` reports the slope
  within 1.96 SE of a category boundary.
- A chart card grew to the height of its neighbour. The HRV row is a two-column grid, and the
  grid default stretches the shorter card. The Poincare plot is square, and it draws about 319 px.
  The tachogram draws about 105 px from its own aspect ratio. So about 250 px of empty bordered
  surface sat under the tachogram. Each card now ends where its content ends, and the tachogram
  takes the width that the square plot does not need, because its x axis is the whole recording.
- No y tick carried a unit. `lineChart` takes a `yfmt`, and the three drift panels pass ms, ppm and
  ppm. Each x axis states what it measures in its own caption.

Three defects of substance go with it.

- The motion column said the wrong thing about itself. Six of its ten cells read `no motion channel
  on this recording`, but this node derives every one of those facts from the ECG beat series, so
  each cell stays absent when a motion file does arrive. The `acc` branch of those same cells proves
  it line by line. The reason invited the reader to bring a file that cannot supply the number.
  Each of the six now states its own structural reason, and only the two cells a motion file does
  feed keep the file-dependent one. The channel publishes `scopeNote` and `inputNote`, which the
  table draws once at the head of the column.
- A cell says nothing the column head already said. The head carries the two channel notes and the
  majority reason, and each of those bodies is struck from every cell below it. The motion column
  printed `inputNote` in full twice, at the head and inside the coverage cell.
- A rate travelled with no anchor count and no span. Clock Contract section 7 forbids both. The
  table printed `-6.67` under `ppm of the device rate against the host axis` with nothing beside it.
  The cell now publishes `spanMs`, which sits on `hostAxis` already, and the table draws the anchor
  count, the span and, where the producer measured one, the uncertainty of the rate at that span.
  The same line serves the night-drift cell, which carried all three in its own data.

The before-and-after pair inside a cell now carries `data-ba` and `data-abs`, so a test reads the
structure. The legs that counted the old prose run read those attributes instead.

ECGDex `manifestHash` 4b955d29e061 → 1933e8482c96. `computeHash` moves too,
99d1e4c25dac → 0d0314408ff2, because the diff edits `ecgdex-dsp.js`. The four goldens moved their
embedded code hashes and their `outputHash`: the export carries the new reasons, the two channel
notes and the `spanMs` field. No measured number moved.
