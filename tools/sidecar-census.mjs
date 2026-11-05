#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// WHO WRITES EACH CAPTURE-HOST SIDECAR, WHO READS IT, AND WHAT EACH READER DOES WHEN IT IS ABSENT.
//
// The capture host writes a set of sidecars beside its streams: validity runs, seams, link and clock
// logs, ring frame and clock logs, arrival logs and a few fixed-name journals. A sidecar is worth its
// bytes only when something reads it, and a reader is safe only when its no-sidecar path is proven.
// Row `2026-11-02-no-node-reads-a-seam-sidecar-or-the-radio-clock` found two sidecars no node read,
// by hand. This tool makes that census a gate.
//
// THE REGISTRY BELOW IS THE CENSUS. Each sidecar names its writer (file + anchor) and every reader
// (file + anchor + kind + what it does when the sidecar is absent or unreadable). Each node or box
// reader cites either a committed test of its no-sidecar path or a residue key. A sidecar with no
// reader cites a residue key. The tool checks every claim mechanically:
//
//   1. DISCOVERY. Every sidecar-shaped name the non-test capture-host code spells (an upper-case
//      `NAME.csv`/`NAME.txt` literal, a `capture_filename(…, "<stream>", …)` stream word, the
//      `RUNS.{ext}` form and `BOX_WIDE_SIDECAR_TAGS`) is in the registry, or declared a signal
//      stream, a derived output or a human note. A new sidecar with no registry entry FAILS.
//   2. Every writer and reader anchor still stands in its file.
//   3. Every cited test exists: `def <name>(` in a pytest file, or the literal label in a JS test file.
//   4. Every cited residue key is a row of `briefs/RESIDUE.md`.
//   5. A node or box reader with neither a test nor a residue key FAILS. A TOOL reader with no test is
//      counted and ranked, not failed (pre-stated: tools are analysis, nodes and the box are product).
//
// THE RANKING. Every residue key the registry cites is listed with its ledger state, open rows first,
// ordered by class: a sidecar no code reads, then a node reader whose absent path is unproven, then a
// box reader, then a tool reader.
//
// Limits, stated: discovery reads the box's top-level `capture-host/*.py` only, and an anchor is a
// literal substring, so a renamed function fails until the registry follows it. That is the point.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { parseRows } from './residue-ids.mjs';
import { makeVerdict, printVerdict } from './verdict-emit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = 'tools/sidecar-census.mjs';
const GATE = 'sidecar-census';

const ROW_ACC = '2026-11-04-two-acc-parsers-read-an-absent-run-sidecar-as-a-clean-one';
const ROW_SEAMNODE = '2026-11-02-no-node-reads-a-seam-sidecar-or-the-radio-clock';

/* Names the box spells that are NOT sidecars: the signal streams themselves, outputs derived from a
   night, and the human key to the sidecars. Each is declared, so a new name still has to be placed. */
export const NOT_SIDECARS = {
  stream: ['ACC', 'ACCRAW', 'ECG', 'EEG', 'HR', 'PLETHA', 'PPG', 'PPG2W', 'PPI', 'SPO2'],
  derived: ['NIGHT-REPORT'],
  note: ['README-SIDECARS']
};

/** @typedef {{kind:'node'|'box'|'tool', file:string, anchor:string, onAbsent:string, test?:string|null, residue?:string|null}} Reader */
/** @typedef {{tag:string, names?:string[], writer:{file:string, anchor:string}, readers:Reader[], residue?:string|null, note?:string}} Sidecar */

