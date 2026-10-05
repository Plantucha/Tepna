/**
 * tools/absence-ledger.mjs — Tepna
 * Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
 *
 * A STATE PER FINDING FOR `audits/ABSENCE-SURVEY-2026-09-22.json`, written by this tool and never by
 * hand. The survey confirmed 290 findings on 2026-09-23 and there was nowhere to record what happened
 * to any of them, so nothing did: `capture-host/mmeta.py:112` sat CONFIRMED for six days while the
 * same defect was found again independently and fixed by #3216. A finding with no state is a finding
 * nobody can be said to have dropped.
 *
 * ⚠️ THE SURVEY'S OUTPUT IS NOT EDITED. The state lives in a SIDECAR beside it. What 130 agents found
 * on 2026-09-23 is a record of that date, and a drain that rewrites it loses the ability to say what
 * was found versus what was done about it — the same rule as a capture: the bytes are immutable and
 * correction lives beside the file, dated and attributed (`CLAUDE.md` §∅).
 *
 * ── THE KEY IS CONTENT PLUS POSITION ────────────────────────────────────────────────────────────
 * Line numbers move on every edit, so a line-keyed state file detaches from its finding the first
 * time anything above it changes. The key is therefore `file · kind · normalised snippet`, plus an
 * OCCURRENCE ORDINAL among identical triples — #3192's lesson, learnt when a content-only key mapped
 * two distinct mutants onto one entry and blanked four of them.
 *
 * Measured on the committed artifact: 290 findings, 290 distinct triples, so **every ordinal is 0
 * today and the ordinal adds nothing to any current key**. It is here anyway, because that is exactly
 * what was true of the mutant ledger the day before it was not.
 *
 * ── THREE STATES, NOT TWO ───────────────────────────────────────────────────────────────────────
 *   open                  nothing has been decided about it
 *   fixed                 the code no longer does what the finding describes
 *   accepted-with-reason  it still does, deliberately, and the REASON is recorded in the code
 *
 * The third is not bureaucracy, it is what a two-state drain gets wrong forever. `telemetry.py:118`
 * (`calibrated_for`) treats an unknown rate as in-domain and its docstring now says why: *"AN UNKNOWN
 * RATE (None) IS TREATED AS IN-DOMAIN. That is deliberate and is the one concession: every caller that
 * cannot report a rate predates this parameter, and refusing there would silently disable worn
 * detection for all of them."* That is neither open nor fixed, and with two states it is re-litigated
 * by every session that reaches it.
 *
 * `accepted-with-reason` REQUIRES a `reason`; the schema refuses it empty, because an acceptance whose
 * argument is not written down is indistinguishable from a finding somebody gave up on.
 *
 * ── WHAT THIS TOOL DOES NOT CLAIM ───────────────────────────────────────────────────────────────
 * It does not decide states. The seeds below come from HAND-READING the seven capture-host findings
 * whose recorded snippet no longer matches the file, and everything else is `open` — including the 55
 * JS findings in the same condition, which were NOT read and must not be credited as fixed. Reclaiming
 * by content is not decidable on this artifact: snippets carry the survey's own annotations, 21 of them
 * contain literal ellipses, and several collapse multi-line source onto one line, so an automated
 * "gone" over-counted fixes by ~3.5× on the only population small enough to check
 * (`audits/COUNTING-ZERO-POPULATION-SURVEY-2026-09-29.md`).
 *
 *   node tools/absence-ledger.mjs             # verify: re-key and compare against the committed file
 *   node tools/absence-ledger.mjs --write     # (re)write the sidecar
 *   node tools/absence-ledger.mjs --selftest  # the properties below
 *   node tools/absence-ledger.mjs --ratchet [--json]   # the gate (`npm run verify:absence`)
 *
 * ── THE RATCHET (owner-commissioned drain, 2026-10-04) ──────────────────────────────────────────
 * `audits/ABSENCE-SURVEY-2026-09-22-RATCHET.json` holds ONE number, the open count, and the gate holds
 * it EQUAL to the state file's `counts.open` — an equality, not a floor. A rise is red (a finding was
 * re-opened or a seed lost); a fall without lowering the ceiling in the same PR is red too, because a
 * ceiling left above the count is headroom the next regression spends silently. The gate also requires
 * the state file to be byte-identical to a rebuild, so the count it reads was written by this tool and
 * not by hand. One `tepna.verdict/1` object, `--json` printing only that.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { makeVerdict } from './verdict-emit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SURVEY = join(ROOT, 'audits', 'ABSENCE-SURVEY-2026-09-22.json');
export const LEDGER = join(ROOT, 'audits', 'ABSENCE-SURVEY-2026-09-22-STATE.json');
export const RATCHET = join(ROOT, 'audits', 'ABSENCE-SURVEY-2026-09-22-RATCHET.json');

export const STATES = ['open', 'fixed', 'accepted-with-reason'];

/** Whitespace-collapsed, so a reformat does not re-key a finding. Nothing else is normalised: the
 *  snippet's TEXT is the identity, and lowering or stripping punctuation would merge distinct ones. */
