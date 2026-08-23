/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * acc-shared-movement.mjs — EXTERNAL-METHODS-SURVEY §3's question, in our own units.
 *
 * §3: Brønd et al. (2021) align two accelerometers with no human interaction, validated on
 * wrist/hip and thigh/hip and applied to 2513 free-living recordings. Ours is CHEST vs UPPER ARM.
 * The brief's own instruction is to answer ONE question before implementing anything:
 *
 *   > their pairs simply share more signal, in which case it does not transfer at all
 *
 * We cannot run their data. What we CAN measure is how much movement our pair actually shares, and
 * `alignByAnchors` already separates the two halves of that:
 *
 *   candidates — movements found in the CHEST envelope at all
 *   anchors    — those the ARM corroborated well enough to yield a lag
 *
 * and the ratio is the discriminator §3 needs:
 *
 *   many candidates, few anchors  ⇒ the chest moves and the arm does not corroborate. The PAIR is
 *                                   signal-poor, their trunk pairs are not, and no algorithm closes
 *                                   that gap — the method does not transfer.
 *   few candidates                ⇒ the subject did not move. A COVERAGE limit, equally immune to
 *                                   a better algorithm.
 *   many of both on failing nights ⇒ neither; the method question stays open and §3 should proceed.
 *
 * ⚠️ THIS TOOL CANNOT SAY BRØND'S METHOD WOULD FAIL. It measures the input their method would get.
 * A shared-movement floor is a property of the wear sites, so it bounds ANY alignment method
 * including theirs — but "our pair is poorer" is an inference from their reported wear locations,
 * not a measurement of their data, and the brief must not record it as one.
 *
 * ACC ONLY — no beat pipeline, so this is cheap next to `pat-fiducial-compare.mjs`.
 *
 * Usage:  node tools/acc-shared-movement.mjs --dir <corpus> [--only YYYY-MM-DD]
 *         node tools/acc-shared-movement.mjs --selftest
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDsps, loadDsps, median, quantile } from './pat-matchrate-strict.mjs';

const argv = process.argv.slice(2);
const av = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};

/* The filename's YYYYMMDDHHMMSS, so candidate ACC files are shortlisted without parsing 339 MB to
   find out they do not overlap — `pat-matchrate-strict.mjs`'s lesson, same reason. */
function nameStartMs(f) {
  const m = /_(\d{14})_/.exec(f);
  if (!m) return null;
  const s = m[1];
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
}

function biggestAcc(dir, re, n) {
  return readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => ({ f: join(dir, f), size: statSync(join(dir, f)).size, start: nameStartMs(f) }))
    .sort((a, b) => b.size - a.size)
    .slice(0, n);
}

function loadAll(cand, PPGDSP) {
  const out = [];
  for (const c of cand) {
    let s;
    try {
      s = PPGDSP.parseSensorXYZ(readFileSync(c.f, 'utf8'));
    } catch {
      continue;
    }
    if (s?.length && s[0].tMs != null) out.push(s);
  }
  return out;
}

export function nightSharedMovement(dir, sigmas) {
  const { PPGDSP, PATAlign } = getDsps();
  const As = loadAll(biggestAcc(dir, /H10.*_ACC\.txt$/i, 3), PPGDSP); // chest
  const Bs = loadAll(biggestAcc(dir, /verity.*_ACC\.txt$/i, 3), PPGDSP); // arm
  if (!As.length || !Bs.length) return { skipped: `no parseable ACC on ${!As.length ? 'H10' : 'Verity'}` };
  /* 🔴 CHOOSE THE PAIR BY OVERLAP, NEVER EACH DEVICE'S LARGEST INDEPENDENTLY. A night is dozens of
     fragments per device, and the biggest fragment of each is routinely a DIFFERENT part of the
     night — so taking each device's largest and intersecting them reports "the two ACC recordings
     do not overlap" on a night with hours of overlap available one fragment down the list.
     `pat-matchrate-strict.mjs` carries this warning verbatim ("Prefilter ACC candidates by TIME,
     not size") and the first version of this tool walked into it anyway: 13 of 38 nights excluded,
     which would have been recorded as a fact about the corpus. Reading a warning is not the same as
     being protected by it — so the selection is now over PAIRS, which cannot express the bug. */
  let A = null;
  let B = null;
  let bestOv = 0;
  for (const a of As)
    for (const b of Bs) {
      const ov = Math.min(a[a.length - 1].tMs, b[b.length - 1].tMs) - Math.max(a[0].tMs, b[0].tMs);
      if (ov > bestOv) {
        bestOv = ov;
        A = a;
        B = b;
      }
    }
  if (!A) return { skipped: 'no ACC fragment pair overlaps at all' };
  const t0 = Math.max(A[0].tMs, B[0].tMs);
  const t1 = Math.min(A[A.length - 1].tMs, B[B.length - 1].tMs);
  if (!(t1 > t0)) return { skipped: 'the two ACC recordings do not overlap' };
  const eA = PATAlign.envelope(A, t0, t1, {});
  const eB = PATAlign.envelope(B, t0, t1, {});
  if (!eA || !eB) return { skipped: 'envelope failed' };
  /* The sweep reuses ONE parse and ONE envelope pair across every sigma — the parse is the whole
     cost here (a night's Verity ACC is ~339 MB), and re-parsing per step would also risk the two
     steps disagreeing about which fragments the night has, which is FOLLOWUPS §2's open defect. */
  if (sigmas) return { overlapH: +((t1 - t0) / 3600000).toFixed(2), sweep: sigmas.map((k) => ({ sigma: k, ...score(PATAlign.alignByAnchors(eA, eB, t0, { anchorSigma: k }), t1 - t0) })) };
  const r = PATAlign.alignByAnchors(eA, eB, t0, {});
  return {
    overlapH: +((t1 - t0) / 3600000).toFixed(2),
    ...score(r, t1 - t0)
  };
}

