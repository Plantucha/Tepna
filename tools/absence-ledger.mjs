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
 * ── THE STATE IS KEYED TO THE PRODUCER, AND THE CONSUMER CARRIES NO ROW ────────────────────────
 * A finding names a PRODUCING line, so a fix at the producer closes its row while a consumer that
 * reads the same null as a number keeps no row of its own. Measured: the sleep-stability component in
 * `oxydex-dsp.js` read a nulled hypoxic-burden rate as `((15 - hb.rate) / 15) * 100`, which clamps to a
 * perfect 100, so a night with no measured second scored 81 and "Good" — and the producer's own row
 * already read `fixed`. #4562 repaired four such consumers and closed ZERO findings, because the drain,
 * the ratchet and `npm run verify:absence` have no site to close.
 *
 * Each finding does carry a `consumer` field naming where the value is read, so the CENSUS below counts
 * what the survey itself named. It is a LOWER BOUND, because prose is not a schema, and it reports what
 * it could not read rather than folding that into a zero (§∅): a finding whose consumer field names no
 * `file:line` is counted apart. Today 287 of 290 findings name at least one site, 330 distinct sites in
 * all, and 15 of those 330 are themselves a keyed finding — so 315 consumer sites sit outside everything
 * this tool can state. The ratchet keeps deciding the PRODUCER drain; the census rides in its verdict so
 * that an `open: 0` can never be read as the class being drained.
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
 * THE WRITE READING (§3 of `WRITE-ROOT-ADOPTION-2026-11-03-BRIEF.md`). `--write` writes
 * `audits/ABSENCE-SURVEY-2026-09-22-STATE.json`, a TRACKED work-unit artifact, so the tree it lands
 * in decides whether the work-unit keeps it. It resolves that tree through `writeRootOrDie` at the
 * write site: a run launched from one checkout against another checkout's copy refuses at exit 2 and
 * names both trees. Every READ keeps its own reach, so another checkout may still import `LEDGER`.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { refuseUnknownArgvOrExit, isCliEntry } from './argv-guard.mjs';
import { makeVerdict } from './verdict-emit.mjs';
import { writeRootOrDie } from './write-root.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SURVEY = join(ROOT, 'audits', 'ABSENCE-SURVEY-2026-09-22.json');
const LEDGER_REL = ['audits', 'ABSENCE-SURVEY-2026-09-22-STATE.json'];
export const LEDGER = join(ROOT, ...LEDGER_REL);
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

/* ── THE CONSUMER CENSUS. Pure over the survey; reads no file. ──────────────────────────────────── */

/** A `path:line` written anywhere in consumer prose. The path may be absolute or home-rooted, because
 *  the survey recorded what each agent typed. */