export const normalise = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/** `file · kind · snippet · occurrence` → a 12-hex digest. The ordinal is the count of identical
 *  triples seen BEFORE this one, so entry order in the survey fixes it and re-running is stable. */
export function keyOf(finding, occurrence = 0) {
  const parts = [finding.file, finding.kind, normalise(finding.snippet), String(occurrence)];
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 12);
}

/** Every finding keyed, with its ordinal resolved. Pure. */
export function keyAll(confirmed) {
  const seen = new Map();
  return confirmed.map((f) => {
    const triple = [f.file, f.kind, normalise(f.snippet)].join('\u0000');
    const occurrence = seen.get(triple) ?? 0;
    seen.set(triple, occurrence + 1);
    return { key: keyOf(f, occurrence), occurrence, finding: f };
  });
}

/** A row is well-formed, or this says which rule it breaks. Pure; returns null when it is fine. */
export function rowProblem(row) {
  if (!row || typeof row !== 'object') return 'not an object';
  if (!STATES.includes(row.state)) {
    return `state ${JSON.stringify(row.state)} is not one of ${STATES.join(' · ')}`;
  }
  if (row.state === 'accepted-with-reason' && !normalise(row.reason)) {
    return 'accepted-with-reason carries no reason — an acceptance whose argument is not written down is a finding somebody gave up on';
  }
  return null;
}

/* ── THE SEEDS. Hand-read 2026-09-29; see the audit named in the header. Keyed by file+line ONLY here,
 *    because that is how a human reads them; the tool converts to the content key below, which is what
 *    is stored. A seed that matches no finding is a REFUSAL, not a silent no-op. ─────────────────── */