function score(r, spanMs) {
  const nAnchors = r.anchors ? r.anchors.length : 0;
  const corrs = (r.anchors || []).map((a) => a.corr).filter(Number.isFinite);
  return {
    /* CANDIDATES is chest movement; ANCHORS is chest movement the ARM corroborated. The ratio is
       the whole point — reporting anchors alone cannot tell a still night from an uncorroborated
       one, and those two have opposite implications for §3. */
    candidates: r.candidates ?? null,
    anchors: nAnchors,
    corroborated: r.candidates ? +(nAnchors / r.candidates).toFixed(3) : null,
    candidatesPerHour: r.candidates ? +(r.candidates / (spanMs / 3600000)).toFixed(1) : null,
    ok: !!r.ok,
    reason: r.ok ? null : r.reason,
    medianCorr: corrs.length ? +median(corrs).toFixed(3) : null,
    offsetRangeMs: r.offsetRangeMs ?? null
  };
}

function selftest() {
  let fail = 0;
  const ok = (n, c, d) => {
    console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
    if (!c) fail++;
  };
  loadDsps();
  const { PATAlign } = getDsps();

  /* Two synthetic ACC streams sharing planted movement bursts. The point of the control is that the
     tool must DISTINGUISH the two failure modes it exists to distinguish — so one leg shares the
     bursts and one has bursts on A only, and they must not report the same thing. A run where both
     legs agree would be the "examined nothing" failure, dressed as a passing test. */
  const mk = (tms, bursts, jitterSeed) => {
    const out = [];
    for (let i = 0; i < 12000; i++) {
      const t = tms + i * 20;
      let a = 0;
      for (const b of bursts) if (Math.abs(i - b) < 12) a = 400 * (1 - Math.abs(i - b) / 12);
      const n = (((i * 2654435761 + jitterSeed) >>> 0) % 17) - 8;
      out.push({ tMs: t, x: a + n, y: n, z: 1000 + n });
    }
    return out;
  };
  const T0 = Date.UTC(2026, 7, 20, 23, 0, 0);
  const bursts = [500, 1400, 2600, 3900, 5200, 6800, 8100, 9500, 10800];
  const shared = (() => {
    const A = mk(T0, bursts, 1);
    const B = mk(T0, bursts, 99);
    const t1 = T0 + 12000 * 20;
    return PATAlign.alignByAnchors(PATAlign.envelope(A, T0, t1, {}), PATAlign.envelope(B, T0, t1, {}), T0, {});
  })();
  const unshared = (() => {
    const A = mk(T0, bursts, 1);
    const B = mk(T0, [], 99); // arm perfectly still while the chest moves
    const t1 = T0 + 12000 * 20;
    return PATAlign.alignByAnchors(PATAlign.envelope(A, T0, t1, {}), PATAlign.envelope(B, T0, t1, {}), T0, {});
  })();
  const sA = shared.anchors ? shared.anchors.length : 0;
  const uA = unshared.anchors ? unshared.anchors.length : 0;
  ok('a SHARED-movement pair yields anchors', sA > 0, `anchors=${sA} candidates=${shared.candidates}`);
  ok('an UNCORROBORATED pair yields strictly fewer', uA < sA, `shared=${sA} unshared=${uA}`);
  /* The discriminator itself: candidates must be present in BOTH legs, or "few anchors" could not
     be told apart from "the chest never moved" — which is the distinction §3 turns on. */
  ok('…while both legs report the SAME chest candidates', shared.candidates === unshared.candidates && shared.candidates > 0, `${shared.candidates} vs ${unshared.candidates}`);

  console.log(`\n${fail ? `FAIL — ${fail}` : 'PASS — the two failure modes are distinguishable'}`);
  return fail ? 1 : 0;
}