const CONSUMER_PATH = /((?:[~A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:js|mjs|py|html|json|md|txt|css|sh)):(\d+)/g;

/** A bare `line N` or `lines N`, which names a line in the FINDING'S OWN file. 14 findings name their
 *  consumer only this way, and dropping them would under-report the census it exists to measure. */
const CONSUMER_BARE_LINE = /\bline[s]? (\d+)/g;

/** The repo directories a recorded path may be rooted above. */
export const REPO_TOPS = ['capture-host/', 'tools/', 'tests/', 'audits/', 'briefs/', 'docs/', 'changes/', 'licensing/', 'analysis/', 'papers/', 'provenance/'];

/** Reduce a recorded path to a repo-relative one. A path rooted outside the repo keeps only its
 *  basename: a checkout location is one agent's machine, never part of a site's identity. */
export function repoRelative(path) {
  const p = String(path ?? '');
  if (!p.includes('/')) return p;
  for (const top of REPO_TOPS) {
    const i = p.indexOf(top);
    if (i >= 0) return p.slice(i);
  }
  if (p.startsWith('~/') || p.startsWith('/')) return p.split('/').pop();
  return p;
}

/** The consumer sites ONE finding names, as `file:line` strings. Pure. The bare-line form resolves
 *  against the finding's own file, which is where a same-file consumer lives. */
export function consumerSitesOf(finding) {
  const prose = String(finding?.consumer ?? '');
  const fromPath = new Set();
  const fromBareLine = new Set();
  let m;
  CONSUMER_PATH.lastIndex = 0;
  while ((m = CONSUMER_PATH.exec(prose)) !== null) fromPath.add(`${repoRelative(m[1])}:${m[2]}`);
  CONSUMER_BARE_LINE.lastIndex = 0;
  while ((m = CONSUMER_BARE_LINE.exec(prose)) !== null) fromBareLine.add(`${finding?.file}:${m[1]}`);
  return { fromPath: [...fromPath], fromBareLine: [...fromBareLine] };
}

const basenameSite = (site) => {
  const i = site.lastIndexOf(':');
  return `${site.slice(0, i).split('/').pop()}${site.slice(i)}`;
};

/** How much of the consumer side this tool can state. Pure over the confirmed findings.
 *
 *  `sitesWithRow` matches a site against the keyed findings BY REPO-RELATIVE PATH ONLY. A basename and
 *  line that agree are not evidence of the same site: two files of one name in two directories collide
 *  on `basenameSite`, so folding that arm into the covered count let a collision alone read as coverage
 *  (row `2026-11-08-the-absence-census-basename-arm-can-count-a-foreign-site-as-covered`). The arm still
 *  carries a real signal, because a path the survey wrote relative to a subtree matches nothing exactly,
 *  so it is REPORTED as `sitesMatchingARowByBasenameOnly` — a named subset of `sitesWithoutRow`, never
 *  summed into coverage. On the committed artifact the arm resolves 0 sites either way, so this changes
 *  the shape of the claim and no published number.
 *
 *  `findingsNamingNoSite` is the part the census could NOT read. It is reported, never summed into a
 *  zero: 3 findings describe their consumer in prose that names no line at all. */
export function consumerCensus(confirmed) {
  const findings = confirmed ?? [];
  const exact = new Set(findings.map((f) => `${f.file}:${f.line}`));
  const byBasename = new Set([...exact].map(basenameSite));
  const sites = new Set();
  let namingAPath = 0;
  let namingABareLineOnly = 0;
  let namingNoSite = 0;
  for (const f of findings) {
    const { fromPath, fromBareLine } = consumerSitesOf(f);
    for (const s of fromPath) sites.add(s);
    for (const s of fromBareLine) sites.add(s);
    /* The three arms partition the findings: a path (with or without a bare line beside it), a bare
       line and nothing else, or no line at all. A finding carrying both must land in ONE arm or the
       published halves stop adding up. */
    if (fromPath.length) namingAPath += 1;
    else if (fromBareLine.length) namingABareLineOnly += 1;
    else namingNoSite += 1;
  }
  let withRow = 0;
  let byBasenameOnly = 0;
  for (const s of sites) {
    if (exact.has(s)) withRow += 1;
    else if (byBasename.has(basenameSite(s))) byBasenameOnly += 1;
  }
  return {
    _note:
      "A LOWER BOUND read out of the survey's own `consumer` prose. The state above is keyed to the PRODUCING line, so a consumer site that is not itself a finding carries no state and no ratchet.",
    findings: findings.length,
    findingsNamingASite: findings.length - namingNoSite,
    findingsNamingNoSite: namingNoSite,
    findingsNamingASiteByPath: namingAPath,
    findingsNamingASiteByBareLineOnly: namingABareLineOnly,
    sites: sites.size,
    sitesWithRow: withRow,
    sitesWithoutRow: sites.size - withRow,
    /* AMBIGUOUS, AND INSIDE `sitesWithoutRow`. A basename-and-line agreement names a site a reader can
       chase by hand; it does not identify one, so it never counts as coverage. */
    sitesMatchingARowByBasenameOnly: byBasenameOnly
  };
}

/* ── THE SEEDS. Hand-read 2026-09-29; see the audit named in the header. Keyed by file+line ONLY here,
 *    because that is how a human reads them; the tool converts to the content key below, which is what
 *    is stored. A seed that matches no finding is a REFUSAL, not a silent no-op. ─────────────────── */
export const SEEDS = [
  {
    at: 'pat-align.js:53',
    state: 'fixed',
    note: 'the envelope grid starts UNMEASURED and a sample is what makes a bin a measurement, so a bin no accelerometer sample reached is NaN rather than a zero-fill; `findAnchors` takes its mean and sigma over the measured bins, `lagAtAnchor` refuses an anchor window carrying one and drops B-side holes from the overlap count, and `pat-dip-validate` publishes its quiet share over the measured bins with the coverage beside it. The recorded `_ACCRUNS.txt` runs are marked by the same mechanism (row 2026-11-05-the-pat-motion-envelope-ignores-the-acc-blanking-spans-it-is-handed). Plant: tests/dex-tests.js group PAT-align, the §∅ held-run legs (2026-11-06, Heron)'
  },
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
  },
  {
    at: 'capture-host/probe_oxyii_opcodes.py:168',
    state: 'fixed',
    note: 'an unanswered verification snapshot marks the op effect UNVERIFIED and stops the sweep (aborted_at + abort_reason), never _changed()=[] read as no byte moved. Plant: test_oxyii_an_UNANSWERED_verification_snapshot_is_UNVERIFIED_and_stops_the_sweep (2026-10-05, Wren; survivors through the Codex reader)'
  },
  {
    at: 'capture-host/probe_pmd_opcodes.py:163',
    state: 'fixed',
    note: 'an unanswered final status read publishes left_running None with left_running_reason, never [] (nothing running), and sends no stop blind. Plant: test_pmd_an_UNANSWERED_final_status_read_is_unknown_never_nothing_running (2026-10-05, Wren; survivors through the Codex reader)'
  },
  {
    at: 'oxydex-dsp.js:1355',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2961 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-dsp.js:2353',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2947 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-dsp.js:3211',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2943 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-dsp.js:3866',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2943 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-dsp.js:4710',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2956 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-dsp.js:4721',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2956 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-dsp.js:4724',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2956 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-dsp.js:6343',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2997 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-dsp.js:6718',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2937 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-dsp.js:6726',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2937 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-dsp.js:6890',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2996 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-dsp.js:6899',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2996 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:1100',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2925 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:1126',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2925 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:1150',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2925 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:1172',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2925 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:1196',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2925 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:1227',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2925 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:1249',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2925 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:1270',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2925 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:1345',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2925 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:1389',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2925 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:1400',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2941 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:1448',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2925 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:1476',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2925 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:1504',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2925 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:1532',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2925 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:1560',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2925 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:1588',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2925 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:1616',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2925 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:1746',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2941 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:2030',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2941 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:2337',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2941 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:3060',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2943 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-render.js:3315',
    state: 'fixed',
    note: 'ALREADY FIXED on main by #2939 before the drain reached it (the survey snippet is gone, and the fix was read at the code, not inferred from the missing snippet: a changed snippet is not a fixed finding). Bookkeeping only; no code in this PR.'
  },
  {
    at: 'oxydex-dsp.js:6714',
    state: 'fixed',
    note: "an imported summary with no n / artifactHrCleaned / artifactSpikesRemoved keeps null, never 0. Plant: the B1 assertions in tests/dex-tests.js (the parseJSONL group and 'OxyDex B1 · an unread motion cell and a synthesised gap span are not readings'), red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:6782',
    state: 'fixed',
    note: "the tIdx seconds basis is the recording span, else a FINITE durationMin x 60, else null; with no basis secs and tIdxBasis are null, never 0 s. Plant: the B1 assertions in tests/dex-tests.js (the parseJSONL group and 'OxyDex B1 · an unread motion cell and a synthesised gap span are not readings'), red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:6741',
    state: 'fixed',
    note: "an imported spike's baseline / peak / duration / spo2 stay null when absent, and mfm is derived only from a real HH:MM:SS stamp (parseTimeStr returns 0 on an unparseable one). Plant: the B1 assertions in tests/dex-tests.js (the parseJSONL group and 'OxyDex B1 · an unread motion cell and a synthesised gap span are not readings'), red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:6754',
    state: 'fixed',
    note: "an export with no oscillations block imports osc: null (not computed), never a computed-looking episodeCount 0. Plant: the B1 assertions in tests/dex-tests.js (the parseJSONL group and 'OxyDex B1 · an unread motion cell and a synthesised gap span are not readings'), red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:841',
    state: 'fixed',
    note: "an unread or empty motion cell is null, and a non-numeric one is null rather than parseInt(...) || 0; a real 0 stays 0. Plant: the B1 assertions in tests/dex-tests.js (the parseJSONL group and 'OxyDex B1 · an unread motion cell and a synthesised gap span are not readings'), red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:5375',
    state: 'fixed',
    note: "the 1 Hz gap-span fallback is kept but NAMED: gapSpanSource: 'assumed-1Hz' rides only on the fallback, so an assumed span is distinguishable from a measured one. Plant: the B1 assertions in tests/dex-tests.js (the parseJSONL group and 'OxyDex B1 · an unread motion cell and a synthesised gap span are not readings'), red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:3814',
    state: 'fixed',
    note: "buildFlags emits OK only when t90pct, minSpo2 and maxHr were measured, else NOT_FULLY_ASSESSED (the #3283 shape); its plant also found minSpo2 <= 88 true for null, now guarded. Plant: tests/dex-tests.js groups 'OxyDex B2 · a score or a verdict over an unmeasured input is no score' and 'OxyDex readiness composite' (expectations RECONCILED), red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:2518',
    state: 'fixed',
    note: "computeSmartSummary overallScore is null with nothing scoreable, never 0 (the healthy end of the scale), and the render gives a null score no colour. Plant: tests/dex-tests.js groups 'OxyDex B2 · a score or a verdict over an unmeasured input is no score' and 'OxyDex readiness composite' (expectations RECONCILED), red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:3990',
    state: 'fixed',
    note: "the stability subscore s1 drops out when spo2Std is unmeasured, never a clamped perfect 100. Plant: tests/dex-tests.js groups 'OxyDex B2 · a score or a verdict over an unmeasured input is no score' and 'OxyDex readiness composite' (expectations RECONCILED), red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:4005',
    state: 'fixed',
    note: "the stability subscore s6 drops out when t95pct is unmeasured, never a clamped perfect 100. Plant: tests/dex-tests.js groups 'OxyDex B2 · a score or a verdict over an unmeasured input is no score' and 'OxyDex readiness composite' (expectations RECONCILED), red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:6089',
    state: 'fixed',
    note: "computeSleepStageProxy classifies only windows whose motion was read; with none classifiable the proxy is null, never 0.0 % REM. Plant: tests/dex-tests.js groups 'OxyDex B2 · a score or a verdict over an unmeasured input is no score' and 'OxyDex readiness composite' (expectations RECONCILED), red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:6330',
    state: 'fixed',
    note: "readiness rmssdScore is null with no RMSSD and leaves the renormalised basis, never 0 of 30. Plant: tests/dex-tests.js groups 'OxyDex B2 · a score or a verdict over an unmeasured input is no score' and 'OxyDex readiness composite' (expectations RECONCILED), red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:6386',
    state: 'fixed',
    note: "readiness hrSlopeScore is null with no measured dip, never the half-credit 5. Plant: tests/dex-tests.js groups 'OxyDex B2 · a score or a verdict over an unmeasured input is no score' and 'OxyDex readiness composite' (expectations RECONCILED), red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:6354',
    state: 'fixed',
    note: "with no rows and no hint the sleep duration is absent, never an assumed six hours. Plant: tests/dex-tests.js groups 'OxyDex B2 · a score or a verdict over an unmeasured input is no score' and 'OxyDex readiness composite' (expectations RECONCILED), red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:6127',
    state: 'fixed',
    note: "computeVO2maxEstimate keeps the estimate but names an unentered age as ASSUMED (ageAssumed, the label, -15 confidence). Plant: tests/dex-tests.js groups 'OxyDex B2 · a score or a verdict over an unmeasured input is no score' and 'OxyDex readiness composite' (expectations RECONCILED), red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:6366',
    state: 'fixed',
    note: "no stage estimate means no neutral +5: the sleep component is duration and stage halves each scored only when measured, weighted by scores.sleepMax. Plant: tests/dex-tests.js groups 'OxyDex B2 · a score or a verdict over an unmeasured input is no score' and 'OxyDex readiness composite' (expectations RECONCILED), red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:2250',
    state: 'fixed',
    note: "computeVagalIndex returns null when pnn3, hrFloor or longestCleanRun is unmeasured, never hrFloor || 60 (nor pnn3 / cleanRun || 0). Plant: tests/dex-tests.js group 'OxyDex B3 · a derived metric over an unmeasured input is no metric', red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:2328',
    state: 'fixed',
    note: "computeOxyCrash returns null under 60 s (no crash search ran), never a count of 0. Plant: tests/dex-tests.js group 'OxyDex B3 · a derived metric over an unmeasured input is no metric', red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:5654',
    state: 'fixed',
    note: "computeLCSP returns null when motion was read on no row, never a 0-min severely fragmented period. Plant: tests/dex-tests.js group 'OxyDex B3 · a derived metric over an unmeasured input is no metric', red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:2092',
    state: 'fixed',
    note: "computeSympSurge scores each term only when measured (a spike search that found none is a measured 0; one that never ran is not) and renormalises over ssiBasis; all terms absent gives null. Plant: tests/dex-tests.js group 'OxyDex B3 · a derived metric over an unmeasured input is no metric', red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:3232',
    state: 'fixed',
    note: "computeHRV keeps only still, artifact-free rows WITH a finite HR, so a null HR is not a sample (it sorted first as the floor and read as 0 in the SD). Plant: tests/dex-tests.js group 'OxyDex B3 · a derived metric over an unmeasured input is no metric', red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:4454',
    state: 'fixed',
    note: "computeMotionSleep wasoPct is null when no post-onset window exists, never 0 % awake. Plant: tests/dex-tests.js group 'OxyDex B3 · a derived metric over an unmeasured input is no metric', red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:3189',
    state: 'fixed',
    note: "computeStats motionPct is over the rows whose motion was READ; none read gives null, never an understated share. Plant: tests/dex-tests.js group 'OxyDex B3 · a derived metric over an unmeasured input is no metric', red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:1555',
    state: 'fixed',
    note: "computeRollingMetrics worst30minT95 stays null until a 30-min window is evaluated, never 0. Plant: tests/dex-tests.js group 'OxyDex B3 · a derived metric over an unmeasured input is no metric', red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:7383',
    state: 'fixed',
    note: "oxyDesatConf returns null for an event with no recorded depth (the base term), never the 0.45 of a real shallow dip. Plant: tests/dex-tests.js group 'OxyDex B3 · a derived metric over an unmeasured input is no metric', red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-dsp.js:7314',
    state: 'fixed',
    note: "oxyBuildGangliorEvents uses a MEASURED sample interval or none: a stamp-less event that cannot be placed is not emitted, never placed at an assumed 1 Hz. Plant: tests/dex-tests.js group 'OxyDex B3 · a derived metric over an unmeasured input is no metric', red on the pre-fix oxydex-dsp.js."
  },
  {
    at: 'oxydex-render.js:230',
    state: 'fixed',
    note: "the review header's duration total sums only the timed nights and names the rest ('7h00m total (1 of 2 nights timed)'), never an untimed night as 0 minutes. Plant: tests/dex-tests.js group 'OxyDex R · render · an unmeasured night is not drawn as a 0 or a verdict' (OxyDex.reviewView called; the other sites extracted and run), red on the pre-fix oxydex-render.js."
  },
  {
    at: 'oxydex-render.js:1420',
    state: 'fixed',
    note: "the 7-day periodic-breathing mean averages the nights whose oscillation was computed; a window with none is null, never 0. Plant: tests/dex-tests.js group 'OxyDex R · render · an unmeasured night is not drawn as a 0 or a verdict' (OxyDex.reviewView called; the other sites extracted and run), red on the pre-fix oxydex-render.js."
  },
  {
    at: 'oxydex-render.js:2942',
    state: 'fixed',
    note: "an unmeasured AAI prints a dash with no class, never 'null' coloured good (null < 2 is true in JS). Plant: tests/dex-tests.js group 'OxyDex R · render · an unmeasured night is not drawn as a 0 or a verdict' (OxyDex.reviewView called; the other sites extracted and run), red on the pre-fix oxydex-render.js."
  },
  {
    at: 'oxydex-render.js:3087',
    state: 'fixed',
    note: "a T-index threshold with no figure (no entry, or a null pct) reads 'not measured', never a green 0 % row. Plant: tests/dex-tests.js group 'OxyDex R · render · an unmeasured night is not drawn as a 0 or a verdict' (OxyDex.reviewView called; the other sites extracted and run), red on the pre-fix oxydex-render.js."
  },
  {
    at: 'oxydex-render.js:3286',
    state: 'fixed',
    note: "'Clear' needs an oscillation search that ran and flagged no window; no search reads 'not measured' with no verdict colour. Plant: tests/dex-tests.js group 'OxyDex R · render · an unmeasured night is not drawn as a 0 or a verdict' (OxyDex.reviewView called; the other sites extracted and run), red on the pre-fix oxydex-render.js."
  },
  {
    at: 'oxydex-fusion.js:45',
    state: 'fixed',
    note: "_oxyHHMMSStoMs parses components by regex and range-checks them (Clock Contract §2.7): an unreadable stamp is null, never midnight, and 25:00:00 is null, never rolled to the next day. Plant: tests/dex-tests.js group 'OxyDex fusion · an unmeasured window, depth or stamp is not a measured 0' (fusion's published surface only), red on the pre-fix oxydex-fusion.js."
  },
  {
    at: 'oxydex-fusion.js:71',
    state: 'fixed',
    note: "an ECG with no recorded duration has no COVERAGE window (null), never a 0-minute point that 'overlaps no desat'; pairing still matches it by its start, explicitly. Plant: tests/dex-tests.js group 'OxyDex fusion · an unmeasured window, depth or stamp is not a measured 0' (fusion's published surface only), red on the pre-fix oxydex-fusion.js."
  },
  {
    at: 'oxydex-fusion.js:328',
    state: 'fixed',
    note: "with no usable ECG window the covered desat set is unknown: coveredDesats / coveragePct / confPct are null and the tile says coverage is unknown, never every desat of the night (a green 0 of N). Plant: tests/dex-tests.js group 'OxyDex fusion · an unmeasured window, depth or stamp is not a measured 0' (fusion's published surface only), red on the pre-fix oxydex-fusion.js."
  },
  {
    at: 'oxydex-fusion.js:375',
    state: 'fixed',
    note: "the covered share of the hypoxic burden exists only with desats AND a known window; otherwise no scoped burden and no dose per event, never the whole-night burden over a window-only count. Plant: tests/dex-tests.js group 'OxyDex fusion · an unmeasured window, depth or stamp is not a measured 0' (fusion's published surface only), red on the pre-fix oxydex-fusion.js."
  },
  {
    at: 'oxydex-fusion.js:281',
    state: 'fixed',
    note: "an event with no recorded depth carries null into desatDepth, never a 0 % dip. Plant: tests/dex-tests.js group 'OxyDex fusion · an unmeasured window, depth or stamp is not a measured 0' (fusion's published surface only), red on the pre-fix oxydex-fusion.js."
  },
  {
    at: 'oxydex-fusion.js:394',
    state: 'fixed',
    note: "the per-stage depth mean divides by the events that carried a depth (measured), and the row names the shortfall '(depth on k)', never a depth-less event as 0. Plant: tests/dex-tests.js group 'OxyDex fusion · an unmeasured window, depth or stamp is not a measured 0' (fusion's published surface only), red on the pre-fix oxydex-fusion.js."
  },
  {
    at: 'oxydex-fusion.js:65',
    state: 'accepted-with-reason',
    reason:
      "Ruled NOT A DEFECT (Kestrel, 2026-10-06, on this unit's plant evidence): the night window's durationMin 0 is a pairing anchor with one reader, ECG pairing, which treats a point at t0 as start-proximity; it is never published. Removing it routed an anchored, untimed night into the no-anchor lone-ECG fallback and paired an ECG recorded 26 h later (the unit's own first plant caught it). The reader that would misread a 0, coverage, now refuses on no ECG duration. Recorded at the field: 'pairing anchor; 0 = untimed night; never published'."
  },
  {
    at: 'oxydex-profile.js:118',
    state: 'fixed',
    note: "upFromDOM reads an empty elevation field as null (not entered), never 0 m; upLoad and upToDOM already kept it null. Plant: tests/dex-tests.js group 'OxyDex profile · an unentered setting or unmeasured term is not a number', red on the pre-fix oxydex-profile.js."
  },
  {
    at: 'oxydex-profile.js:605',
    state: 'fixed',
    note: "recomputeFromProfile publishes rmssdAdj null with no RMSSD (never a measured-looking 0) and the VO2max estimate is the Uth-Sorensen base alone. Plant: tests/dex-tests.js group 'OxyDex profile · an unentered setting or unmeasured term is not a number', red on the pre-fix oxydex-profile.js."
  },
  {
    at: 'oxydex-profile.js:311',
    state: 'fixed',
    note: "the Karvonen zones and the HRrest sublabel read ONE upRestingHR() decision (manual / data / estimate): estimated zones are marked with an approx sign, and a detected value outside 30-80 makes the sublabel say the zones use the age estimate, so the two can no longer disagree. Plant: tests/dex-tests.js group 'OxyDex profile · an unentered setting or unmeasured term is not a number', red on the pre-fix oxydex-profile.js."
  },
  {
    at: 'pulsedex-app.js:788',
    state: 'fixed',
    note: "pxProfile publishes an unentered age as null, so Tanaka refuses and the VO2 estimate refuses with it; an entered HRmax still wins, and only the ESTIMATE goes away with the age. A bare removal would have published VO2 base 0.0, because (15.3 * null) / 60 is 0 and not NaN. Plant: tests/dex-tests.js group '∅ PulseDex profile body terms — absent stays null, never a population mean', 26 of its 35 legs red on the pre-fix sources, plus 3 tanakaHRmax legs that sit in the render-harness group and red there too."
  },
  {
    at: 'pulsedex-render.js:148',
    state: 'fixed',
    note: "the re-render road reads an absent age as null, the one Tanaka decision function tanakaHRmax refuses a null age (it returned a 208 bpm HRmax), and the metric table prints a dash for a refused VO2 base or adj instead of the word null. Plant: tests/dex-tests.js group '∅ PulseDex profile body terms — absent stays null, never a population mean', 26 of its 35 legs red on the pre-fix sources, plus 3 tanakaHRmax legs that sit in the render-harness group and red there too."
  },
  {
    at: 'pulsedex-overview.js:35',
    state: 'fixed',
    note: "pxProfile keeps an unentered age, weight and height null on BOTH of its paths, and every derived tile refuses and names the term it needs: BMI, BSA, IBW, BMR, HRmax, absolute VO2 and the Cooper percentile. The percentile also stopped reading an absent age as the 20s band, and the category stopped reading a refused percentile as the verdict Poor. Plant: tests/dex-tests.js group '∅ PulseDex profile body terms — absent stays null, never a population mean', 26 of its 35 legs red on the pre-fix sources, plus 3 tanakaHRmax legs that sit in the render-harness group and red there too."
  },
  {
    at: 'pulsedex-app.js:806',
    state: 'fixed',
    note: "BOOKKEEPING ONLY: the code was fixed earlier, by #5137, which kept an absent profile elevation null at all four PulseDex sites; this row stayed open because no PR lowered it. Plant: tests/dex-tests.js group '∅ PulseDex profile elevation — absent stays null, never sea level', landed with that fix."
  },
  {
    at: 'pulsedex-render.js:156',
    state: 'fixed',
    note: "BOOKKEEPING ONLY: the code was fixed earlier, by #5137, at the same time as the compute road above; the row stayed open because no PR lowered it. Plant: tests/dex-tests.js group '∅ PulseDex profile elevation — absent stays null, never sea level', landed with that fix."
  },
  {
    at: 'pulsedex-app.js:554',
    state: 'fixed',
    note: "findWTRow returns null when no Welltory row carries the recording's date, in place of `match || welltoryData.rows[0]`, which drew the FIRST row of the log as this day's reference. Every comparison cell already refuses a null row and falls to its dash, and the caption now names the date through wtRefLabel: matched, or no row for that day. Plant: tests/dex-tests.js group 'PulseDex Welltory reference', 3 legs red on the pre-fix pulsedex-app.js and 2 more on the pre-fix pulsedex-render.js caption."
  },
  {
    at: 'pulsedex-app.js:638',
    state: 'fixed',
    note: "BOOKKEEPING ONLY: the code was fixed earlier, by #5147, which starts the browser coverage at null and refuses a zero or negative wall span; this row stayed open because no PR lowered it. Plant: tests/dex-tests.js group '∅ PulseDex coverage — no wall clock means no coverage, never 100 %', landed with that fix."
  },
  {
    at: 'pulsedex-app.js:739',
    state: 'fixed',
    note: "BOOKKEEPING ONLY for the code, by #5116, which made the windowed respiratory rate null when no window produced one; no leg pinned the app copy of that arm, so this PR adds one. Plant: tests/dex-tests.js group '∅ PulseDex Poincare ratio — a long axis the reader sees as 0.00 is not a denominator', the respiratory rate leg."
  },
  {
    at: 'pulsedex-app.js:901',
    state: 'fixed',
    note: "the app road refuses the Poincare ratio when the long axis falls under the precision it prints. The null arm landed in #4470 and the zero arm stayed: the line read `sd1v / (sd2v || 1)`, which substitutes 1 ms for an SD2 the reader sees as `0.00` and publishes the short axis itself as a balance figure. PX_SD2_MIN_MS is half of the last decimal place SD2 prints, exactly as PPG_SD2_MIN_MS reads half of its own in ppgdex-dsp.js. Measured over the real DSP producers: 20001 beats alternating by 1 ms answer SD2 `0.00` and published a ratio of 0.71. Plant: tests/dex-tests.js group '∅ PulseDex Poincare ratio — a long axis the reader sees as 0.00 is not a denominator', 7 of its 20 legs red on the pre-fix pulsedex-app.js."
  },
  {
    at: 'pulsedex-app.js:1192',
    state: 'fixed',
    note: "BOOKKEEPING ONLY: the code was fixed earlier, by #5147, which counts the recordings weighted at the coverage floor and names them in the cross-night note; this row stayed open because no PR lowered it. Plant: tests/dex-tests.js group '∅ PulseDex coverage — no wall clock means no coverage, never 100 %', the covAbsentPx leg."
  },
  {
    at: 'pulsedex-dsp.js:130',
    state: 'fixed',
    note: "BOOKKEEPING ONLY: #5116 fixed both spectral helpers, which now read `hf > 0` and `tp > 0` and answer null, so a zero HF power no longer publishes an LF/HF ratio of 0 and a zero total power no longer publishes a normalised unit of 0. The row stayed open because no PR lowered it. Plant: tests/dex-tests.js group '∅ PulseDex absence — a nominal 14d/7d window is not a covered span, plus five pinned refusals', the two row 79f517014148 legs, which red on the restored zero form."
  },
  {
    at: 'pulsedex-dsp.js:587',
    state: 'fixed',
    note: "BOOKKEEPING ONLY: #5116 gated the spectral respiratory rate on `peakP > 0`, so a spectrum where no HF bin ever beat the initial peak reports null rather than a rate of 0 breaths per minute. The row stayed open because no PR lowered it. Plant: tests/dex-tests.js group '∅ PulseDex absence — a nominal 14d/7d window is not a covered span, plus five pinned refusals', the row 0907edcde0f0 leg, which reds on the restored unguarded form."
  },
  {
    at: 'pulsedex-dsp.js:1357',
    state: 'fixed',
    note: "BOOKKEEPING ONLY: #5116 made the window respiratory rate null when no window produced a usable rate, and the line carries its own absence comment. The row stayed open because no PR lowered it. Plant: tests/dex-tests.js group '∅ PulseDex absence — a nominal 14d/7d window is not a covered span, plus five pinned refusals', the row 355d05bb00d1 leg, which reds on the restored zero arm."
  },
  {
    at: 'pulsedex-overview.js:110',
    state: 'fixed',
    note: "BOOKKEEPING ONLY: #5162 replaced the `(a.tMs || 0)` comparator with the shared clock key, so a Welltory row whose stamp never parsed sorts LAST instead of leading the series from 1970. The row stayed open because no PR lowered it. Plant: tests/dex-tests.js group '∅ PulseDex absence — a nominal 14d/7d window is not a covered span, plus five pinned refusals', the row c2feca060110 leg, which reds on the restored comparator."
  },
  {
    at: 'pulsedex-overview.js:201',
    state: 'fixed',
    note: "the recovery-debt chip stated a 14-day denominator over whatever the last 14 ROWS covered, and pxHistory accepts a file with as few as one row, so four measurements read `Recovery debt 3/14d`. §∅ reduced COVERAGE annotates, so the chip now prints the span its own stamps cover, and a slice with fewer than two placeable stamps prints its measurement count instead. A row whose stamp never parsed holds `tMs: NaN` and can never widen a span it cannot place. Plant: tests/dex-tests.js group '∅ PulseDex absence — a nominal 14d/7d window is not a covered span, plus five pinned refusals', 7 of its 29 legs red on the pre-fix pulsedex-overview.js."
  },
  {
    at: 'pulsedex-overview.js:447',
    state: 'fixed',
    note: "the KPI grid captioned its Recov Index and SDNN Z against a `7d baseline` that was the last 7 ROWS, accepted at three, so a slice spanning a month wore a seven-day label. Both sublabels now name the measured span through the same helper, and the ungated default reads `vs rolling baseline` rather than a day count. Plant: tests/dex-tests.js group '∅ PulseDex absence — a nominal 14d/7d window is not a covered span, plus five pinned refusals', the two sublabel legs plus the span-helper legs."
  },
  {
    at: 'pulsedex-render.js:114',
    state: 'fixed',
    note: "BOOKKEEPING ONLY: #4701 deleted renderKPI, the dead function that held `(r.sdann || 0)`, so no surface substitutes zero for an uncomputable long-recording index; the table cell and the KPI card both refuse. The row stayed open because no PR lowered it. Plant: tests/dex-tests.js group '∅ PulseDex absence — a nominal 14d/7d window is not a covered span, plus five pinned refusals', the row e48b693fb537 leg, which reds on a restored zero default."
  },
  {
    at: 'hrvdex-profile.js:49',
    state: 'fixed',
    note: "the observed heart-rate maximum stays null when no row carries a usable rate, in place of 0, and the auto-detection banner prints not detected beside it. Plant: tests/dex-tests.js group '∅ HRVDex profile — an unobserved HR maximum and an absent ACSM band refuse', 3 of its 17 legs red on the pre-fix hrvdex-profile.js."
  },
  {
    at: 'hrvdex-profile.js:608',
    state: 'fixed',
    note: "calcVo2Cat refuses when the ACSM table carries no band for that age and sex, in place of the invented cut points 25, 30, 35, 40 and 45; femaleNorms stops at the 55-59 band, so every woman aged 60 or over read a fitness category over numbers no paper carries, while the male table runs to 65-69. The profile card names the absent band. Plant: tests/dex-tests.js group '∅ HRVDex profile — an unobserved HR maximum and an absent ACSM band refuse', 5 more of its 17 legs red on the pre-fix source."
  },
  {
    at: 'hrvdex-profile.js:365',
    state: 'fixed',
    note: "The producer refused and the last consumer still coerced: hrRest nulls when no loaded row carries a heart rate, and 0.011 * null is 0, so the full Baevsky AP published 0.022 for a dataset with no heart rate at all \u2014 the same string it returns for a resting HR of 0 bpm \u2014 under the citation 'Baevsky 1984 regression'. The Karvonen zone table already refused on this null; this term did not. bap_full now refuses and the card prints an em dash with the reason. Plant: tests/dex-tests.js group '\u2205 HRVDex profile \u2014 a null resting HR refuses the Baevsky adaptation potential', 4 of its 9 legs red on the pre-fix source."
  },
  {
    at: 'hrvdex-profile.js:45',
    state: 'fixed',
    note: "BOOKKEEPING \u2014 the code already refuses and only this ledger row stayed open. PR #2972 (eeab2513f) replaced the `: 60` default with `: null`, so a dataset with no usable heart rate reports 'not detected' in place of '60 bpm' under an 'Auto-detected from your data' banner. Every consumer of the value refuses with it: the banner at the detected line, `_hrRestV`, the explicit `_hrRestV != null` arm of the HRmax plausibility guard, and the Uth-S\u00f8rensen VO\u2082 estimate, which divides by it. Pins: tests/dex-tests.js group '\u2205 HRVDex profile \u2014 four high absence rows the code already refuses'. A mutant restoring `: 60` reds 2 legs."
  },
  {
    at: 'hrvdex-profile.js:353',
    state: 'fixed',
    note: "BOOKKEEPING \u2014 the code already refuses and only this ledger row stayed open. PR #2975 (de1907baf) took the mean over the rows that CARRY a reading, so `_hrRest0` nulls when none does. Before it, each row without a heart rate added 0 to the numerator and 1 to the denominator, which dragged the resting HR down and made the relative HRmax test easier to clear. With no reading the relative test is now SKIPPED rather than run against a fabricated number, while the absolute conditions still apply, and the value's only other consumer sits behind `_rhrProj > 0`. A mutant restoring `: 60` reds 2 legs, and a mutant deleting the null arm of the guard reds 2."
  },
  {
    at: 'hrvdex-profile.js:378',
    state: 'fixed',
    note: "BOOKKEEPING \u2014 the code already refuses and only this ledger row stayed open. PR #2967 (55bc00f17) guarded absolute VO\u2082 on `p.vo2gt > 0`, so an unset ground truth prints an em dash and the card hint says 'enter VO\u2082max ground truth'. `p.vo2gt` is 0 by PROTOCOL when nothing was entered and nothing was detected, which `detOr0` documents, so the 0 is deliberate and the display layer is what had to refuse. A mutant removing the guard reds 2 legs."
  },
  {
    at: 'hrvdex-profile.js:486',
    state: 'fixed',
    note: 'BOOKKEEPING \u2014 the code already refuses and only this ledger row stayed open. PR #2967 (55bc00f17) gave `vo2Percentile` its unset branch. Before it, 0 sat below the first Cooper point, the interpolation loop never matched, and the tail `: 1` published the 1st percentile \u2014 the worst possible fitness ranking, from no data at all. The function now answers null for a non-positive or non-finite VO\u2082, and the card prints a dash. A mutant deleting the branch reds 6 legs, which is the whole measured arm plus its controls.'
  },
  {
    at: 'hrvdex-dsp.js:1076',
    state: 'fixed',
    note: "computeCAMQ raised its sympathetic penalty only when the row measured BOTH spectral bands, because the penalty reads LF/HF. So a night with no spectrum took the kindest sympathetic verdict on the scale: rMSSD 40 alone scores a PERFECT 100, and a row with HF but no LF scores exactly the 88 that a MEASURED LF/HF of 1.0 scores, so ch_camq could never separate them. The penalty has no honest substitute, and an absent leg reduces COVERAGE without breaking continuity, so the owner ruling of 2026-09-17 annotates here: camqSympMeasured answers whether the leg was measured, and ch_camq marks every unmarked point by shape AND colour, with the card note naming what the marker means. A refusal would have dropped a measured parasympathetic score from every spectrum-less night, which is the common Ganglior and ECGDex row. Pins: tests/dex-tests.js group '\u2205 HRVDex derived metrics \u2014 the sympathetic leg and the AUC coverage count', whose 9 legs red on the pre-fix source."
  },
  {
    at: 'hrvdex-dsp.js:886',
    state: 'fixed',
    note: "d_stress_auc summed the window's measured readings and published that sum at full magnitude, so ONE reading read as a 7-day load in the 'Stress AUC 7d' column, and in the CSV and JSONL keys built from it. Both siblings beside it gate their own coverage, since d_ari needs four days and d_rmssd_cv7 needs two. A sum stays defined over one reading, so the owner ruling of 2026-09-17 annotates rather than refuses: d_stress_auc_n carries the count of contributing readings and is its own TABLE_COLS column, so the table, the CSV and the JSONL all publish it. The count is null exactly when the AUC refuses, so no consumer can read a 0 as a covered window. _dayWindow is span-bounded and holds no fixed row per day, so the count is readings, never days. Pins: tests/dex-tests.js group '\u2205 HRVDex derived metrics \u2014 the sympathetic leg and the AUC coverage count', whose 9 legs red on the pre-fix source."
  },
  {
    at: 'hrvdex-dsp.js:860',
    state: 'fixed',
    note: "BOOKKEEPING \u2014 the code already refuses and only this ledger row stayed open. PR #2980 (174d4bda9) replaced the asymmetric guard pair on d_rmssd_delta_pct. The old line tested `prev._rmssd > 0` for the previous night and `!isNaN(r._rmssd)` for the current one, and isNaN(null) is false, so an absent rMSSD passed and ((null - prev) / prev) * 100 is exactly -100: the table printed '-100.0%' and the chart painted a red bar for a night that simply carries no rMSSD. The line now needs both nights above zero and a day gap of exactly 1. Pins: tests/dex-tests.js group '\u2205 HRVDex derived metrics \u2014 the sympathetic leg and the AUC coverage count' pins the refusal; the sibling group 'HRVDex \u2205 \u2014 an unrecorded rMSSD is absent, not a \u2212100 % collapse' carries its controls."
  },
  {
    at: 'hrvdex-dsp.js:879',
    state: 'fixed',
    note: "BOOKKEEPING \u2014 the code already refuses and only this ledger row stayed open. PR #2969 (ab5653299) replaced the `!isNaN(v)` filter on stress7 with Number.isFinite. isNaN(null) is false, so an absent subjective Stress entered the window as a real 0 and a week with no Welltory Stress column at all summed to an AUC of 0, which reads as 'no stress'. Every ECGDex and Ganglior row lacks that column, so this was the common case. Number.isFinite drops absence and keeps a real 0, which is a legitimate reading. Pins: tests/dex-tests.js group '\u2205 HRVDex derived metrics \u2014 the sympathetic leg and the AUC coverage count' pins the all-absent refusal; the sibling group 'HRVDex \u2205 \u2014 an absent subjective Stress is not a Stress of zero' carries the controls."
  },
  {
    at: 'hrvdex-dsp.js:909',
    state: 'fixed',
    note: "BOOKKEEPING \u2014 the code already refuses and only this ledger row stayed open. PR #2969 (ab5653299) also guarded the lag-1 autocorrelation pairs on Number.isFinite, so a day with no Stress drops its PAIRS rather than contributing a 0 to the correlation, and an all-absent window refuses. Pins: tests/dex-tests.js group '\u2205 HRVDex derived metrics \u2014 the sympathetic leg and the AUC coverage count' pins the all-absent refusal, and the sibling group 'HRVDex \u2014 the 14-day windows and the event confidence clamps' already pins the finite case at a lag-1 result of -1 across a gap."
  },
  {
    at: 'hrvdex-dsp.js:946',
    state: 'fixed',
    note: "BOOKKEEPING \u2014 the code already refuses and only this ledger row stayed open. PR #4660 (796dcd56b) gated d_recovery_debt on ari14.length, so a 14-day window carrying no measured ARI refuses in place of counting 0 debt days. A 0 there read as a fortnight of perfect recovery over a fortnight with no rMSSD at all. Pins: tests/dex-tests.js group '\u2205 HRVDex derived metrics \u2014 the sympathetic leg and the AUC coverage count' pins the refusal, and the group 'HRVDex computeDerived \u2014 the ARGUMENT-PATH columns' already pins both the refusal and a real debt of 0 beside it."
  },
  {
    at: 'hrvdex-dsp.js:1074',
    state: 'fixed',
    note: "BOOKKEEPING \u2014 the code already refuses and only this ledger row stayed open. PR #2922 (0bb0ca8d6) replaced `paraCount ? paraScore / paraCount : 50` with a refusal. The 50 was not a conservative default but a CONSTANT: sympPenalty needs _hf above zero, and an _hf above zero would itself have raised paraCount, so the branch could only ever return exactly 50 whatever else the row carried. A number that cannot vary with its input says nothing about the night, and 50 is mid-scale, so it drew as an average night on ch_camq. Pins: tests/dex-tests.js group '\u2205 HRVDex derived metrics \u2014 the sympathetic leg and the AUC coverage count' pins it against a row carrying only _lf, and the existing legs at the \u00a71.3 group pin the mid-scale value itself."
  },
  {
    at: 'hrvdex-render.js:383',
    state: 'fixed',
    note: "Every KPI delta cell guarded only the previous night, so `(null - 42).toFixed(1)` printed '-42.0' and the chip read a confident 42-point drop while the value cell beside it honestly read an em dash. The row named `_hrv` alone, and all five cells carried the one defect: `_stress` and `_energy` are a literal null on the PulseDex-sourced row (hrvdex-dsp.js:644), where `null - null` is 0, so the chip then claimed no change. A delta over an absent member is a DISCONTINUITY, not a reduced coverage, so the owner ruling of 2026-09-17 refuses here: `kdelta` answers null and the strip draws no chip for it. A measured 0 on either night is a reading and still yields a delta. Pins: tests/dex-tests.js group '\u2205 HRVDex KPI deltas and heatmap coverage \u2014 an uncomputable delta is absent', where 7 of 21 legs red on the pre-fix source, which is every leg that source reaches."
  },
  {
    at: 'hrvdex-render.js:1336',
    state: 'fixed',
    note: "`_patPearson` answers `{ r, n }` and renderHeatmap bound only `res.r`, so a cell over 3 surviving pairs painted exactly like one over 40: same text, same saturation, same tooltip. A correlation stays defined over 3 pairs and the absence reduces COVERAGE without breaking continuity, so the owner ruling of 2026-09-17 annotates here: `_patCellTitle` carries the pair count into every cell tooltip, the diagonal included, and it reports an absent count as absent rather than as 0. The sibling scatter consumer already appended the same ' \u00b7 n ' form, and the card note now tells the reader each cell carries its count. Pins: tests/dex-tests.js group '\u2205 HRVDex KPI deltas and heatmap coverage \u2014 an uncomputable delta is absent', where 7 of 21 legs red on the pre-fix source, which is every leg that source reaches."
  },
  {
    at: 'hrvdex-profile.js:70',
    state: 'fixed',
    note: "`getProfile` substitutes a population age for an absent one with no marker, 35 at the cascade and 40 at the estimate, so the Uth-S\u00f8rensen VO\u2082 estimate could rest on an age nobody entered and still reach the shared DETECTED tier through `prefillFrom` (dex-profile.js:472), where another node resolves it as a measured fact. The age reaches the estimate through Tanaka ONLY: an entered HRmax that passes the plausibility guard replaces Tanaka, and the estimate then owes the age nothing. So `getProfile` reports `ageKnown` in both arms, and `_vo2RestsOnDefaultAge` answers true only when the age is unknown AND Tanaka supplied HRmax. The identity write then passes null, which `prefillFrom` already skips, and the VO\u2082 ground-truth field keeps its documented auto value, because that field is the second surface of the one row. Pins: tests/dex-tests.js group '\u2205 HRVDex profile \u2014 a VO\u2082 estimate over a default age is not written as a fact', where 7 of 13 legs red on the pre-fix source, which is every leg that source reaches."
  },
  {
    at: 'ppgdex-dsp.js:4672',
    state: 'fixed',
    note: 'a recording with no inertial stream published `motionRejectedPct` 0, the BEST value on the scale, over a gate that never ran; the rate is now null with `motionRejectedPctReason`, `analyzablePct` discounts an explicit 0, and every reader grades through `pctClsDown`. Plant: flip the refusal back to `: 0` and the PpgDex motion legs red.'
  },
  {
    at: 'ppgdex-dsp.js:960',
    state: 'fixed',
    note: '`let fs = 176` is gone; the rate starts null and `parsePPG` throws `no-sample-rate` when no ns delta and no host-stamp span yields one. Plant: restore a numeric seed and the refusal leg reds.'
  },
  {
    at: 'ppgdex-dsp.js:1075',
    state: 'fixed',
    note: 'the index/fs axis is reached only after that refusal, so its rate is measured from host stamps rather than assumed, and `quality.axisDrawn` declares the drawn axis out of band. Plant: remove the refusal and the same leg reds.'
  },
  {
    at: 'ppgdex-dsp.js:6193',
    state: 'fixed',
    note: 'the SignalFrame path refused `fs || 1` in PR 2921 — a 540-second recording read 95,039 seconds on a 1 Hz axis. Pinned by two legs of the PpgDex absence group.'
  },
  {
    at: 'ppgdex-dsp.js:6203',
    state: 'fixed',
    note: 'the same refusal covers `durSec`, which took `(n - 1) / (fs || 1)` from the same absent rate. Pinned beside the relSec leg.'
  },
  {
    at: 'ppgdex-dsp.js:3585',
    state: 'fixed',
    note: '`meanMotionIndex` averaged the WHOLE motion grid, so every cell with no ACC or GYRO sample entered as stillness and an inertial gap read as the best value on a lower-is-better scale. The mean now covers the `covCell` cells only, refuses with `meanMotionIndexReason` when no cell is covered, and rounds through `r2n` so the refusal survives the publish. Every reader grades through `pctClsDown` and prints an em dash. Plant: drop the `covCell` guard and 2 legs red; restore `r2` and a third reds; restore the raw ternary and 2 more red.'
  },
  {
    at: 'ppgdex-app.js:610',
    state: 'fixed',
    note: 'a null `magInterferencePct` printed `0%`, the cleanest possible field, over a magnetometer gate that examined no epoch. The producer refuses when `magKnown` is empty, and `magIntTxt` now prints an em dash and names the absent sample population. Plant: restore the `: 0` coercion and 2 text legs red.'
  },
  {
    at: 'ppgdex-app.js:1002',
    state: 'fixed',
    note: 'the node-export forwarded `motionRejectedPct` 0 from a gate that never ran. PR 5226 made the producer refuse with `motionRejectedPctReason`, and the export carries the cause beside the value. Pinned by the PpgDex motion-rejection group.'
  },
  {
    at: 'ppgdex-dsp.js:2389',
    state: 'fixed',
    note: 'the `n < 20` branch filled every second with SQI 1, the best possible trust, over a beat population too small to calibrate. It now publishes `nSqi` 0, `sqiMedian` null, `sqiSource` null, `calibrated` false and a reason naming the beat floor. Pinned by the leg asserting `calibrated === false` with `fewer than 20 beats` in the reason.'
  },
  {
    at: 'ppgdex-dsp.js:2737',
    state: 'fixed',
    note: 'an omit mask leaving under two intervals fell back to the whole record, so SDNN described a population the mask had excluded. `dispersionReason` now refuses the dispersion arm and publishes the surviving count beside it. Pinned by the leg reading `[out.dispersionReason, out.nDispersion]`.'
  },
  {
    at: 'ppgdex-dsp.js:2756',
    state: 'fixed',
    note: 'no clean adjacent pair fell back to every raw pair, so rMSSD and pNN50 described the intervals the clean mask had rejected. `beatPairReason` now refuses both, and an unmasked record still publishes both arms. Pinned by the leg reading `[out.dispersionReason, out.beatPairReason]`.'
  },
  {
    at: 'ppgdex-dsp.js:4246',
    state: 'fixed',
    note: 'the export published `magInterference` false for a window the magnetometer gate refused, which reads as a clean field. `magInterfAtSec` returns null with no magnetometer or under the sample floor, and the export guard reads `post.magInterf != null`. Pinned by three legs asserting null rather than false.'
  },
  {
    at: 'ppgdex-dsp.js:2146',
    state: 'accepted-with-reason',
    reason:
      '0 is the IDENTITY of this axis, not a fabricated stillness: `motFactor = 1 - min(1, mot)` makes `mot` 0 leave the per-beat quality untouched, so a recording with no inertial stream carries no motion axis at all. The absence travels out of band at every surface, through `motion.hasData`, `motionRejectedPctReason` and `motionCoveredAtSec`.'
  },
  {
    at: 'ppgdex-dsp.js:3396',
    state: 'accepted-with-reason',
    reason:
      '`motionAtSec` keeps a numeric contract deliberately: it runs on every beat in two hot loops and several callers compare it against a threshold, so a tri-state return would change every caller. The tri-state companion `motionCoveredAtSec` answers the coverage question beside it, and the comment above the function states the concession and names the companion.'
  },
  {
    at: 'cpapdex-edf.js:239',
    state: 'fixed',
    note: 'the reduce no longer absorbs a null: `cpapdex-edf.js` now throws `EDF: unreadable samples-per-record for signal N` before it, because that field is the STRIDE of every signal after it, so a 0 there shifted every later sample in every record. Plant: tests/dex-tests.js `an unreadable samples-per-record REFUSES the file` and the EEGDex reader leg `an unreadable samples-per-record field throws out of the ingest` (verified by reading the file 2026-11-18, Heron)'
  },
  {
    at: 'cpapdex-edf.js:260',
    state: 'fixed',
    note: 'the buffer allocation reads `sampPerRec[s2]` with no `|| 0`, under the geometry refusal added for cpapdex-edf.js:239. Plant: the same two legs — an absent field never reaches this line (verified by reading the file 2026-11-18, Heron)'
  },
  {
    at: 'cpapdex-edf.js:263',
    state: 'fixed',
    note: 'the rate reads `recDurSec > 0 ? spr / recDurSec : null`, and an UNREADABLE duration throws instead. The two absences split the way §∅ splits them: a field nobody could read refuses, and a duration of 0 is a measurement of "no periodic sampling", which publishes fs null. Plant: tests/dex-tests.js `an unreadable record duration REFUSES` and `and its fs is NULL — not 0` (verified by reading the file 2026-11-18, Heron)'
  },
  {
    at: 'cpapdex-edf.js:310',
    state: 'fixed',
    note: 'the `|| 1` denominator is gone: a signal whose calibration header is absent or degenerate reads `calibrated: false` and `_scale: null`, so it is never rescaled by a fabricated range. Plant: tests/dex-tests.js `a degenerate digital range marks THAT SIGNAL uncalibrated, and the file still parses` with its `control: it reports itself calibrated` (verified by reading the file 2026-11-18, Heron)'
  },
  {
    at: 'cpapdex-dsp.js:361',
    state: 'fixed',
    note: '`leakSqi` answers null for an unassessable seal instead of 1, so an unmeasured mask no longer reads as a perfect one. Plant: tests/dex-tests.js group `CPAPDex quality — ∅ an UNASSESSED mask seal is not a perfect one` (verified by reading the file 2026-11-18, Heron)'
  },
  {
    at: 'cpapdex-dsp.js:2184',
    state: 'fixed',
    note: '`parseStrSummary` reads the Mode sample through `_mode != null && isFinite(_mode)`, so a day whose sample sits past the end of the signal is null, not the CPAP that `Math.round(null)` produced. Plant: the same group, leg `the day whose mode sample is ABSENT is null` beside its APAP control (verified by reading the file 2026-11-18, Heron)'
  },
  {
    at: 'cpapdex-fusion.js:116',
    state: 'fixed',
    note: 'the per-event sqi falls back to `sqi2`, which is null when the session seal went unassessed, and the night mean averages the ASSESSED sessions only with `sqiSessions` beside it. Plant: the same group, legs `an event from an UNASSESSED session carries sqi null` and `the night averages the sessions it ASSESSED` (verified by reading the file 2026-11-18, Heron)'
  },
  {
    at: 'cpapdex-render.js:1139',
    state: 'fixed',
    note: 'fixed #5274: `cpapEventTimeline` sorts an unplaceable event LAST in arrival order, never to 1970. CPAPDex carries no `clock.js`, so this node cannot rebuild a date-less stamp. Plant: tests/dex-tests.js section 4 of the CPAPDex quality group, with the former key beside it as the anti-vacuity leg (2026-11-18, Heron)'
  },
  {
    at: 'ecgdex-dsp.js:5838',
    state: 'fixed',
    note: 'the ACC parser now states the rate it used: `accFsSource` reads `ms-delta` when the median stamp delta measured it, and `assumed` when under six rows carried a parseable stamp. It rides on the stream itself as `_accFsSource`, so it survives `planCompanionGraft`, which moves the array and not the scalars. The three consumers that spend the rate as a TIMEBASE refuse on `assumed`: `epochMotion`, `stampEpochPositions` with the new reason `acc-rate-assumed`, and `accAnalyze`, whose card `renderACCComparison` already hides on null. The loader line names the assumption instead of printing 4 Hz as a measurement. Measured over the corpus 2026-11-24: of 1958 `_ACC` files 1410 measure the rate, 510 fall under the 120-sample floor and were refused there already, 38 are empty, and NONE both clear the floor and lack stamps, so the refusal drops no night in hand. Plant: tests/dex-tests.js, the ECGDex device-twin block leg `parseDeviceACC states an assumed rate as assumed`, the three refusal legs, and an 800-row measured control that must still answer (2026-11-24, Heron)'
  },
  {
    at: 'ecgdex-dsp.js:5853',
    state: 'fixed',
    note: 'a stampless file no longer receives a synthesised per-sample axis at all. The synthesis now runs only on a measured rate and records that rate in `_relBaseSource`; an assumed rate leaves `tsMs` absent and names `_relBaseReason: acc-rate-assumed`. The branch was also unreachable for the file it serves: its test used the global `isFinite`, which is true for null, so a null-stamped row read as a measured 0. It now reads `Number.isFinite`, which also keeps absent stamps out of the rate median. Plant: the stampless twin in tests/dex-tests.js asserts no `_relBase` plus the named reason, and a first-row-only gap still rebuilds the axis under `ms-delta`.'
  },
  {
    at: 'ecgdex-dsp.js:2350',
    state: 'fixed',
    note: 'fixed #5157 (906193003): the ACC-to-ECG placement is a named function that returns `offSec: null` with its own reason when no measurement supports it, and `epochMotion` refuses on that null rather than aligning at 0 s. The `baseOffset … : 0` clamp this finding names is gone from the file. Hand-read against origin/main 2026-11-24 (Heron); not credited by content, and not credited to this PR.'
  },
  {
    at: 'ecgdex-dsp.js:2635',
    state: 'fixed',
    note: 'fixed #5088 (d7d7f0d0a): the gait fields initialise from `accPresent`, so `steps`, `briskPct` and `cadencePresentPct` are null when the record carried no usable ACC and 0 only when a stream was there to measure. `sustainedGait`, both sub-scores and `ambulatory` all guard on `!= null`. Hand-read against origin/main 2026-11-24 (Heron); not credited by content, and not credited to this PR.'
  },
  {
    at: 'ecgdex-dsp.js:2231',
    state: 'fixed',
    note: 'fixed #3043 (7e224760e): `detectCVHR` now takes the `spansGap` mask the beat builder already writes, and `hrSeries[s]` is null for every second inside a dropout, with `coveredSec` and `excludedSec` beside it. The held value stays in the internal `hr` grid on purpose, because a null there poisons every moving-average window that reads it; the fabrication is contained instead of spread. Plant: tests/dex-tests.js, the CVHR hole group, legs `WITHOUT the mask every second is a number`, `WITH the mask the dropout is absent from the exported series` and `coveredSec accounts for exactly the seconds that are not null`, each with its own anti-vacuity leg. Hand-read against origin/main 2026-11-24 (Heron); not credited by content, and not credited to this PR.'
  },
  {
    at: 'ecgdex-dsp.js:3576',
    state: 'fixed',
    note: 'fixed #2984 (271768288): `validateHR` no longer forward-fills the device series. An uncovered second stays NaN, `_rollMedian` skips it, the pairing guard drops it, and the report publishes `devMeasuredSec`, `comparableSec` and `coverage`, so a half-absent night cannot read as a covered one. Plant: tests/dex-tests.js section 8b of the ECGDex device-twin block, where a device that stops at 290 s of a 600 s record contributes no pairs from the silent stretch, and the leg states the 44 percent error dilution the hold used to produce. Hand-read against origin/main 2026-11-24 (Heron); not credited by content, and not credited to this PR.'
  },
  {
    at: 'ecgdex-dsp.js:4964',
    state: 'fixed',
    note: 'the text parser has labelled the rate since #2962 (aacb85ffb) as `ns-counter`, `ms-step`, `ms-delta` or `assumed`, and THIS PR carries that label to a reader. The reshape in `analyze` dropped `fsSource`, so no export and no cell held it, and an assumed 130 still reached every consumer as the same number a measured file yields. `analyze` now forwards `fsSource` the way it forwards `fsRaw`, and the signal-quality clock cell publishes it beside `fs` and `fsRaw`. Plant: tests/dex-tests.js, the fs-provenance group, leg `the published clock cell says the rate was ASSUMED` with a measured `ns-counter` control beside it. Both legs red on origin/main (measured 2026-11-24, Heron).'
  },
  {
    at: 'ecgdex-dsp.js:6484',
    state: 'fixed',
    note: 'the canonical-frame branch of `compute` has labelled an fs-less frame `assumed`, and a frame that carried a rate `caller`, since #2962 (aacb85ffb). That label reached no surface until THIS PR: `compute` returns the node export, and `rec.fsSource` never entered it, so the frame path published no provenance a consumer could read and the finding was not plantable at all. The carry in `analyze` plus the clock cell makes both arms observable. Plant: tests/dex-tests.js, the fs-provenance group, leg `a frame that carried NO rate is labelled assumed` beside the `caller` control. Both legs red on origin/main (measured 2026-11-24, Heron).'
  },
  {
    at: 'ecgdex-morph.js:44',
    state: 'fixed',
    note: '`localMedRR` fell back to `rr[k] || 900` when no neighbour inside plus-or-minus 8 beats carried a plausible RR. `rr[k]` makes `prem = rr[k] / lm` exactly 1.0, which asserts the beat is on time; 900 asserts a 67 bpm neighbourhood nothing measured. The caller now reads `null` and types the beat `U`.'
  },
  {
    at: 'ecgdex-morph.js:102',
    state: 'fixed',
    note: 'an empty template accumulator was divided by `nAcc || 1`, so a record where no beat cleared the 0.6 SQI gate correlated every beat against a flat line. `std` then fell back to its own `|| 1` and every correlation came out arithmetic. `haveTmpl` now carries the absence to `corr` and to `template`, and `corrMeasured` publishes the count.'
  },
  {
    at: 'ecgdex-morph.js:113',
    state: 'fixed',
    note: 'a beat within plus-or-minus 70 ms of either record edge has no window to correlate, and the loop wrote `corr[k] = 1` — the most reassuring value in the range. `lowCorr` then read false, so a PVC on that beat was out of reach. A plain array now holds the `null` a `Float32Array` cannot.'
  },
  {
    at: 'ecgdex-morph.js:136',
    state: 'fixed',
    note: 'hand-read 2026-11-24: already fixed on main. A beat under the 0.55 SQI gate is typed `U`, and `beatsAssessed` plus `beatsUnassessed` publish the coverage. The burdens divide by the assessed count and read `null` when nothing was assessable.'
  },
  {
    at: 'ecgdex-morph.js:191',
    state: 'fixed',
    note: 'the 30-200 ms width filter can reject every beat, and `median([])` answers 0. That 0 published as `medW: 0` — a measured QRS width the app renders in prose and in `medianQRSWidthMs` — and it also made `wide` read true for every beat. `medW` is now `null` and `widthsPlausible` publishes what the median rests on.'
  },
  {
    at: 'ecgdex-morph.js:656',
    state: 'fixed',
    note: 'hand-read 2026-11-24: already fixed on main. `afScreen` returns `verdict: insufficient` with every metric `null` when no window held enough usable beats, so a scoreless screen never reads as `no-af`.'
  },
  {
    at: 'ecgdex-app.js:1611',
    state: 'fixed',
    note: 'hand-read 2026-11-24 (Heron): already fixed on main. `_welltoryRowFor` writes an EMPTY Date cell over an absent `t0Ms`, and its own comment states why 0 is not a refusal. The 1970-01-01 stamp the survey read is gone, and `num()` already emitted the empty string for every absent number beside it. Not credited to this PR.'
  },
  {
    at: 'ecgdex-app.js:1643',
    state: 'fixed',
    note: 'hand-read 2026-11-24 (Heron): already fixed on main. `exportRR` writes an EMPTY Phone timestamp over an absent `t0Ms`, which is the shape the PulseDex handoff parser reads, so the filename no longer contradicts the rows inside it. Not credited to this PR.'
  },
  {
    at: 'ecgdex-profile.js:254',
    state: 'fixed',
    note: 'THIS PR. `altVO2Factor` answered 1 over an absent elevation, because `null <= 1500` coerces the null to 0, so the record published `altitudeFactor: 1`, the node-export republished it, and the full-metrics row appended nothing. The factor now answers null for an absent or non-finite elevation, the VO2 math still applies a neutral 1 (reduced coverage annotates), and the row names the absence. The legacy DOM path read an empty elevation box as 0 m and answers null too. Plant: tests/dex-tests.js, group `an elevation nobody entered publishes no altitude factor`. Two legs red on origin/main (measured 2026-11-24, Heron).'
  },
  {
    at: 'ecgdex-profile.js:71',
    state: 'accepted-with-reason',
    reason:
      'hand-read 2026-11-24 (Heron): the priors age 42, 80 kg and 178 cm are what COMPUTE runs on, and `getProfile` carries `_origins` beside them, so no reader takes a prior for an entered value. `ageEnteredIn` gates every age-relative surface, and `renderHero` says `No age entered, so this card shows no age-relative HRV comparison` rather than grading against 42. The group `ECGDex grades against the age entered, not the population prior behind it` pins both halves. The substitution stays; the claim does not.'
  },
  {
    at: 'ecgdex-dsp.js:2111',
    state: 'fixed',
    note: 'THIS PR. The RSA efficiency ratio answered a flat 1.00 whenever the expiratory HR floor was not positive, and an absent mean HR took the same branch because `mean` over a non-finite series is not finite. Both 1.00 and 0 bpm are legal measured values, so no reader could separate a record with no RSA from one nothing measured. The ratio and the amplitude now answer null under two named reasons, and `couplingStrength` refuses rather than publishing the RSA half alone under the coupling name. The app KPI, the gang pill, the swing pill, both severity cells and the full-metrics row read the null. Plant: tests/dex-tests.js, group `ECGDex ∅ — a fabricated rate, a defaulted RSA ratio and a defaulted correlation`, legs B. Five legs red on origin/main (measured 2026-11-24, Heron).'
  },
  {
    at: 'ecgdex-dsp.js:4453',
    state: 'fixed',
    note: 'THIS PR. The RRacc-vs-EDR correlation answered a literal 0 whenever either side carried zero variance, and 0 is a legal r: the two rates do not track each other. The app card read that 0 for its strong and moderate verdicts and printed it as a Pearson r. The correlation now answers null beside `rReason`, the card prints an em dash with the reason under the limits of agreement, and the narrow-LOA note no longer fires on a null that coerces below 0.65. Plant: tests/dex-tests.js, group `ECGDex ∅ — a fabricated rate, a defaulted RSA ratio and a defaulted correlation`, legs C. Two legs red on origin/main (measured 2026-11-24, Heron).'
  },
  {
    at: 'ecgdex-dsp.js:5568',
    state: 'fixed',
    note: 'THIS PR. `ecgCoverage` wrote the H10 nominal 130 Hz over a rec that reached it with no rate. The fallback branch converts sample counts to ms, so the segment EDGES came out fabricated, and `integrator-dsp.js` extends its envelope from exactly those edges. Fabricated edges are a discontinuity, not reduced coverage, so the fallback now refuses under the owner ruling of 2026-09-17. The exact branch never reads the rate and stays as it was. Plant: tests/dex-tests.js, group `ECGDex ∅ — a fabricated rate, a defaulted RSA ratio and a defaulted correlation`, legs A. Two legs red on origin/main (measured 2026-11-24, Heron).'
  },
  {
    at: 'ecgdex-dsp.js:2827',
    state: 'accepted-with-reason',
    reason:
      'hand-read 2026-11-24 (Heron): `beatConfidence` empties its map only when the peak series spans under one second, which `detectPeaks` cannot produce, so `analyze` never reads the `: 1` arm. Measured over `genSynthetic` at 120 s and at 300 s: every published `nnConf` entry comes from a scored second, and the fix changed nothing. The uncalibrated arms FILL the map with explicit 1s and publish `calibrated`, `axis` and `reason` as own properties on it, which is the out-of-band channel §∅ asks for. Trust 1 stays the admission weight for a beat nobody examined, the ruling the sibling `_maskedBeats` site already states. Carrying that calibration verdict into the record and the export is a separate unit, because it moves the node-export shape.'
  },
  {
    at: 'ppgdex-dsp.js:4499',
    state: 'fixed',
    note: 'THIS PR. `beatConfidence` keys each beat through `secAbs` over the pseudo-sample indices `analyze` hands it, so a key reads `floor((t0 + (round(sec*fs)/fs)*1000) / 1000)`. The reader spelled the same second from the UNROUNDED `sec`, and the two spellings differ by up to 500/fs ms. A beat inside that margin of a second boundary asked for a key the map never wrote, and the miss published 1, the TOP of the trust scale, for a beat the statistic never weighed. `ppiConfReason` and `ppiConfCue` both describe the whole map, so no field beside the element carried its state. The reader now derives the key the way the map wrote it, and a key the map does not carry answers null. A crossing needs `t0Ms % 1000 !== 0`, because with an integer `fs` and a t0 on the second the boundary falls on a sample index. Measured: ZERO crossings over six inputs, one real Verity stream plus the five committed synthetics, 521 corrected beats, so the defect is latent and the corpus holds no instance. Plant: tests/dex-tests.js, group `PpgDex ∅ — the per-beat trust reader spells the second the way the map wrote it`. Three of ten legs red on origin/main (measured 2026-11-24, Heron).'
  },
  {
    at: 'ppgdex-dsp.js:4449',
    state: 'fixed',
    note: '`ppiAgreement` answers null when either spine yields no usable median, landed by #5168 at 6426563f4. Hand-read 2026-11-24 (Heron) against origin/main: the ternary reads `: null` at ppgdex-dsp.js:6502, the export guards it as `ppiAgreement == null ? null : Math.round(100 * ppiAgreement)` at :7402, and ppgdex-app.js:638 draws the KPI only when `r.ppiAgreementPct != null`. Read by content, never by a snippet match.'
  },
  {
    at: 'ppgdex-dsp.js:4674',
    state: 'fixed',
    note: '`correctionRate` answers null over an empty interval series, landed by #5168 at 6426563f4. Hand-read 2026-11-24 (Heron) against origin/main: the ternary reads `: null` at ppgdex-dsp.js:6895, and ppgdex-app.js:622-624 renders an em dash with a neutral band and the sub-label `no intervals`. The ARBITER keeps its 100 sentinel deliberately, which the comment at :6484 states. Read by content, never by a snippet match.'
  },
  {
    at: 'ppgdex-dsp.js:6267',
    state: 'fixed',
    note: 'The re-ingest event sort no longer coerces an absent `tMs` to 0, landed by #5574. Hand-read 2026-11-24 (Heron) against origin/main: ppgdex-dsp.js:9058 calls `DexClock.sortEventsByClock(json.ganglior_events, _evAnchor(json))`, and the consumer `ppgReviewTimeline` at ppgdex-app.js:1686 calls the same shared key, which sorts an unplaceable event last. Both halves of the row are closed. Read by content, never by a snippet match.'
  },
  {
    at: 'cpapdex-cross.js:648',
    state: 'fixed',
    note: '`compareChannel` took `a.fs || b.fs || 1`, so a 1 Hz rate nobody measured converted every sample count the comparator reports into time: `endMs`, `ai0`, `bi0`, `overlapN`, the fine lag, the ~10-min window `fs * 600`, and the published `overlapMin`, `appliedLagSec` and `scaleOverTime[].startMin`. The rate now reads `Number.isFinite(x) && x > 0` on either side and refuses when neither header carries one. A measured rate on ONE side still compares, so the refusal is narrow. Plant: tests/dex-tests.js, group `CPAPDex ∅ — the comparator refuses an unmeasured rate and an absent start stamp`. Eight of twelve legs red on origin/main (measured 2026-11-24, Heron).'
  },
  {
    at: 'cpapdex-cross.js:650',
    state: 'fixed',
    note: '`compareChannel` took `(a.t0Ms || 0) - (b.t0Ms || 0)` for `clockOffsetSec`, which is the headline FINDING of this comparator. An absent start stamp on one side therefore manufactured a disagreement against epoch 0, and the overlap refusal below worded it as an EdfSink UTC-vs-local-civil clock defect, a borrowed reason for a different cause. Absent on BOTH sides it read a perfect 0 s agreement instead and compared on. The comparator now refuses, publishes `clockOffsetSec: null` and names which side carries no stamp. The `|| 0` coercions at the overlap window and at `ai0`/`bi0` are gone, so the refusal is the only path. Same plant group as the rate row.'
  },
  {
    at: 'cpapdex-coimport.js:216',
    state: 'fixed',
    note: 'The peer overlap share refused an unmeasured end. normalizeOxy and normalizeEcg write endMs null when the export carried no duration, and substituting t0Ms made the peer a zero-length point, so _overlapPct published a measured-looking 0 percent. crossNode worded that as shares 0 percent of this night and cpapdex-render.js printed 0 percent overlap. Both consumers already carried the honest null branch. Plant group CPAPDex co-import so a peer whose end was never measured reports no overlap. Three of eight legs red on origin/main (measured 2026-11-24, Heron).'
  },
  {
    at: 'cpapdex-coimport.js:198',
    state: 'accepted-with-reason',
    reason:
      'The same substitution inside _bestOverlap feeds only an internal pairing score. An absent endMs makes the candidate a point, so it can never score positive overlap and falls to the gap branch, where the gap is its true start distance. A peer with a measured overlapping span always outscores it, and the score never leaves the function. The published span comes from _overlapPct, which now refuses an unmeasured end. Read 2026-11-24 by Heron.'
  },
  {
    at: 'oxydex-app.js:266',
    state: 'fixed',
    note: 'The night-summary CSV now declares its coverage. exportCSV printed Duration (min) as the SPAN, while every rate below it, the T-index percentages and both ODI rates and the hypoxic burden, is over the MEASURED seconds. The file named no coverage anywhere. A conditional block now prints Coverage and Recorded (min) and Span (min) and Recorded Segments from recording.coverage, which is non-null only when coverageFromSegments merged two or more segments, so a contiguous night exports unchanged. Plant group OxyDex CSV so a night with a hole declares its coverage. Ten of twelve legs red on origin/main ac70318c9 (measured 2026-11-24, Heron).'
  },
  {
    at: 'oxydex-app.js:284',
    state: 'fixed',
    note: 'BOOKKEEPING. Already fixed on main and hand-read 2026-11-24 by Heron against origin/main ac70318c9. The T-INDEX row no longer writes _td.pct or 0; it writes csvNum(_td.pct) and routes the seconds through a measured flag. tests/dex-tests.js already carries the leg under SITE 1, the exportCSV T-INDEX row. Read by content, never by a snippet match.'
  },
  {
    at: 'ecgdex-render.js:507',
    state: 'fixed',
    note: 'The hypnogram now paints one epoch per epoch. epochEngine refuses a window for a clock seam or a blanking run or too few beats, then continues without pushing it, so the epoch list carries holes. The renderer drew each band to the minute of the NEXT epoch, so one measured 5 min epoch painted its stage across every refused epoch behind it, and the stepped line walked over the gap. Each band now ends one epoch after it starts, the pen lifts onto a non-abutting epoch, and ecgdex-app.js names the 300 s staging grid at the call. hypno-export.js already leaves a refused window null, so only the render path manufactured the stage. Plant group the hypnogram paints one epoch per epoch. Five of thirteen legs red on origin/main b459f6896 (measured 2026-11-24, Heron).'
  },
  {
    at: 'ecgdex-dsp.js:48',
    state: 'fixed',
    note: 'BOOKKEEPING. Already fixed on main and hand-read 2026-11-24 by Heron against origin/main b459f6896. rmssd returns null for an empty successive-difference population, never 0. The consumer carries it: the ecgdex-app.js HRV table prints an em dash with the reason No successive pair was measured. Read by content, never by a snippet match.'
  },
  {
    at: 'ecgdex-dsp.js:89',
    state: 'fixed',
    note: 'BOOKKEEPING. Already fixed on main and hand-read 2026-11-24 by Heron against origin/main b459f6896. pnn50 returns null when the denominator population is empty, never 0. The ecgdex-app.js HRV table prints an em dash with the reason No successive pair entered the population. Read by content, never by a snippet match.'
  },
  {
    at: 'ecgdex-dsp.js:2105',
    state: 'fixed',
    note: 'BOOKKEEPING. Already fixed on main and hand-read 2026-11-24 by Heron against origin/main b459f6896. The PLV mean returns null when no 60 s window fitted the grid, and a plvReason string names the absence beside it. Both ecgdex-app.js consumers read crcPLV == null as neutral rather than as a low score. Read by content, never by a snippet match.'
  },
  {
    at: 'ecgdex-dsp.js:2538',
    state: 'fixed',
    note: 'BOOKKEEPING. Already fixed on main and hand-read 2026-11-24 by Heron against origin/main b459f6896. The per-instant SQI returns null when no beat sits inside the window and the nearest-beat SQI is itself absent. The in-band 0.5 sentinel survives only inside the section-absence comment that documents it. Read by content, never by a snippet match.'
  },
  {
    at: 'ecgdex-dsp.js:3325',
    state: 'fixed',
    note: 'BOOKKEEPING. Already fixed on main and hand-read 2026-11-24 by Heron against origin/main b459f6896. The Malik correction of the device series keeps the measured value and flags it, rather than writing a hardcoded 1000 ms where the plus or minus 5 beat neighbourhood held nothing. validateRR also refuses an all-absent device series instead of publishing a panel of zeros. Read by content, never by a snippet match.'
  },
  {
    at: 'ecgdex-registry.js:507',
    state: 'accepted-with-reason',
    reason:
      'The fabricated experimental disc STAYS. A label with no registry entry must fail VISIBLY, and that is the ratified forcing function for badge coverage (owner, 2026-08-16), so the remedy is the label population rather than the fallback. Heron measured the population on 2026-11-24 over the four ECGDex surfaces: 113 labels, ONE fallthrough. That one was Intervals (QRS/QT/PR), the withheld-notice row that stands in for three interval metrics when no median beat was built and carries no number at all. It now sits in _META_DENY, so the row prints its reason with no disc. A new group in tests/dex-tests.js harvests the population on every run and reds on the next fallthrough.'
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
      'enough to verify. See audits/COUNTING-ZERO-POPULATION-SURVEY-2026-09-29.md.',
      '',
      'EVERY STATE HERE IS A STATE ABOUT A PRODUCING LINE. A consumer that reads the same absent value as',
      'a number is not a finding, carries no key and gets no state, so a `fixed` row says nothing about it.',
      'consumerCensus below counts the consumer sites the survey ITSELF named, which is the only part of',
      'that population this file can state.'
    ],
    source: 'audits/ABSENCE-SURVEY-2026-09-22.json',
    states: STATES,
    counts: { findings: entries.length, ...tally },
    /* The consumer side, which the states above do not cover. Derived from the survey only, so this
       stays pure and the byte-identity gate keeps covering it. */
    consumerCensus: consumerCensus(survey.confirmed),
    entries
  };
}