export const SEEDS = [
  {
    at: 'capture-host/cpap_live.py:67',
    state: 'fixed',
    note: 'a NEGATIVE detector age (host clock step between publish and serve) is None, not 0, so live_view reports unknown rather than fresh. Plant: test_cpap_live detector_age_s future-stamp assertion (2026-10-04, Wren)'
  },
  {
    at: 'capture-host/oxyii.py:702',
    state: 'fixed',
    note: 'worn is True / False (0, observed lead-off) / None (2 unplugged, 3 fault); on None the link axis makes no IDLE_UNWORN flip and the card names the fault. Plant: test_a_FAULTED_probe_is_wear_UNKNOWN_and_journals_no_unworn_flip (2026-10-04, Wren)'
  },
  {
    at: 'capture-host/o2ring.py:342',
    state: 'fixed',
    note: 'an undecryptable reply is withheld (payload None, raw kept, undecrypted=True); FILE_LIST/FILE_START raise and the pull closes the transfer and refuses instead of writing ciphertext into the file. Plant: test_pull_session_REFUSES_a_chunk_that_did_not_decrypt_rather_than_writing_ciphertext (2026-10-04, Wren)'
  },
  {
    at: 'capture-host/o2ring.py:335',
    state: 'open',
    note: 'NOT changed: a keyed-session reply whose length is not AES-shaped may be genuine plaintext for some ops, which only hardware can show (Kestrel, 2026-10-04: hardware-only)'
  },
  {
    at: 'capture-host/polar_psftp.py:736',
    state: 'fixed',
    note: 'fixed #2955 (0349d73e): manifest ok now also requires unenumerated == 0 (truncated + unreadable dirs), with the count published beside it. Re-read 2026-10-04 (Wren)'
  },
  {
    at: 'capture-host/cpap_edf_writer.py:116',
    state: 'fixed',
    note: 'a batch carrying one channel is skipped for both (counted in unpaired_batches, logged), so flow and pressure stay aligned. Plant: test_a_batch_carrying_ONE_channel_is_skipped_for_BOTH_so_flow_and_pressure_stay_aligned (2026-10-04, Wren)'
  },
  {
    at: 'capture-host/capture.py:10173',
    state: 'fixed',
    note: 'a presence scan that RAISED was folded as an empty window, aging a present ring to ABSENT; the fold is now skipped and a never-observed ring is published UNKNOWN. Plant: test_failed_scans_past_the_absence_window_leave_a_PRESENT_ring_PRESENT (2026-10-04, Wren)'
  },
  {
    at: 'capture-host/capture.py:607',
    state: 'accepted-with-reason',
    reason:
      '_RT_PPG_SPAN_S is the POLL PERIOD, not a device rate: the 0x05 reply covers the interval since the previous poll, which #3253 made a 1.000 s deadline. Its comment states the cost — a full buffer over-states the span it covers, visibly — and why that beats a fabricated per-sample rate.'
  },
  {
    at: 'capture-host/capture.py:3356',
    state: 'fixed',
    note: 'ruled 2026-10-04 (Kestrel, capture lane) under #3268 declared-rate contract: a frame pushed before negotiation carries None, so the bus publishes the declared 0, never pmd.SAMPLE_HZ. The two tests that pinned the vendor default are rewritten to that contract. Plants: test_a_push_before_negotiation_carries_NO_rate_and_the_bus_publishes_the_DECLARED_one, test_the_live_bus_push_carries_the_sample_values_not_the_sample_objects (Wren)'
  },
  {
    at: 'capture-host/capture.py:3388',
    state: 'fixed',
    note: 'the HR writer is fed None, not 0: the SIG HR characteristic has no device clock and the seam sidecar opens on any non-None one. Plant: test_an_HR_session_opens_NO_seam_sidecar_because_HR_has_no_device_clock (2026-10-04, Wren)'
  },
  {
    at: 'capture-host/capture.py:3662',
    state: 'fixed',
    note: 'a PMD rate menu not read publishes no key instead of [], which webmon copied over the menu it had seen. Plant: test_a_menu_NOT_READ_publishes_no_key_rather_than_an_empty_list (2026-10-04, Wren)'
  },
  {
    at: 'capture-host/capture.py:9758',
    state: 'fixed',
    note: 'an auto-start record that exists and cannot be read reads as a manual stop, with a warning, instead of (None, 0); a missing record is unchanged. Plant: test_an_absent_record_is_no_decision_and_a_CORRUPT_one_reads_as_STOPPED (2026-10-04, Wren)'
  },
  {
    at: 'capture-host/capture.py:10833',
    state: 'fixed',
    note: 'after a FAILED MTU acquire the log says the MTU is unknown instead of publishing BlueZ placeholder 23 as measured; the write step is unchanged. Plant: test_a_failed_mtu_acquire_leaves_the_placeholder_and_the_link_up (2026-10-04, Wren)'
  },
  {
    at: 'capture-host/allan.py:655',
    state: 'fixed',
    note: 'the [-2,+2] clamp is gone and the docstring now states why it was wrong; verified by reading the file 2026-09-29'
  },
  {
    at: 'capture-host/sealbox.py:280',
    state: 'fixed',
    note: '`max(..., default=<now>)` replaced by an explicit list plus "if nothing is left the answer is absence, not now"'
  },
  {
    at: 'capture-host/telemetry.py:118',
    state: 'accepted-with-reason',
    reason:
      'calibrated_for treats an unknown rate (None) as in-domain, deliberately: every caller that cannot report a rate predates the parameter, and refusing there would silently disable worn detection for all of them. The concession and its cost are stated in the function docstring.'
  },
  {
    at: 'capture-host/probe_verity_survey.py:587',
    state: 'open',
    note: 'reads as "gone" only because the recorded snippet collapses a multi-statement line; `or b""` is still present, 5 occurrences in the file'
  },
  {
    at: 'capture-host/probe_verity_offline.py:187',
    state: 'open',
    note: 'same false-gone as probe_verity_survey.py:587 — `or b""` still present'
  },
  {
    at: 'capture-host/nightqc.py:1676',
    state: 'fixed',
    note: "fixed #3030 (5997a632): the doff is now the trailing off-run's first CLOCK second (`ppg2w_contact` tail_start → `doff_at`), so the count arithmetic `t0 + (epochs - trailing_off_epochs)` that this finding names is gone with its defect, not just reworded. Re-read 2026-10-04 (Wren); it was held open 09-29 because content alone could not decide it"
  },
  {
    at: 'capture-host/nightqc.py:713',
    state: 'fixed',
    note: 'count_rows returns None for an unreadable file, and summarize keeps it out of every row sum, lists the stream under `unreadable` and the file under `unreadable_files`; qc_verdict reads UNKNOWN naming it. Plant: test_an_unreadable_capture_is_unknown_never_missing_or_zero (2026-10-04, Wren)'
  },
  {
    at: 'capture-host/writers.py:1544',
    state: 'fixed',
    note: 'the site was still live (re-read 2026-10-04, Wren): a resumed ECG file whose anchor read raised fell back to lazy init and restarted `timestamp [ms]` at 0.0 mid-file. Now `_rel_anchor_lost` leaves the column EMPTY for the rest of the file (ECGDex skips a non-finite [ms]; nightqc never reads it). Plant: test_a_resumed_ecg_whose_anchor_CANNOT_be_read_leaves_the_relative_column_EMPTY'
  },
  {
    at: 'capture-host/diskguard.py:42',
    state: 'fixed',
    note: '`free_pct` is None, not 0.0 (a full disk), when the filesystem reports no size; monitor.html renders "size unknown" / "free fraction unknown". Plant: test_a_zero_total_reports_NO_percent_rather_than_dividing_by_it (2026-10-04, Wren)'
  },
  {
    at: 'capture-host/telemetry.py:874',
    state: 'fixed',
    note: 'push() broadcasts the DECLARED rate (frame fs, else the stream fs, 0 = irregular, else None) instead of `or 1`; the 1 survives only as ring sizing. snapshot() reports None for an undeclared stream. monitor.html reads `d.fs ?? …` in both SSE handlers. Plants: test_push_publishes_a_DECLARED_irregular_stream_as_rate_0_never_1, test_push_publishes_NO_rate_for_an_unmetered_stream_and_still_sizes_its_ring (2026-10-04, Wren)'
  },
  {
    at: 'capture-host/bonding.py:79',
    state: 'fixed',
    note: '_btctl returns None when bluetoothctl does not answer; is_bonded / trusted_flags / scan read it as unknown (no forced re-pair, no "BlueZ reports no bond" on no evidence) and the adapter watchdog says BlueZ did not answer instead of reaching it through a TypeError. Plants: test_bonding unanswered-info + test_an_UNANSWERED_bluez_probe_is_said_as_such_not_reached_through_a_TypeError (2026-10-04, Wren)'
  },
  {
    at: 'capture-host/clockcfg.py:74',
    state: 'fixed',
    note: 'when `timedatectl show` fails, ntp_enabled / synchronized / contract.tz_set are None (not False) beside available: false, and both monitor pills read a grey "unknown" instead of NTP "off" / "check zone/sync". Plant: test_clockcfg (2 tests red on origin/main) (2026-10-05, Wren)'
  },
  {
    at: 'capture-host/sealbox.py:342',
    state: 'fixed',
    note: 'an unreadable existing seal is an absent READING, not an absent seal: existing_header returns {_unreadable: why}, seal_or_reissue emits UNKNOWN (checked 0) and leaves the file exactly as it was (re-sealing is an operator action); a header missing revision or keyId is UNKNOWN, never revision 1 under keyId 0. Owner ruling 2026-10-04. Plants: test_sealbox unreadable-seal + missing-number tests (2026-10-05, Wren)'
  },
  {
    at: 'capture-host/mmeta.py:112',
    state: 'fixed',
    note: 'generated_count returns None (not 0) for an unreadable mutants file, and mutate_diff refuses that glob as NOT MEASURED instead of summing 0 into the verdict generated total; the benign-arm consumer the survey traced was already guarded by generated_scan + unmeasured_zero. Plant: test_generated_count_is_NONE_not_zero_when_the_mutants_file_is_absent (2026-10-05, Wren)'
  },
  {
    at: 'capture-host/mutation_diff.py:146',
    state: 'fixed',
    note: 'functions_covering returns None on source that does not parse, and mutate_diff refuses an unparseable or unreadable module as NOT MEASURED instead of printing none-inside-a-function and dropping it from the population. Plant: test_functions_covering_yields_nothing_outside_a_function_or_on_bad_source (2026-10-05, Wren)'
  },
  {
    at: 'capture-host/night_report.py:129',
    state: 'fixed',
    note: 'fixed #2971 (4b5b0c3e): back_check returns UNKNOWN when no class-B block was examined, never ok over an empty population. Re-read 2026-10-05 (Wren)'
  },
  {
    at: 'capture-host/acq_evidence_cpap.py:141',
    state: 'fixed',
    note: 'COMPLETE requires lost_coverage_missing present and empty and total_lost present, else UNKNOWN with provenance.unmeasured_loss naming the categories (ruled 2026-10-05 for the owner). Every live CPAP session now reads UNKNOWN: stalls / post_drop_tail have no writer (residue 2026-10-05-cpap-stall-and-post-drop-counters-have-no-writer). Plant: test_TODAYS_live_summary_shape_is_UNKNOWN_with_the_unmeasured_categories_named (2026-10-05, Wren)'
  },
  {
    at: 'capture-host/probe_pmd_opcodes.py:105',
    state: 'fixed',
    note: 'diff reports a key unread on either side as unread: True instead of matching None to None, so net_state_change no longer says none over unread state and the abort gate trips on it. Plant: test_pmd_diff_reports_an_UNREAD_key_instead_of_matching_None_to_None (2026-10-05, Wren; survivors through the Codex reader)'
  },
  {
    at: 'capture-host/probe_verity_survey.py:216',
    state: 'fixed',
    note: '_settings returns None for a query nobody answered, never {} (this mode has no settings). Plant: test_an_UNANSWERED_settings_query_is_None_not_an_empty_menu (2026-10-05, Wren; survivors through the Codex reader)'
  },
  {
    at: 'capture-host/probe_pmd_surface.py:535',
    state: 'fixed',
    note: '_clock_conclusion with no BEFORE stamp is inconclusive, never sample clock unchanged. Plant: test_no_stamp_BEFORE_the_write_is_inconclusive_never_unchanged (2026-10-05, Wren; survivors through the Codex reader)'
  },
  {
    at: 'capture-host/probe_polar_onboard.py:78',
    state: 'fixed',
    note: 'summarize_fs counts an entry with no size or the -1 of an unlistable directory as unsized_entries instead of 0 bytes; totals cover sized entries. Plant: test_an_UNSIZED_entry_is_counted_not_read_as_zero_bytes (2026-10-05, Wren; survivors through the Codex reader)'
  },
  {
    at: 'capture-host/probe_oxyii_0x03.py:107',
    state: 'fixed',
    note: 'summarise counts a header-less reply (count None) as replies_truncated, apart from a declared zero, and verdict_object says malformed replies, not an empty ring. Plants: test_a_TRUNCATED_reply_is_counted_apart_from_a_declared_zero, test_an_all_TRUNCATED_run_says_malformed_not_an_empty_ring (2026-10-05, Wren; survivors through the Codex reader)'
  },
  {
    at: 'capture-host/probe_verity_survey.py:335',
    state: 'fixed',
    note: 'fixed #3042 (13c2e96a): stopped_confirmed_by_device is None when the AFTER status read was not answered. Re-read 2026-10-05 (Wren)'
  },
  {
    at: 'capture-host/probe_verity_survey.py:587',
    state: 'fixed',
    note: 'fixed #3042 (13c2e96a): was_active / still_active are None when the BEFORE status read was not answered. Re-read 2026-10-05 (Wren)'
  },
  {
    at: 'capture-host/probe_verity_offline.py:187',
    state: 'fixed',
    note: 'fixed #3042 (13c2e96a): recording_confirmed_by_device is not published False from an unanswered read. Re-read 2026-10-05 (Wren)'
  },
  {
    at: 'capture-host/probe_oxyii_0x03.py:303',
    state: 'fixed',
    note: 'run() publishes reported_pr_n beside reported_pr_mean, the n of polls that carried a PR (the mean and records_per_beat rest on it, not on beats_polled). Plant: test_the_pulse_rate_mean_publishes_the_n_it_rests_on (2026-10-05, Wren)'
  }
];