/** @type {Sidecar[]} */
export const REGISTRY = [
  {
    tag: 'RUNS',
    names: ['PPGRUNS', 'PPG2WRUNS', 'ECGRUNS', 'ACCRUNS', 'ACCRAWRUNS'],
    writer: { file: 'capture-host/writers.py', anchor: 'class _RunSidecar' },
    readers: [
      {
        kind: 'node',
        file: 'ppgdex-dsp.js',
        anchor: 'function parsePinnedRuns(',
        onAbsent: 'null; parsePPG leaves pinnedCrossCheck null',
        test: 'tests/dex-tests.js::parsePPG · no sidecar → pinnedCrossCheck is null'
      },
      {
        kind: 'node',
        file: 'oxydex-dsp.js',
        anchor: 'function _parsePinnedRuns(',
        onAbsent: 'null, never an empty observation',
        test: 'tests/dex-tests.js::no sidecar → null, never an empty observation'
      },
      {
        kind: 'node',
        file: 'ecgdex-dsp.js',
        anchor: 'function parseEcgRuns(',
        onAbsent: 'null; parseECG adds neither runsSidecar nor blankingSpans',
        test: 'tests/dex-tests.js::parseECG · ONE argument is byte-identical — no sidecar fields appear'
      },
      {
        kind: 'node',
        file: 'motiondex-dsp.js',
        anchor: 'function parseAccRuns(',
        onAbsent: 'null; no _runsSidecar and no blankedEpochs',
        test: 'tests/dex-tests.js::no sidecar ⇒ no new keys at all (byte-identical shape)'
      },
      {
        kind: 'node',
        file: 'ecgdex-dsp.js',
        anchor: 'function parseAccRunsTimed(',
        onAbsent: 'null; parseDeviceACC sets no _blankSpans, the same shape a sidecar with no run gives',
        residue: ROW_ACC
      },
      {
        kind: 'node',
        file: 'ppgdex-dsp.js',
        anchor: 'function parseAccRunsTimed(',
        onAbsent: 'null; parseSensorXYZ sets no _blankSpans, the same shape a sidecar with no run gives',
        residue: ROW_ACC
      },
      {
        kind: 'box',
        file: 'capture-host/solid_night_inputs.py',
        anchor: 'def validity(',
        onAbsent: 'an absent waveform sidecar leaves validity undecided',
        test: 'capture-host/tests/test_solid_night_inputs.py::test_validity_needs_every_waveforms_sidecar_and_its_own_min_run'
      },
      { kind: 'tool', file: 'tools/trio-fold-validity.mjs', anchor: 'runsSidecarPath', onAbsent: 'no path gives null', test: 'tests/trio-fold-validity-tests.mjs::no path → null' },
      { kind: 'tool', file: 'tools/consensus-refpick-dissent.mjs', anchor: 'function readRunsFor(', onAbsent: "state 'absent' or 'unreadable', runsText null", test: null }
    ]
  },
  {
    tag: 'SEAMS',
    names: ['PPGSEAMS', 'PPISEAMS', 'ECGSEAMS', 'HRSEAMS'],
    writer: { file: 'capture-host/writers.py', anchor: 'class _SeamSidecar' },
    note: 'no node reads it; node consumption waits on the owner at SEAM-SIDECAR-CONSUMPTION §4.4',
    residue: ROW_SEAMNODE,
    readers: [
      {
        kind: 'box',
        file: 'capture-host/solid_night_inputs.py',
        anchor: 'def recorded_seams(',
        onAbsent: 'an absent sidecar is a named absence, not zero seams',
        test: 'capture-host/tests/test_solid_night_inputs.py::test_a_MEASURED_seam_carries_NO_REASON_and_the_absent_one_carries_ITS_OWN'
      },
      {
        kind: 'box',
        file: 'capture-host/solid_night_inputs.py',
        anchor: 'def seam_rate(',
        onAbsent: 'OSError gives None, never the zero §A5 would read as a negotiation',
        test: 'capture-host/tests/test_solid_night_inputs.py::test_an_ABSENT_seam_sidecar_reads_as_NO_RATE_and_never_as_zero'
      },
      {
        kind: 'tool',
        file: 'tools/seam-sidecar-yield.mjs',
        anchor: 'function readSidecar(',
        onAbsent: 'an unreadable file gives null and is excluded by name',
        test: 'tools/seam-sidecar-yield.mjs::an unplaceable file is excluded, never clamped'
      },
      { kind: 'tool', file: 'tools/h10-session-rate.mjs', anchor: 'SEAMS', onAbsent: 'reads only the sidecars it finds', test: null }
    ]
  },
  {
    tag: 'LINK',
    writer: { file: 'capture-host/writers.py', anchor: 'class LinkLogWriter' },
    readers: [
      {
        kind: 'box',
        file: 'capture-host/timeline.py',
        anchor: 'def read_link_samples(',
        onAbsent: 'an unlistable folder is logged as absent, not empty',
        test: 'capture-host/tests/test_timeline_gaps.py::test_read_link_samples_tolerates_short_bad_and_unreadable_rows'
      },
      {
        kind: 'box',
        file: 'capture-host/battery_history.py',
        anchor: 'def read_link(',
        onAbsent: 'a missing root gives no points',
        test: 'capture-host/tests/test_battery_alerts.py::test_build_drops_points_older_than_the_window_and_survives_a_missing_root'
      },
      { kind: 'tool', file: 'tools/pat-connection-stability.mjs', anchor: 'function connectionSpans(', onAbsent: 'reads only the files it lists; an unreadable file stops the run', test: null }
    ]
  },
  {
    tag: 'CLOCK',
    writer: { file: 'capture-host/writers.py', anchor: 'class HostClockLogWriter' },
    readers: [
      {
        kind: 'box',
        file: 'capture-host/solid_night_inputs.py',
        anchor: 'def _seam_cause_records(',
        onAbsent: 'an unlistable night still tries the fixed name, and the verdict names no cause',
        test: 'capture-host/tests/test_solid_night_inputs.py::test_a_night_that_cannot_be_LISTED_still_tries_the_fixed_name_and_names_no_cause'
      }
    ]
  },
  {
    tag: 'OXYFRAME',
    writer: { file: 'capture-host/writers.py', anchor: 'class OxyFrameLogWriter' },
    readers: [
      {
        kind: 'box',
        file: 'capture-host/loss_audit.py',
        anchor: 'def oxyframe_samples(',
        onAbsent: 'an unreadable frame file is named and the others are still measured',
        test: 'capture-host/tests/test_loss_audit.py::test_ONE_unreadable_frame_file_is_NAMED_and_the_others_are_still_measured'
      },
      { kind: 'tool', file: 'tools/o2ring-step-imbalance.mjs', anchor: 'function readSession(', onAbsent: 'reads only the files it lists; an unreadable file stops the run', test: null },
      { kind: 'tool', file: 'tools/tch-third-corner.mjs', anchor: 'oxyframe', onAbsent: 'reads the file named by --oxyframe; an unreadable file stops the run', test: null }
    ]
  },
  {
    tag: 'RTCLOG',
    writer: { file: 'capture-host/writers.py', anchor: 'class RingClockLogWriter' },
    readers: [
      {
        kind: 'node',
        file: 'oxydex-dsp.js',
        anchor: 'function parseRingClockLog(',
        onAbsent: 'no text gives [], so the drop handler stashes no clock read',
        test: 'tests/dex-tests.js::parseRingClockLog · no text places no clock read'
      },
      {
        kind: 'box',
        file: 'capture-host/nightqc.py',
        anchor: 'def rtc_drift_summary(',
        onAbsent: 'no readback gives None',
        test: 'capture-host/tests/test_nightqc.py::test_rtc_drift_summary_none_when_no_readback'
      },
      {
        kind: 'box',
        file: 'capture-host/solid_night_inputs.py',
        anchor: 'def rtc_band(',
        onAbsent: 'a ring night with no log is UNKNOWN',
        test: 'capture-host/tests/test_solid_night_inputs.py::test_a_RING_NIGHT_WITH_NO_RTC_LOG_is_UNKNOWN_not_inapplicable'
      },
      { kind: 'tool', file: 'tools/trio-batch.mjs', anchor: 'function readRingClockLog(', onAbsent: 'no sidecar gives null', test: null }
    ]
  },
  {
    tag: 'PMDARRIVAL',
    writer: { file: 'capture-host/writers.py', anchor: 'class PmdArrivalLogWriter' },
    readers: [
      {
        kind: 'box',
        file: 'capture-host/nightqc.py',
        anchor: 'def arrival_quality(',
        onAbsent: 'a missing folder or an unreadable file is survived and named',
        test: 'capture-host/tests/test_pmd_arrival_writer.py::test_arrival_quality_survives_a_missing_directory'
      },
      {
        kind: 'box',
        file: 'capture-host/jitterfloor.py',
        anchor: 'def parse_pmdarrival(',
        onAbsent: 'reads a path its caller found, so an absent one RAISES rather than reading as an empty night',
        test: 'capture-host/tests/test_jitterfloor.py::test_an_ABSENT_arrival_sidecar_RAISES_rather_than_reading_as_an_EMPTY_night'
      },
      { kind: 'tool', file: 'tools/known-clock-recovery.mjs', anchor: 'function parseSidecar(', onAbsent: 'parses the text it is given', test: null },
      { kind: 'tool', file: 'tools/o2ring-frame-cadence.mjs', anchor: 'function readArrival(', onAbsent: 'an unreadable file stops the run', test: null }
    ]
  },
  {
    tag: 'RADIOCLOCK',
    writer: { file: 'capture-host/radioclock.py', anchor: 'def sidecar_name(' },
    note: 'radio-clock.js is in no bundle and no DSP calls it',
    residue: ROW_SEAMNODE,
    readers: [
      {
        kind: 'node',
        file: 'radio-clock.js',
        anchor: 'function parseRadioClock(',
        onAbsent: "ok:false, reason 'no sidecar text to read', streams null",
        test: 'tests/dex-tests.js::parseRadioClock · no sidecar text is a named refusal'
      },
      { kind: 'tool', file: 'tools/pat-floor-offset.mjs', anchor: 'function nightReport(', onAbsent: 'reads only the files it finds', test: null }
    ]
  },
  {
    tag: 'OXYLIFE',
    writer: { file: 'capture-host/writers.py', anchor: 'class OxyLifeLogWriter' },
    readers: [
      {
        kind: 'box',
        file: 'capture-host/capture.py',
        anchor: 'def _oxy_rec_journals(',
        onAbsent: 'reads each journal that exists; OSError skips one, and no night directory is created',
        test: 'capture-host/tests/test_oxy_rec_axis.py::test_an_absent_journal_seeds_unknown_and_CREATES_NO_night_directory'
      }
    ]
  },
  {
    tag: 'CLOCKSYNC',
    writer: { file: 'capture-host/writers.py', anchor: 'CLOCKSYNC_NAME = ' },
    readers: [
      {
        kind: 'box',
        file: 'capture-host/solid_night_inputs.py',
        anchor: 'def clock_records(',
        onAbsent: 'a missing record source gives None, not a shorter set',
        test: 'capture-host/tests/test_solid_night_inputs.py::test_a_MISSING_record_source_returns_None_rather_than_a_shorter_record_set'
      },
      {
        kind: 'box',
        file: 'capture-host/stitch_31d.py',
        anchor: 'def collect_sidecars(',
        onAbsent: 'no clock record leaves the offsets absent, never a zero',
        test: 'capture-host/tests/test_stitch_31d.py::test_an_ABSENT_clocksync_leaves_the_OFFSETS_ABSENT_and_never_a_zero'
      }
    ]
  },
  {
    tag: 'STARTS',
    writer: { file: 'capture-host/writers.py', anchor: 'STARTS_NAME = ' },
    readers: [
      {
        kind: 'box',
        file: 'capture-host/nightqc.py',
        anchor: 'def daemon_starts(',
        onAbsent: 'starts: None, never 0',
        test: 'capture-host/tests/test_starts_sidecar.py::test_an_absent_sidecar_is_NULL_not_zero'
      },
      {
        kind: 'box',
        file: 'capture-host/nightqc.py',
        anchor: 'def recorded_writer_offset(',
        onAbsent: 'an unreadable file falls back and claims no offset',
        test: 'capture-host/tests/test_nightqc.py::test_an_UNREADABLE_starts_file_falls_back_rather_than_claiming_an_offset'
      }
    ]
  },
  {
    tag: 'PMDNEG',
    writer: { file: 'capture-host/writers.py', anchor: 'PMDNEG_NAME = ' },
    readers: [
      {
        kind: 'box',
        file: 'capture-host/nightqc.py',
        anchor: 'def pmd_negotiations(',
        onAbsent: 'OSError is caught and the night reports no negotiation',
        test: 'capture-host/tests/test_pmdneg_sidecar.py::test_pmd_negotiations_counts_every_start_and_reports_a_rate_only_when_they_AGREE'
      },
      {
        kind: 'box',
        file: 'capture-host/solid_night_inputs.py',
        anchor: 'def negotiated_rate(',
        onAbsent: 'an unread menu publishes no rate',
        test: 'capture-host/tests/test_rate_intent.py::test_an_UNREAD_menu_publishes_no_rate_unmet'
      }
    ]
  },
  {
    tag: 'WORN',
    writer: { file: 'capture-host/writers.py', anchor: 'WORN_NAME = ' },
    readers: [
      {
        kind: 'box',
        file: 'capture-host/loss_audit.py',
        anchor: 'def daemon_worn_rows(',
        onAbsent: 'each wear end says in words that no WORN.csv was found, with every value null',
        test: 'capture-host/tests/test_loss_audit.py::test_EACH_WEAR_END_CARRIES_THE_DAEMONS_WORN_VERDICT_IN_FORCE_AT_IT'
      }
    ]
  },
  {
    tag: 'WEDGEFIRE',
    writer: { file: 'capture-host/capture.py', anchor: 'def _wedge_fire_record(' },
    readers: [
      {
        kind: 'box',
        file: 'capture-host/capture.py',
        anchor: 'def _wedge_recoveries(',
        onAbsent: 'no journal gives []',
        test: 'capture-host/tests/test_bluez_wedge_wire.py::test_NO_FIRE_JOURNAL_IS_AN_EMPTY_LIST_NOT_A_CRASH'
      }
    ]
  },
  {
    tag: 'SESSIONDETECT',
    writer: { file: 'capture-host/cpap_shadow_runner.py', anchor: 'class SessionSidecar' },
    readers: [
      {
        kind: 'box',
        file: 'capture-host/capture.py',
        anchor: 'def _cpap_autostart_boot(',
        onAbsent: 'an absent record is no decision',
        test: 'capture-host/tests/test_cpap_autostart_wire.py::test_an_absent_record_is_no_decision_and_a_CORRUPT_one_reads_as_STOPPED'
      }
    ]
  },
  {
    tag: 'AS11CLOCK',
    writer: { file: 'capture-host/as11_clock.py', anchor: 'class ClockSidecar' },
    readers: [
      {
        kind: 'box',
        file: 'capture-host/capture.py',
        anchor: 'def _as11_clock_offset(',
        onAbsent: 'ClockOffset.unknown(), never a zero',
        test: 'capture-host/tests/test_as11_clock_envelope.py::test_NO_SIDECAR_is_ClockOffset_unknown_not_a_zero'
      },
      {
        kind: 'box',
        file: 'capture-host/cpap_edf.py',
        anchor: 'def device_start_from_host(',
        onAbsent: 'reads the offset its caller passes, and an UNMEASURED one raises',
        test: 'capture-host/tests/test_cpap_edf_sa2.py::test_an_unmeasured_offset_REFUSES_rather_than_writing_an_unknown_axis'
      }
    ]
  },
  {
    tag: 'ADAPTERHCI',
    writer: { file: 'capture-host/adapter_hci.py', anchor: 'FILE_NAME = "ADAPTERHCI.csv"' },
    readers: [
      {
        kind: 'box',
        file: 'capture-host/adapter_hci.py',
        anchor: 'def read_rows(',
        onAbsent: '[] when the file is absent',
        test: 'capture-host/tests/test_adapter_hci.py::test_read_rows_filters_to_the_window_and_is_empty_when_the_file_is_absent'
      }
    ]
  }
];