const IS_CLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_CLI) {
  if (argv.includes('--selftest')) process.exit(selftest());
  const DIR = av('--dir');
  const ONLY = av('--only');
  const SIGMAS = av('--sigmas') ? av('--sigmas').split(',').map(Number) : null;
  if (!DIR || !existsSync(DIR)) {
    console.error('acc-shared-movement: pass --dir <corpus>. The raw corpus is gitignored and is not in the repo.');
    process.exit(2);
  }
  loadDsps();
  const nights = readdirSync(DIR)
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n) && statSync(join(DIR, n)).isDirectory())
    .filter((n) => !ONLY || n === ONLY)
    .sort();
  const rows = [];
  for (const n of nights) {
    let r;
    try {
      r = { night: n, ...nightSharedMovement(join(DIR, n), SIGMAS) };
    } catch (e) {
      r = { night: n, skipped: 'threw: ' + e.message };
    }
    rows.push(r);
    if (r.sweep) {
      console.error(`  ${n}  ` + r.sweep.map((x) => `s${x.sigma}:${x.candidates}/${x.anchors}=${x.corroborated}${x.ok ? '' : '\u2717'}`).join('  '));
      continue;
    }
    console.error(
      r.skipped
        ? `  ${n}  SKIP  ${r.skipped}`
        : `  ${n}  ${r.ok ? 'ALIGNS ' : 'REFUSES'}  cand ${String(r.candidates).padStart(4)}  anchors ${String(r.anchors).padStart(4)}  corroborated ${r.corroborated}  ${r.candidatesPerHour}/h  medCorr ${r.medianCorr}`
    );
  }
  const used = rows.filter((r) => !r.skipped);
  if (SIGMAS) {
    /* ┌─ DECISION BAND, PRE-STATED (FOLLOWUPS §1) ────────────────────────────────────────────────┐
       │ Written before the sweep ran, and derived from what the detector is SUPPOSED to catch —   │
       │ gross postural change, which sleep-posture work puts at roughly 10-40 position changes a  │
       │ night (order 1-6/h) — NOT from which value comes out looking best. A threshold chosen to  │
       │ maximise alignments on 36 nights is fitted to those 36 nights.                            │
       │                                                                                           │
       │   TARGET    median candidate rate <= 60/h (one a minute) — tens, not hundreds             │
       │   CONFIRMS  median corroboration >= 0.20, i.e. about 3x the sigma-4 baseline of 0.064     │
       │   GUARD     refusals must not exceed the sigma-4 baseline of 5, and no aligning night may │
       │             drop below minAnchors = 2                                                    │
       │   REFUTES   corroboration flat while anchors fall in step with candidates — that would    │
       │             mean the discarded candidates were NOT the uncorroborated ones, and the       │
       │             "the detector admits non-postural activity" story is wrong                   │
       └───────────────────────────────────────────────────────────────────────────────────────────┘ */
    const bySigma = SIGMAS.map((k, i) => {
      const col = used.map((r) => r.sweep[i]).filter(Boolean);
      const f = (key) => {
        const v = col.map((c) => c[key]).filter(Number.isFinite);
        return v.length ? +median(v).toFixed(3) : null;
      };
      return {
        sigma: k,
        nights: col.length,
        medCandidatesPerHour: f('candidatesPerHour'),
        medAnchors: f('anchors'),
        medCorroborated: f('corroborated'),
        refusals: col.filter((c) => !c.ok).length,
        totalAnchors: col.reduce((a, c) => a + c.anchors, 0),
        totalCandidates: col.reduce((a, c) => a + (c.candidates || 0), 0)
      };
    });
    console.error('');
    for (const b of bySigma)
      console.error(
        `  sigma=${String(b.sigma).padStart(4)}  cand/h ${String(b.medCandidatesPerHour).padStart(6)}  anchors ${String(b.medAnchors).padStart(5)}  corrob ${String(b.medCorroborated).padStart(6)}  refusals ${b.refusals}/${b.nights}`
      );
    console.log(JSON.stringify({ sigmas: SIGMAS, nights: rows.length, measured: used.length, bySigma, rows }, null, 2));
    process.exit(0);
  }
  const pass = used.filter((r) => r.ok);
  const failn = used.filter((r) => !r.ok);
  const st = (rs, k) => {
    const v = rs.map((r) => r[k]).filter(Number.isFinite);
    return v.length ? { median: median(v), min: Math.min(...v), max: Math.max(...v), q1: quantile(v, 0.25), q3: quantile(v, 0.75), n: v.length } : null;
  };
  console.log(
    JSON.stringify(
      {
        nights: rows.length,
        measured: used.length,
        aligns: pass.length,
        refuses: failn.length,
        all: { candidates: st(used, 'candidates'), anchors: st(used, 'anchors'), corroborated: st(used, 'corroborated'), candidatesPerHour: st(used, 'candidatesPerHour') },
        aligning: { candidates: st(pass, 'candidates'), anchors: st(pass, 'anchors'), corroborated: st(pass, 'corroborated') },
        refusing: { candidates: st(failn, 'candidates'), anchors: st(failn, 'anchors'), corroborated: st(failn, 'corroborated') },
        rows
      },
      null,
      2
    )
  );
}