/** Build the ledger from the survey plus the seeds. Pure given both. */
export function build(survey, seeds = SEEDS) {
  const keyed = keyAll(survey.confirmed);
  const byAt = new Map(keyed.map((k) => [`${k.finding.file}:${k.finding.line}`, k]));
  const missing = seeds.filter((s) => !byAt.has(s.at)).map((s) => s.at);
  if (missing.length) {
    throw new Error(`seed(s) match no finding: ${missing.join(', ')} — a seed that silently does nothing is how a hand-read gets lost`);
  }
  const seedByKey = new Map(seeds.map((s) => [byAt.get(s.at).key, s]));
  const entries = keyed.map(({ key, occurrence, finding }) => {
    const s = seedByKey.get(key);
    const row = {
      key,
      file: finding.file,
      kind: finding.kind,
      severity: finding.severity ?? null,
      occurrence,
      /* The line at the time of the survey. RECORDED, never keyed on: it is provenance, not identity. */
      surveyLine: finding.line,
      state: s?.state ?? 'open'
    };
    if (s?.reason) row.reason = s.reason;
    if (s?.note) row.note = s.note;
    return row;
  });
  const bad = entries.map((e) => [e.key, rowProblem(e)]).filter(([, p]) => p);
  if (bad.length) throw new Error(`built a malformed row: ${bad[0][0]} — ${bad[0][1]}`);
  const tally = Object.fromEntries(STATES.map((s) => [s, entries.filter((e) => e.state === s).length]));
  return {
    _README: [
      'STATE FOR audits/ABSENCE-SURVEY-2026-09-22.json — WRITTEN BY tools/absence-ledger.mjs, NEVER BY HAND.',
      '',
      'The survey artifact beside this one is the record of what was found on 2026-09-23 and is not edited.',
      'This file records what has been DONE about each finding. Keys are content + occurrence, never the',
      'line, so an edit above a finding does not detach its state.',
      '',
      `States: ${STATES.join(' · ')}. An accepted-with-reason row must carry the reason; the builder refuses otherwise.`,
      '',
      'Everything not hand-read is `open`. "The snippet no longer matches the file" is NOT evidence of a fix:',
      'measured 2026-09-29, an automated reclaim over-counted fixes by ~3.5x on the only population small',
      'enough to verify. See audits/COUNTING-ZERO-POPULATION-SURVEY-2026-09-29.md.'
    ],
    source: 'audits/ABSENCE-SURVEY-2026-09-22.json',
    states: STATES,
    counts: { findings: entries.length, ...tally },
    entries
  };
}