/* Open rows about a reader that is not handed its sidecar. They are not registry claims; they are
   ranked beside the census because the owner asked for every open sidecar row in one order. */
export const RELATED_ROWS = [
  { key: '2026-11-01-no-folded-artefact-names-an-unread-ecg-sidecar', cls: 'node' },
  { key: '2026-10-17-sample-parsers-called-without-their-sidecar', cls: 'node' },
  { key: '2026-11-03-the-ecg-leg-of-the-shared-pat-extractor-takes-no-sidecar', cls: 'tool' },
  { key: '2026-11-02-no-caller-hands-the-shared-pat-foot-extractor-its-sidecar', cls: 'tool' },
  { key: '2026-10-28-pat-legs-refuse-only-the-spans-a-sidecar-confirmed', cls: 'tool' },
  { key: '2026-11-04-the-archived-radio-clock-corpus-predates-its-own-seam-marker', cls: 'tool' }
];

const CLASS_RANK = { 'no-reader': 0, node: 1, box: 2, tool: 3 };

/* ── DISCOVERY ─────────────────────────────────────────────────────────────────────────────────── */

/** Code lines of a Python file: comments and docstring bodies are dropped, so prose names nothing. */
export function pyCodeLines(text) {
  const out = [];
  let inDoc = false;
  for (const line of String(text).split('\n')) {
    const q = (line.match(/"""|'''/g) || []).length;
    const was = inDoc;
    if (q % 2) inDoc = !inDoc;
    if (was || q || /^\s*#/.test(line)) continue;
    out.push(line.replace(/\s+#.*$/, ''));
  }
  return out;
}

/** Every sidecar-shaped name the code spells, with the first file:line that spells it. */
export function discover(root) {
  const dir = join(root, 'capture-host');
  const found = new Map();
  const add = (tag, where) => {
    if (!found.has(tag)) found.set(tag, where);
  };
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.py'))
    .sort();
  for (const f of files) {
    const lines = pyCodeLines(readFileSync(join(dir, f), 'utf8'));
    lines.forEach((l, i) => {
      const where = `capture-host/${f}:code-line ${i + 1}`;
      for (const m of l.matchAll(/["'][^"'\n]*?([A-Z][A-Z0-9]{2,}(?:-[A-Z]+)?)\.(?:csv|txt)["']/g)) add(m[1], where);
      for (const m of l.matchAll(/capture_filename\([^)]*?,\s*["']([a-z0-9]+)["']\s*,\s*["'](?:csv|txt)["']/g)) add(m[1].toUpperCase(), where);
      if (/RUNS\.\{/.test(l)) add('RUNS', where);
      const box = l.match(/BOX_WIDE_SIDECAR_TAGS\s*=\s*\(([^)]*)\)/);
      if (box) for (const m of box[1].matchAll(/["']([A-Z0-9]+)["']/g)) add(m[1], where);
    });
  }
  return found;
}

/** The registry tag a discovered name belongs to, or the non-sidecar class that claims it, or null. */
export function classify(name, registry) {
  for (const s of registry) {
    if (s.tag === name || (s.names || []).includes(name)) return { sidecar: s.tag };
  }
  if (name.endsWith('RUNS') && registry.some((s) => s.tag === 'RUNS')) return { sidecar: 'RUNS' };
  if (name.endsWith('SEAMS') && registry.some((s) => s.tag === 'SEAMS')) return { sidecar: 'SEAMS' };
  for (const [cls, list] of Object.entries(NOT_SIDECARS)) if (list.includes(name)) return { not: cls };
  return null;
}

/* ── THE CHECKS ────────────────────────────────────────────────────────────────────────────────── */

function fileHas(root, rel, needle, cache) {
  const p = join(root, rel);
  if (!cache.has(p)) cache.set(p, existsSync(p) ? readFileSync(p, 'utf8') : null);
  const t = cache.get(p);
  return t !== null && t.includes(needle);
}

function testExists(root, ref, cache) {
  const i = ref.indexOf('::');
  if (i < 0) return false;
  const file = ref.slice(0, i),
    name = ref.slice(i + 2);
  return file.endsWith('.py') ? fileHas(root, file, `def ${name}(`, cache) : fileHas(root, file, name, cache);
}

/**
 * The census over `root` against `registry`. Returns the report lines, the verdict and the ranking.
 * @param {string} root
 * @param {Sidecar[]} registry
 * @param {{related?: {key:string, cls:string}[], notSidecars?: object}} [opts]
 */
export function census(root, registry = REGISTRY, opts = {}) {
  const related = opts.related || RELATED_ROWS;
  const cache = new Map();
  const ledgerPath = join(root, 'briefs/RESIDUE.md');
  const rows = existsSync(ledgerPath) ? parseRows(readFileSync(ledgerPath, 'utf8')) : null;
  const stateOf = new Map((rows || []).map((r) => [r.id, r.state]));
  const findings = [];
  const lines = [];

  const discovered = discover(root);
  for (const [name, where] of discovered) {
    if (!classify(name, registry)) findings.push(`unclassified sidecar name ${name} (first at ${where}): add it to the registry or to NOT_SIDECARS`);
  }

  let readers = 0,
    untestedTools = 0;
  const cites = new Map();
  const cite = (key, cls, why) => {
    if (!cites.has(key)) cites.set(key, { key, cls, why: [] });
    const c = cites.get(key);
    if (CLASS_RANK[cls] < CLASS_RANK[c.cls]) c.cls = cls;
    c.why.push(why);
  };

  for (const s of registry) {
    if (!fileHas(root, s.writer.file, s.writer.anchor, cache)) findings.push(`${s.tag}: writer anchor "${s.writer.anchor}" is absent from ${s.writer.file}`);
    if (!s.readers.length) {
      if (!s.residue) findings.push(`${s.tag}: no code reads it and no residue row says so`);
      else cite(s.residue, 'no-reader', `${s.tag} has no reader`);
    } else if (s.residue) cite(s.residue, s.readers.some((r) => r.kind === 'node') ? 'node' : 'box', `${s.tag}: ${s.note || 'see the row'}`);
    lines.push(`${s.tag.padEnd(14)} writer ${s.writer.file} (${s.writer.anchor.replace(/[ =(]+$/, '')})${s.note ? ` — ${s.note}` : ''}`);
    if (!s.readers.length) lines.push(`${''.padEnd(14)} NO READER → ${s.residue || 'no row'}`);
    for (const r of s.readers) {
      readers++;
      if (!fileHas(root, r.file, r.anchor, cache)) findings.push(`${s.tag}: reader anchor "${r.anchor}" is absent from ${r.file}`);
      if (r.test && !testExists(root, r.test, cache)) findings.push(`${s.tag}: cited test ${r.test} does not exist`);
      if (!r.test) {
        if (r.residue) cite(r.residue, r.kind, `${s.tag} ${r.kind} reader ${r.file} (${r.anchor.replace(/[ =(]+$/, '')})`);
        else if (r.kind === 'tool') untestedTools++;
        else findings.push(`${s.tag}: ${r.kind} reader ${r.file} cites neither an absent-path test nor a residue row`);
      }
      const proof = r.test ? `test ${r.test.split('::')[0].split('/').pop()}` : r.residue ? `row ${r.residue}` : 'untested tool';
      lines.push(`${''.padEnd(14)} ${r.kind.padEnd(4)} ${r.file} — absent: ${r.onAbsent} [${proof}]`);
    }
  }
  for (const r of related) cite(r.key, r.cls, 'a reader not handed its sidecar');

  if (rows === null) findings.push('briefs/RESIDUE.md is absent, so no cited row can be checked');
  const ranking = [...cites.values()].map((c) => ({ key: c.key, cls: c.cls, state: stateOf.get(c.key) ?? null, why: c.why }));
  for (const c of ranking) if (rows !== null && c.state === null) findings.push(`cited residue key ${c.key} is not a row of briefs/RESIDUE.md`);
  const isOpen = (c) => /^OPEN\b/.test(String(c.state));
  ranking.sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || CLASS_RANK[a.cls] - CLASS_RANK[b.cls] || a.key.localeCompare(b.key));

  lines.push('', 'RANKED SIDECAR RESIDUE (open first; class: no-reader > node > box > tool)');
  ranking.forEach((c, i) =>
    lines.push(`${String(i + 1).padStart(2)}. [${c.cls}] ${c.key} — ${isOpen(c) ? 'OPEN' : c.state === null ? 'NOT IN THE LEDGER' : `closed: ${String(c.state).slice(0, 40)}`}`)
  );
  if (findings.length) lines.push('', 'FINDINGS', ...findings.map((f) => `  ✗ ${f}`));

  const sidecars = registry.length;
  const status = readers + sidecars === 0 ? 'NOT_RUN' : findings.length ? 'FAIL' : 'PASS';
  const verdict = makeVerdict({
    tool: TOOL,
    gate: GATE,
    status,
    population: { checked: sidecars, eligible: sidecars, excluded: 0 },
    criterion: { name: 'unaccounted_sidecar_claims', threshold: 0, unit: 'count', direction: 'lte' },
    result:
      status === 'NOT_RUN'
        ? null
        : {
            unaccounted: findings.length,
            sidecars,
            readers,
            discoveredNames: discovered.size,
            sidecarsWithNoReader: registry.filter((s) => !s.readers.length).map((s) => s.tag),
            untestedToolReaders: untestedTools,
            openRanked: ranking.filter(isOpen).map((c) => c.key)
          },
    evidence: [TOOL, 'capture-host/writers.py', 'briefs/RESIDUE.md'],
    reason: status === 'PASS' ? null : status === 'NOT_RUN' ? 'the registry names no sidecar' : `${findings.length} unaccounted claim(s): ${findings[0]}`
  });
  return { lines, verdict, status, ranking, findings };
}

/* ── SELFTEST — a planted tree, no corpus, every arm driven ────────────────────────────────────── */

function plant(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
}

const PLANT = {
  'capture-host/writers.py':
    'class FooLogWriter:\n    """Writes FOO.csv; a docstring BAR.csv names nothing."""\n    name = "FOO.csv"\n# a comment QUX.csv names nothing\nx = capture_filename(a, b, c, d, "ecg", "txt")\n',
  'capture-host/tests/test_foo.py': 'def test_absent_foo_is_none():\n    pass\n',
  'foo-dsp.js': 'function readFoo(text) { return null; }\n',
  'briefs/RESIDUE.md': '| 2026-01-01-a-planted-row | 2026-01-01 | `x` | d | e | OPEN |\n'
};
const PLANT_REG = () => [
  {
    tag: 'FOO',
    writer: { file: 'capture-host/writers.py', anchor: 'class FooLogWriter' },
    readers: [{ kind: 'node', file: 'foo-dsp.js', anchor: 'function readFoo(', onAbsent: 'null', test: 'capture-host/tests/test_foo.py::test_absent_foo_is_none' }]
  }
];

function selftest() {
  let fails = 0,
    n = 0;
  const eq = (label, got, want) => {
    n++;
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fails++;
    console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  };
  const root = mkdtempSync(join(tmpdir(), 'sidecar-census-'));
  try {
    const run = (files, reg, opts) => {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(root, { recursive: true });
      plant(root, { ...PLANT, ...files });
      return census(root, reg || PLANT_REG(), { related: [], ...opts });
    };
    const a = run({});
    eq('a registered sidecar with a tested reader passes', a.status, 'PASS');
    eq('…docstring and comment names are not discovered, a stream word is', [...discover(root).keys()].sort(), ['ECG', 'FOO']);
    eq('…and the stream word is declared, not a sidecar', classify('ECG', PLANT_REG()), { not: 'stream' });

    const b = run({ 'capture-host/writers.py': PLANT['capture-host/writers.py'] + 'y = "NEWTHING.csv"\n' });
    eq('a new sidecar name with no registry entry FAILS', b.status, 'FAIL');
    eq('…and the finding names it', /unclassified sidecar name NEWTHING/.test(b.findings[0]), true);

    const c = run({ 'capture-host/writers.py': PLANT['capture-host/writers.py'] + 'z = f"{base}RUNS.{ext}"\n' });
    eq(
      'the RUNS.{ext} form is discovered and FAILS unregistered',
      c.findings.some((f) => /unclassified sidecar name RUNS/.test(f)),
      true
    );

    const reg = PLANT_REG();
    reg[0].readers[0].test = 'capture-host/tests/test_foo.py::test_gone';
    eq('a cited test that does not exist FAILS', run({}, reg).status, 'FAIL');

    const reg2 = PLANT_REG();
    reg2[0].readers = [];
    eq('a sidecar with no reader and no row FAILS', run({}, reg2).status, 'FAIL');
    reg2[0].residue = '2026-01-01-a-planted-row';
    const d = run({}, reg2);
    eq('…and with a row it passes, ranked first as no-reader and OPEN', [d.status, d.ranking[0].cls, d.verdict.result.openRanked], ['PASS', 'no-reader', ['2026-01-01-a-planted-row']]);
    reg2[0].residue = '2026-01-01-no-such-row';
    eq('a cited row absent from the ledger FAILS', run({}, reg2).status, 'FAIL');

    const reg3 = PLANT_REG();
    reg3[0].readers[0].anchor = 'function renamedFoo(';
    eq('a reader anchor that no longer stands FAILS', run({}, reg3).status, 'FAIL');

    const reg4 = PLANT_REG();
    reg4[0].readers[0].test = null;
    eq('a node reader with neither test nor row FAILS', run({}, reg4).status, 'FAIL');
    reg4[0].readers[0].kind = 'tool';
    const e = run({}, reg4);
    eq('…a tool reader with no test is counted, not failed', [e.status, e.verdict.result.untestedToolReaders], ['PASS', 1]);

    eq('an empty registry examined nothing: NOT_RUN with a null result', [run({}, []).verdict.status, run({}, []).verdict.result], ['NOT_RUN', null]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  console.log(fails ? `${fails} of ${n} selftests failed` : `all ${n} selftests passed`);
  return fails ? 1 : 0;
}

function verdictSample() {
  const root = mkdtempSync(join(tmpdir(), 'sidecar-census-'));
  try {
    plant(root, PLANT);
    return census(root, PLANT_REG(), { related: [] }).verdict;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (isCliEntry(import.meta.url)) {
  refuseUnknownArgvOrExit(process.argv.slice(2), { boolean: ['--json', '--selftest', '--verdict-sample'] }, { tool: TOOL });
  const flag = (f) => process.argv.includes(f);
  if (flag('--selftest')) process.exit(selftest());
  if (flag('--verdict-sample')) {
    printVerdict(verdictSample(), { json: true });
    process.exit(0);
  }
  const res = census(ROOT);
  if (flag('--json')) console.log(JSON.stringify(res.verdict, null, 1));
  else {
    console.log(res.lines.join('\n'));
    printVerdict(res.verdict);
  }
  process.exit(res.status === 'PASS' ? 0 : 1);
}