const render = (o) => `${JSON.stringify(o, null, 1)}\n`;

/** The ONE verdict this tool emits. Pure given its inputs, so the selftest exercises the real shape.
 *  `ceiling` is the committed ratchet number; `built` is the rebuilt state; `identical` says whether the
 *  committed state file matched that rebuild. Every finding is examined to decide whether it is open, so
 *  the population is all of them — the open count is the RESULT, not the population.
 *
 *  THE POPULATION IS PRODUCING LINES. It is every finding and no consumer, because a consumer of an
 *  absent value is not a finding and has no key to hold a state. `result.consumer` carries the census so
 *  that a reader of `open: 0` cannot take the producer drain for the class being drained. */
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
    result:
      status === 'UNKNOWN'
        ? null
        : {
            open,
            ceiling,
            fixed: built.counts.fixed,
            accepted: built.counts['accepted-with-reason'],
            /* OUTSIDE the population above, and reported for exactly that reason. */
            consumer: built.consumerCensus ?? null
          },
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

  /* 9 · THE CONSUMER CENSUS. The arithmetic closes, the two readers behave, a site named twice is one
   *     site, and a finding whose prose names no line is reported apart from a zero. */
  ok(repoRelative('~/wt-x/capture-host/night_report.py') === 'capture-host/night_report.py', 'a home-rooted path reduces to the repo path');
  ok(repoRelative('/elsewhere/vendor/thing.py') === 'thing.py', 'a path rooted outside the repo keeps only its basename');
  ok(repoRelative('oxydex-dsp.js') === 'oxydex-dsp.js', 'a bare root file is already repo-relative');
  const siteOne = consumerSitesOf({ file: 'a.js', consumer: 'read at tools/b.mjs:42' });
  ok(siteOne.fromPath.length === 1 && siteOne.fromPath[0] === 'tools/b.mjs:42', 'a path:line in the prose is one site');
  ok(siteOne.fromBareLine.length === 0, 'a path:line is not also counted as a bare line');
  const siteBare = consumerSitesOf({ file: 'a.js', consumer: 'stability() line 898 publishes it' });
  ok(siteBare.fromPath.length === 0 && siteBare.fromBareLine[0] === 'a.js:898', "a bare line ref resolves against the finding's own file");
  ok(consumerSitesOf({ file: 'a.js', consumer: 'folded into the published summary' }).fromPath.length === 0, 'prose naming no line yields no site');
  const cen = consumerCensus([
    { file: 'a.js', line: 1, consumer: 'read at b.js:9' },
    { file: 'c.js', line: 2, consumer: 'also read at b.js:9' },
    { file: 'd.js', line: 3, consumer: 'folded into the summary' },
    { file: 'e.js', line: 4, consumer: 'read at a.js:1' },
    { file: 'f.js', line: 5, consumer: 'read at b.js:9 and again at line 77' },
    { file: 'g.js', line: 6, consumer: 'published at line 12' }
  ]);
  ok(cen.sites === 4, 'one site named by two findings is counted once');
  ok(cen.findingsNamingNoSite === 1, 'a finding naming no site is counted apart');
  ok(cen.findingsNamingASite === 5, 'the two halves of the finding population add up');
  ok(cen.findingsNamingASiteByPath === 4 && cen.findingsNamingASiteByBareLineOnly === 1, 'a finding naming both a path and a bare line lands in the path arm alone');
  ok(cen.findingsNamingASiteByPath + cen.findingsNamingASiteByBareLineOnly + cen.findingsNamingNoSite === cen.findings, 'the three reader arms partition the findings');
  ok(cen.sitesWithRow === 1 && cen.sitesWithoutRow === 3, 'a consumer site that is itself a finding is told from one that is not');
  /* THE BASENAME ARM IS NOT COVERAGE (row
     `2026-11-08-the-absence-census-basename-arm-can-count-a-foreign-site-as-covered`). Two files of one
     name in two directories agree on basename and line, and the agreement identifies nothing. */
  const cenCollide = consumerCensus([{ file: 'tools/a.js', line: 1, consumer: 'read at other/a.js:1' }]);
  ok(cenCollide.sites === 1 && cenCollide.sitesWithRow === 0, 'a site matching a row only by basename is not coverage');
  ok(cenCollide.sitesMatchingARowByBasenameOnly === 1, '…and the census names that ambiguous arm instead of hiding it');
  ok(cenCollide.sitesWithRow + cenCollide.sitesWithoutRow === cenCollide.sites, '…and the two published halves still add up');
  /* CONTROL · the same basename at its real path still reads as coverage, so the leg above tests the
     collision and not the matcher. */
  const cenExact = consumerCensus([{ file: 'tools/a.js', line: 1, consumer: 'read at tools/a.js:1' }]);
  ok(cenExact.sitesWithRow === 1 && cenExact.sitesMatchingARowByBasenameOnly === 0, 'control · an exact repo-relative match is coverage');
  const real = built.consumerCensus;
  ok(real.findings === built.counts.findings, 'the census population is every finding');
  ok(real.findingsNamingASite + real.findingsNamingNoSite === real.findings, 'every finding is either naming a site or counted apart');
  ok(real.sitesWithRow + real.sitesWithoutRow === real.sites, 'every named site is told to carry a row or not');
  ok(
    real.findingsNamingASiteByPath + real.findingsNamingASiteByBareLineOnly + real.findingsNamingNoSite === real.findings,
    'the committed census partitions every finding across its three reader arms'
  );
  ok(real.sitesWithoutRow > 0, 'the committed survey names consumer sites that carry no row — the reason this census exists');
  ok(real.sitesMatchingARowByBasenameOnly <= real.sitesWithoutRow, 'the ambiguous arm is a subset of the uncovered sites, never a third bucket beside them');
  const rvFull = ratchetVerdictObject({ ceiling: n, built, identical: true });
  /* Null-safe on purpose: a census dropped out of the verdict must FAIL this leg, not crash it. */
  ok(rvFull.result.consumer?.sites === real.sites, 'the verdict publishes the census beside its producer population');
  ok(rvFull.population.checked === real.findings, 'the verdict population counts producers, not the census sites');

  if (fail.length) {
    console.error(`✗ absence-ledger selftest: ${fail.length} failed`);
    for (const f of fail) console.error(`    ${f}`);
    return 1;
  }
  console.log(`  absence-ledger: ${built.counts.findings} findings — ${built.counts.fixed} fixed · ` + `${built.counts['accepted-with-reason']} accepted · ${built.counts.open} open`);
  console.log(`  consumer census: ${built.consumerCensus.sites} sites named, ${built.consumerCensus.sitesWithoutRow} of them with no row`);
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
      const cc = b.consumerCensus;
      console.log(
        `    consumer sites named by the survey and held by nothing: ${cc.sitesWithoutRow} of ${cc.sites} sites` +
          ` (${cc.sitesWithRow} are themselves a finding; ${cc.findingsNamingNoSite} findings name no line)`
      );
      console.log(JSON.stringify(v));
    }
    return v.status === 'PASS' ? 0 : 1;
  }
  const built = render(build(JSON.parse(readFileSync(SURVEY, 'utf8'))));
  if (argv.includes('--write')) {
    /* The ledger belongs to the checkout this run was LAUNCHED IN, not to the one this file lives in.
       `writeRootOrDie` refuses on a disagreement and names both trees. */
    const dest = join(writeRootOrDie(import.meta.url), ...LEDGER_REL);
    writeFileSync(dest, built, 'utf8');
    console.log(`wrote ${dest}`);
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

if (isCliEntry(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