const render = (o) => `${JSON.stringify(o, null, 1)}\n`;

/** The ONE verdict this tool emits. Pure given its inputs, so the selftest exercises the real shape.
 *  `ceiling` is the committed ratchet number; `built` is the rebuilt state; `identical` says whether the
 *  committed state file matched that rebuild. Every finding is examined to decide whether it is open, so
 *  the population is all of them — the open count is the RESULT, not the population. */
export function ratchetVerdictObject({ ceiling, built, identical }) {
  const open = built.counts.open;
  const findings = built.counts.findings;
  let status = 'PASS';
  let reason = null;
  if (!identical) {
    status = 'FAIL';
    reason = 'the committed state file is not what this tool would write — re-run `node tools/absence-ledger.mjs --write`; it is never hand-edited';
  } else if (!Number.isInteger(ceiling)) {
    status = 'UNKNOWN';
    reason = `the ratchet file carries no integer \`open\` (got ${JSON.stringify(ceiling)})`;
  } else if (open > ceiling) {
    status = 'FAIL';
    reason = `open findings ROSE: ${open} > ceiling ${ceiling} — a finding was re-opened or a seed was lost`;
  } else if (open < ceiling) {
    status = 'FAIL';
    reason = `open findings fell to ${open} but the ceiling is still ${ceiling} — set \`open: ${open}\` in audits/ABSENCE-SURVEY-2026-09-22-RATCHET.json IN THIS PR`;
  }
  return makeVerdict({
    gate: 'absence-survey-ratchet',
    tool: 'tools/absence-ledger.mjs',
    status,
    scope: 'internal',
    population: { checked: findings, eligible: findings, excluded: 0 },
    criterion: { name: 'open_absence_findings', threshold: Number.isInteger(ceiling) ? ceiling : 0, unit: 'findings', direction: 'eq' },
    result: status === 'UNKNOWN' ? null : { open, ceiling, fixed: built.counts.fixed, accepted: built.counts['accepted-with-reason'] },
    evidence: ['audits/ABSENCE-SURVEY-2026-09-22-STATE.json', 'audits/ABSENCE-SURVEY-2026-09-22-RATCHET.json'],
    reason
  });
}

export function readCeiling() {
  if (!existsSync(RATCHET)) return undefined;
  return JSON.parse(readFileSync(RATCHET, 'utf8')).open;
}

export function selftest() {
  const fail = [];
  let ran = 0;
  /* COUNTED, not stated. A hardcoded total drifts the moment an assertion is added or removed, and a
     selftest whose reported count is a literal is one more number nobody re-derives. */
  const ok = (cond, what) => {
    ran += 1;
    if (!cond) fail.push(what);
  };

  const survey = JSON.parse(readFileSync(SURVEY, 'utf8'));
  const built = build(survey);

  /* 1 · re-keying the committed file is byte-identical — the property that makes "written by a tool"
   *     checkable rather than a claim. */
  if (existsSync(LEDGER)) {
    ok(readFileSync(LEDGER, 'utf8') === render(built), 'committed ledger is byte-identical to a rebuild');
  }

  /* 2 · a state outside the three refuses, and so does an acceptance with no argument. */
  ok(rowProblem({ state: 'wontfix' }) !== null, 'an unknown state refuses');
  ok(rowProblem({ state: 'fixed' }) === null, 'a known state passes');
  ok(rowProblem({ state: 'accepted-with-reason' }) !== null, 'acceptance with no reason refuses');
  ok(rowProblem({ state: 'accepted-with-reason', reason: '   ' }) !== null, 'a blank reason is no reason');
  ok(rowProblem({ state: 'accepted-with-reason', reason: 'because x' }) === null, 'acceptance with a reason passes');

  /* 3 · the key is content + POSITION: identical content at two sites must not collide. */
  const twin = [
    { file: 'a.js', kind: 'default-number', snippet: 'return x || 0;', line: 10 },
    { file: 'a.js', kind: 'default-number', snippet: 'return  x || 0;', line: 99 }
  ];
  const k = keyAll(twin);
  ok(k[0].key !== k[1].key, 'identical content at two sites gets distinct keys');
  ok(k[0].occurrence === 0 && k[1].occurrence === 1, 'the ordinal counts identical triples in order');
  ok(keyOf(twin[0], 0) === k[0].key, 'keyOf and keyAll agree at ordinal 0');

  /* 4 · the key ignores reflow but not content. */
  ok(keyOf({ file: 'a.js', kind: 'k', snippet: 'a  +\n b' }) === keyOf({ file: 'a.js', kind: 'k', snippet: 'a + b' }), 'whitespace does not re-key');
  ok(keyOf({ file: 'a.js', kind: 'k', snippet: 'a + b' }) !== keyOf({ file: 'a.js', kind: 'k', snippet: 'a - b' }), 'a changed operator does re-key');
  ok(keyOf({ file: 'a.js', kind: 'k', snippet: 's' }) !== keyOf({ file: 'b.js', kind: 'k', snippet: 's' }), 'the file is part of the identity');

  /* 5 · the LINE is not part of the key — the whole reason this is content-addressed. */
  ok(keyOf({ file: 'a.js', kind: 'k', snippet: 's', line: 1 }) === keyOf({ file: 'a.js', kind: 'k', snippet: 's', line: 900 }), 'moving a finding does not re-key it');

  /* 6 · a seed that matches nothing refuses rather than doing nothing silently. */
  let refused = false;
  try {
    build(survey, [{ at: 'no/such/file.py:1', state: 'fixed' }]);
  } catch {
    refused = true;
  }
  ok(refused, 'a seed matching no finding refuses');

  /* 7 · every seed landed, and the tally adds up. */
  ok(built.counts.findings === survey.confirmed.length, 'every finding has a row');
  ok(STATES.reduce((a, s) => a + built.counts[s], 0) === built.counts.findings, 'the tally covers every row');
  ok(built.counts.fixed === SEEDS.filter((s) => s.state === 'fixed').length, 'the fixed count is the seeded one');
  ok(built.counts['accepted-with-reason'] === SEEDS.filter((s) => s.state === 'accepted-with-reason').length, 'the accepted count is the seeded one');
  ok(new Set(built.entries.map((e) => e.key)).size === built.entries.length, 'keys are unique');
  /* 8 · the ratchet is an EQUALITY: a rise and an un-lowered fall are both red, equal is green, a
   *     hand-edited state is red whatever the count, and a ratchet file with no number cannot pass. */
  const n = built.counts.open;
  const rv = (ceiling, identical = true) => ratchetVerdictObject({ ceiling, built, identical }).status;
  ok(rv(n) === 'PASS', 'open == ceiling passes');
  ok(rv(n - 1) === 'FAIL', 'a rise above the ceiling fails');
  ok(rv(n + 1) === 'FAIL', 'a fall without lowering the ceiling fails');
  ok(rv(n, false) === 'FAIL', 'a state file that is not the rebuild fails at any count');
  ok(rv(undefined) === 'UNKNOWN', 'no ceiling is UNKNOWN, never a pass');
  ok(ratchetVerdictObject({ ceiling: n, built, identical: true }).population.checked === built.counts.findings, 'the population is every finding');
  const committed = readCeiling();
  ok(committed === undefined || rv(committed) === 'PASS', 'the committed ceiling equals the open count');

  if (fail.length) {
    console.error(`✗ absence-ledger selftest: ${fail.length} failed`);
    for (const f of fail) console.error(`    ${f}`);
    return 1;
  }
  console.log(`  absence-ledger: ${built.counts.findings} findings — ${built.counts.fixed} fixed · ` + `${built.counts['accepted-with-reason']} accepted · ${built.counts.open} open`);
  console.log(`  all ${ran} selftests passed`);
  return 0;
}

function main(argv) {
  refuseUnknownArgvOrExit(argv, { boolean: ['--write', '--selftest', '--ratchet', '--json'], valued: [] }, { tool: 'absence-ledger' });
  if (argv.includes('--selftest')) return selftest();
  if (argv.includes('--ratchet')) {
    const b = build(JSON.parse(readFileSync(SURVEY, 'utf8')));
    const identical = existsSync(LEDGER) && readFileSync(LEDGER, 'utf8') === render(b);
    const v = ratchetVerdictObject({ ceiling: readCeiling(), built: b, identical });
    if (argv.includes('--json')) {
      console.log(JSON.stringify(v));
    } else {
      const mark = v.status === 'PASS' ? '✓' : '✗';
      console.log(`  ${mark} absence-survey ratchet ${v.status}: ${b.counts.open} open of ${b.counts.findings}` + (v.reason ? ` — ${v.reason}` : ''));
      console.log(JSON.stringify(v));
    }
    return v.status === 'PASS' ? 0 : 1;
  }
  const built = render(build(JSON.parse(readFileSync(SURVEY, 'utf8'))));
  if (argv.includes('--write')) {
    writeFileSync(LEDGER, built, 'utf8');
    console.log(`wrote ${LEDGER}`);
    return 0;
  }
  if (!existsSync(LEDGER)) {
    console.error('✗ absence-ledger: no state file. Run with --write.');
    return 2;
  }
  if (readFileSync(LEDGER, 'utf8') !== built) {
    console.error('✗ absence-ledger: the committed state file is not what this tool would write.');
    console.error('  It is tool-written by contract — re-run with --write rather than editing it.');
    return 1;
  }
  console.log('  absence-ledger: committed state file is byte-identical to a rebuild');
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('absence-ledger.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
