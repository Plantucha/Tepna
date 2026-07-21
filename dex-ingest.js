/*
 * dex-ingest.js — Tepna shared file-ingest classification (pure, headless, UI-free)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * ONE source for the raw-signal NODES' drop-classification regexes — the pure
 * "which app/stream is this file?" decision that ECGDex and PpgDex both make at
 * the start of loadFiles(). Promoted out of the per-app files (ECG-INGEST-
 * FOLLOWUPS-2026-06-28 §3) so the routing table is a TESTABLE, gate-backed
 * surface instead of two un-exported copies that a regex regression could break
 * silently (the equiv gate exercises compute({text}), never the drop path).
 *
 * This is the app-layer instance of the long-standing AND-FRONTIER ask ("vendor
 * sniffing is buried in nodes / no shared vendor registry"). It is consumed by
 * ecgdex-app.js + ppgdex-app.js (and tested in BOTH runners via env.DexIngest).
 * §1 (ECG-INGEST-FOLLOWUPS-II) folded the HOST layer on too: signal-orchestrate.js
 * pairCompanions now consults DexIngest.deviceKey/foreignVendor (its own local
 * copies deleted), so the device-id + foreign-vendor rules are ONE source across
 * the app AND host ingest paths (the deferred AND-FRONTIER (b), now landed). This
 * adds a load-order edge: dex-ingest.js is co-loaded BEFORE signal-orchestrate.js
 * in all four hosts (Data Unifier · OverDex · Dex-Test-Suite · tests/run-tests.mjs).
 * signal-orchestrate keeps its OWN streamKind/fnameStampMs (a generic name→kind +
 * a loose any-name stamp parse — no DexIngest equivalent).
 *
 * Clock Contract: stampMs() returns UTC-normalized FLOATING wall-clock ms
 * (Date.UTC of the structured Polar Sensor Logger stamp), never a real instant.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  // Device identity from a Polar Sensor Logger name "Polar_<MODEL>_<ID>_<YYYYMMDD>_<HHMMSS>_<KIND>"
  // → "POLAR_H10_AAAAAAAA". null for non-Polar / unstamped names (bare waveform, O2Ring CSV).
  // TWO stamp shapes are accepted (ENGINE-VERIFICATION-FINDINGS §1.2):
  //   …_YYYYMMDD_HHMMSS_KIND  — real Polar Sensor Logger (the committed corpus)
  //   …_YYYYMMDDHHMMSS_KIND   — capture-host/writers.py (contiguous, no separator)
  // Before this, the contiguous form returned null, so `hasDev` went false, `anchor` went null,
  // and planIngest's whole device-eligibility block was skipped — a Verity ACC became a legal
  // companion for an H10 ECG on every Vigil-captured night. Fix is app-side ON PURPOSE: the
  // parsers must keep reading the genuine PSL corpus either way, so widen rather than switch.
  function deviceKey(name) {
    var m = String(name == null ? '' : name).match(/^(POLAR_[A-Z0-9]+_[A-Z0-9]+)_(?:\d{8}_\d{6}|\d{14})/i);
    return m ? m[1].toUpperCase() : null;
  }

  // Floating wall-clock ms (Clock Contract) from the structured stamp …_YYYYMMDD[_]HHMMSS_<KIND>,
  // ANCHORED after the device id so an 8-digit device serial can't be misread as a date (the
  // unanchored variant in signal-orchestrate.js did exactly that — §1.1). The separator is
  // OPTIONAL so both the PSL and capture-host shapes resolve; anchoring is what keeps a 14-digit
  // device id from being eaten as a stamp, so it must survive the widening. null = none.
  function stampMs(name) {
    var m = String(name == null ? '' : name).match(/^POLAR_[A-Z0-9]+_[A-Z0-9]+_(\d{4})(\d{2})(\d{2})_?(\d{2})(\d{2})(\d{2})/i);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
  }

  // Foreign DEVICE/vendor signal — a different instrument entirely, never an ECG/PPG companion:
  // O2Ring/Wellue/Checkme/Viatom/Oxylink pulse-ox SpO₂ → OxyDex; Abbott Libre / Dexcom CGM → GlucoDex.
  function foreignVendor(name) {
    var u = String(name == null ? '' : name).toUpperCase();
    if (/^O2RING|WELLUE|CHECKME|VIATOM|OXYLINK|_SPO2\b|_SPO2\./.test(u)) return 'spo2';
    if (/^LIBRE|FREESTYLE|^DEXCOM|_CGM\b|_CGM\./.test(u)) return 'cgm';
    return null;
  }

  // ECGDex ingest routing. The Polar H10 `*_ECG.txt` waveform is the PRIMARY; `*_RR/_HR/_ACC` are
  // companions (route to their cross-check loaders); every OTHER Polar stream (`*_PPG/_MAGN/_GYRO/
  // _TEMP/…` + `MARKER_*`) and any foreign-vendor signal → 'skip' (set aside, never QRS-analyzed).
  // A bare, suffix-less file defaults to ECG (a content-sniff in the app then guards a misnamed one).
  function ecgKind(name) {
    var u = String(name == null ? '' : name).toUpperCase();
    if (/_ACC\b|_ACC\./.test(u)) return 'acc';
    if (/_RR\b|_RR\.|_PPI\b|_PPI\./.test(u)) return 'rr';
    if (/_HR\b|_HR\./.test(u)) return 'hr';
    if (/_ECG\b|_ECG\./.test(u)) return 'ecg';
    if (/_(MAGN|GYRO|PPG|TEMP|SKINTEMP|BARO|PRESSURE|ALTITUDE|SDKMODE|FEATURE)\b|_(MAGN|GYRO|PPG|TEMP|SKINTEMP|BARO|PRESSURE|ALTITUDE|SDKMODE|FEATURE)\.|^MARKER[_.]/.test(u)) return 'skip';
    if (foreignVendor(name)) return 'skip';
    return 'ecg'; // default — a bare waveform is the ECG
  }

  // PpgDex ingest routing. The Polar Verity Sense `*_PPG.txt` optical waveform is the PRIMARY;
  // `*_ACC/_GYRO/_MAGN/_PPI` + `MARKER_*` are companions; device `*_HR` is ignored-with-note;
  // raw `*_ECG` (→ ECGDex) and any foreign-vendor signal → 'skip'. NOTE the asymmetry to ECG: PPG's
  // companion kinds are acc/gyro/magn/ppi (NOT ECG's rr/hr/acc) — kept node-specific by design.
  function ppgKind(name) {
    var u = String(name == null ? '' : name).toUpperCase();
    if (/_PPG\b|_PPG\./.test(u)) return 'ppg';
    if (/_ACC\b|_ACC\./.test(u)) return 'acc';
    if (/_GYRO\b|_GYRO\./.test(u)) return 'gyro';
    if (/_MAGN\b|_MAGN\./.test(u)) return 'magn';
    if (/_PPI\b|_PPI\./.test(u)) return 'ppi';
    if (/_HR\b|_HR\./.test(u)) return 'hr';
    if (/MARKER/.test(u)) return 'marker';
    if (/_ECG\b|_ECG\./.test(u)) return 'skip';
    if (foreignVendor(name)) return 'skip';
    return 'ppg'; // default — assume a bare waveform
  }

  // Precise foreign-stream label for a name a node routed to 'skip' (UI reporting / breakdown).
  function foreignKind(name) {
    var u = String(name == null ? '' : name).toUpperCase();
    if (/_PPG\b|_PPG\./.test(u)) return 'ppg';
    if (/_MAGN\b|_MAGN\./.test(u)) return 'magn';
    if (/_GYRO\b|_GYRO\./.test(u)) return 'gyro';
    if (/_ECG\b|_ECG\./.test(u)) return 'ecg';
    var fv = foreignVendor(name);
    if (fv) return fv;
    return 'skip';
  }

  // First-line header content-sniff (defence in depth): a file fed as a node's PRIMARY waveform —
  // by a primary-ish name, or suffix-less so it defaulted — but whose FIRST LINE positively names a
  // different stream. NODE-NEUTRAL: returns the recognised stream ('ecg'/'ppg'/'gyro'/'magn'/'acc'/
  // 'spo2'/'cgm') or null for a header-less / bare-numeric / unrecognised first line; the CALLER
  // decides which verdict is "foreign" for its node (ECG: anything≠'ecg'; PPG: anything≠'ppg').
  // Conservative by construction — a plain numeric `.dat` waveform sniffs null → passes as primary.
  function sniffFirstLine(line) {
    var first = String(line == null ? '' : line)
      .trim()
      .toLowerCase();
    if (!first) return null;
    if (/ecg\s*\[/.test(first)) return 'ecg'; // "…;ecg [uV]"
    if (/channel\s*\d/.test(first) || /\bambient\b/.test(first)) return 'ppg'; // Verity optical header
    if (/\[\s*dps\s*\]/.test(first)) return 'gyro'; // X [dps]
    if (/[xyz]\s*\[\s*g\s*\]/.test(first)) return 'magn'; // X [G] (Gauss)
    if (/[xyz]\s*\[\s*mg\s*\]/.test(first)) return 'acc'; // X [mg]
    if (/\bspo2\b|spo₂|oxygen\s*level|\bpleth\b|pulse\s*rate|\bsao2\b|\bperfusion\b/.test(first)) return 'spo2';
    if (/\bglucose\b|\bmg\/dl\b|\bmmol\/l\b/.test(first)) return 'cgm';
    return null; // unrecognised header or numeric first row → caller treats as its primary
  }

  // ── §4 (ECG-INGEST-FOLLOWUPS-II) · ECGDex DROP-PLAN — pure, DOM-free, NAME-ONLY ───────────────
  // Lifts the ORCHESTRATION of ecgdex-app.js loadFiles (bucket → device-anchor companion filter →
  // _RR-over-_PPI → de-dupe → part-group) out of the app so it is a TESTABLE, gate-backed surface
  // instead of live-only code (the equiv gate drives compute({text}); render-coverage drives
  // genSynthetic — NEITHER drives a multi-file drop, so this routing was previously ungated). The
  // app CONSUMES this (no second drifting copy). It is NAME-only: the caller still runs the async
  // header content-sniff (it needs file bytes) and feeds its verdicts via opts.sniffedForeign.
  //
  // _groupParts/_dedupeGroups are byte-faithful mirrors of the app's groupFileParts /
  // dedupeCompanionGroups (which now live ONLY here). They operate on any {name}-bearing item and
  // return the SAME object references grouped, so the app gets its File objects back with no remap.
  // partKey is INJECTED (DSP.partKey) to keep this module DSP-free; absent → every item is a single.
  function _groupParts(items, pk) {
    var groups = {},
      order = [];
    items.forEach(function (it, idx) {
      var k = pk ? pk(it.name) : null;
      var base = k ? '\u0001' + k.base : '\u0000' + idx + '_' + it.name; // singles unique
      if (!groups[base]) {
        groups[base] = [];
        order.push(base);
      }
      groups[base].push(it);
    });
    return order.map(function (b) {
      var arr = groups[b];
      arr.sort(function (x, y) {
        var px = pk && pk(x.name),
          py = pk && pk(y.name);
        return (px ? px.part : 1) - (py ? py.part : 1);
      });
      return arr;
    });
  }
  // ── IV §2 (ECG-INGEST-FOLLOWUPS-IV) · SHARED planner primitives — ONE source each, called by BOTH
  //    planIngest (ECG) and planIngestPpg (PPG), so the device-session dedupe + the device-eligibility
  //    predicate can't drift between the two planners (the two-copy trap ecgKind/ppgKind closed at the
  //    classifier layer, here kept closed one layer up). ────────────────────────────────
  //
  // Dedupe by device-session signature (deviceKey@stampMs); keep the FIRST occurrence of each
  // identifiable session, others → dropped. A unit WITHOUT a device+stamp signature always passes
  // (kept) — we only disambiguate identifiable sessions. nameOf extracts the signature name from a unit
  // (default u.name; pass g=>g[0].name for part-GROUPS, where a genuine multi-part stream is ONE group).
  function _dedupeBySession(units, nameOf) {
    nameOf =
      nameOf ||
      function (u) {
        return u && u.name;
      };
    var seen = {},
      kept = [],
      dropped = [];
    units.forEach(function (u) {
      var nm = nameOf(u),
        dk = deviceKey(nm),
        st = stampMs(nm);
      var sig = dk != null && st != null ? dk + '@' + st : null;
      if (sig && seen[sig]) {
        dropped.push(u);
        return;
      }
      if (sig) seen[sig] = 1;
      kept.push(u);
    });
    return { kept: kept, dropped: dropped };
  }
  // Device-eligibility predicate: a candidate is eligible vs an anchor UNLESS it carries a DIFFERENT
  // Polar device id. anchor = a device-key STRING (PPG single-primary), an OBJ/set of keys (ECG multi-
  // device drop), or null (no anchor → all eligible). A bare / non-Polar candidate (deviceKey null) is
  // always eligible (→ the caller's nearest-stamp fallback disambiguates).
  function _isDeviceEligible(candidateName, anchor) {
    if (anchor == null) return true;
    var cd = deviceKey(candidateName);
    if (!cd) return true;
    return typeof anchor === 'string' ? cd === anchor : !!anchor[cd];
  }
  // drop a duplicate same-device-session companion GROUP (keep the first) so a sidecar dropped twice
  // doesn't clobber its lane by load order. Thin wrapper over the shared _dedupeBySession (IV §2);
  // groups without a device+session signature pass through untouched.
  function _dedupeGroups(groups) {
    return _dedupeBySession(groups, function (g) {
      return g[0].name;
    }).kept;
  }
  // The PPG companion PICK that planIngestPpg deliberately keeps app-side (it needs the PARSED rec.t0Ms
  // a NAME-only planner can't see): given device-eligible candidates (each carrying .stampMs) + a
  // reference ms, return the candidate whose stamp is CLOSEST to refMs — ties → FIRST, null on empty.
  // Extracted from ppgdex-app.js loadFiles so the PPG-UNIQUE pick is headless + gate-backed (IV §1).
  // §10.2 — a sidecar shares its primary's session (stamps differ by seconds); >1 day apart ⇒ a
  // different recording. Deliberately generous so no real same-session companion is ever rejected.
  var PICK_MAX_GAP_MS = 24 * 3600000;
  function pickNearestByStamp(candidates, refMs) {
    candidates = Array.isArray(candidates) ? candidates : [];
    if (!candidates.length) return null;
    // DEEP-AUDIT-II §10.2/§10.3 — a sidecar is written in its primary's recording session, so its
    // filename stamp is close to refMs. Two corrections to the former `|stampMs||0 − refMs||0|`:
    //   §10.3 a null/unparseable stamp is UNKNOWN, NOT epoch 0 (scoring it 0 ranked absence as ~58 y
    //         away — silently dropped — and, when refMs was null, collapsed the compare to |stampMs|).
    //   §10.2 a stamp more than a day from the reference is a DIFFERENT recording, never a companion —
    //         pairing it rendered a green agreement and silently rewrote which beats reached the HRV
    //         numbers. With no reference stamp distance is undefined, so a lone candidate is returned
    //         only when it is the sole option.
    if (refMs == null) return candidates.length === 1 ? candidates[0] : null;
    var best = null,
      bd = Infinity;
    for (var i = 0; i < candidates.length; i++) {
      var s = candidates[i].stampMs;
      if (s == null) continue; // §10.3 — unscoreable stamp is not epoch 0
      var d = Math.abs(s - refMs);
      if (d > PICK_MAX_GAP_MS) continue; // §10.2 — too far apart to be the same session's sidecar
      if (d < bd) {
        bd = d;
        best = candidates[i];
      }
    }
    return best;
  }
  // items: [{name, …}] (the whole drop; the SAME references flow into the returned groups).
  // opts.activeDeviceKey : the loaded recording's device key (RESULT.deviceKey) — the anchor for a
  //        companions-ONLY drop (no ECG present). null = none.
  // opts.sniffedForeign  : Map|obj name→foreignKind for ecg-NAMED items the caller's content-sniff
  //        reclassified as foreign (a misnamed MAGN/PPG/…); default none → every ecg-named is real.
  // opts.partKey         : the multipart splitter (DSP.partKey); absent → no part folding.
  // → { ecgGroups: [[item,…],…],                                  // ordered part-groups, one recording each
  //     companionLanes: { rr:[[item,…]], hr:[[…]], acc:[[…]] },   // deduped part-groups per lane, device-filtered
  //     skipped: [{name, kind, device?}] }                        // skip-bucket + sniff-foreign + foreign-device + dup-night
  function planIngest(items, opts) {
    opts = opts || {};
    var pk = opts.partKey || null,
      sf = opts.sniffedForeign || null;
    var sfGet = function (name) {
      return sf ? (typeof sf.get === 'function' ? sf.get(name) : sf[name]) : undefined;
    };
    items = Array.isArray(items) ? items : [];
    // (1) bucket by name classification (the SAME ecgKind the app + the routing-table test use)
    var byKind = /** @type {{ ecg:any[], rr:any[], hr:any[], acc:any[], skip:any[] }} */ ({ ecg: [], rr: [], hr: [], acc: [], skip: [] });
    items.forEach(function (it) {
      (byKind[ecgKind(it.name)] || byKind.ecg).push(it);
    });
    // (2) skip bucket → foreign (precise label for the UI breakdown)
    /** @type {{name:any, kind:any, device?:any}[]} */
    var skipped = byKind.skip.map(function (it) {
      return { name: it.name, kind: foreignKind(it.name) };
    });
    // (3) the caller's header content-sniff: a name-'ecg' item it reclassified as foreign is set aside
    //     with its sniffed kind; the rest are real ECG (drop order preserved).
    var realEcg = [];
    byKind.ecg.forEach(function (it) {
      var fk = sfGet(it.name);
      if (fk) skipped.push({ name: it.name, kind: fk });
      else realEcg.push(it);
    });
    // (4) device anchor: this drop's ECG device(s), else (companions-only drop) the active recording's device
    var anchor = null,
      hasDev = false,
      dev = {};
    realEcg.forEach(function (it) {
      var dk = deviceKey(it.name);
      if (dk) {
        dev[dk] = 1;
        hasDev = true;
      }
    });
    if (hasDev) anchor = dev;
    else if (opts.activeDeviceKey) {
      anchor = {};
      anchor[opts.activeDeviceKey] = 1;
    }
    // (5) device-id companion filter: a foreign-device sidecar is set aside (otherdevice), never attached.
    //     The eligibility predicate is the shared _isDeviceEligible (IV §2; anchor is the device SET here).
    if (anchor) {
      ['rr', 'hr', 'acc'].forEach(function (kind) {
        var keep = [];
        byKind[kind].forEach(function (it) {
          if (_isDeviceEligible(it.name, anchor)) keep.push(it);
          else skipped.push({ name: it.name, kind: 'otherdevice', device: deviceKey(it.name) });
        });
        byKind[kind] = keep;
      });
    }
    // (6) _RR over _PPI: a Polar H10 session ships both → prefer firmware _RR; use _PPI only when no _RR
    var isPPI = function (n) {
      return /_PPI\b|_PPI\./i.test(n);
    };
    if (
      byKind.rr.some(function (it) {
        return !isPPI(it.name);
      })
    )
      byKind.rr = byKind.rr.filter(function (it) {
        return !isPPI(it.name);
      });
    // (7) companion lanes: part-group, then de-dupe a duplicated same-device-session sidecar group
    var companionLanes = {
      rr: _dedupeGroups(_groupParts(byKind.rr, pk)),
      hr: _dedupeGroups(_groupParts(byKind.hr, pk)),
      acc: _dedupeGroups(_groupParts(byKind.acc, pk))
    };
    // (8) ECG groups: part-group, then de-dupe a duplicate night (same device id + structured start
    //     stamp) via the shared _dedupeBySession (IV §2); each dropped group → a 'duplicate' set-aside.
    var _ecgDed = _dedupeBySession(_groupParts(realEcg, pk), function (g) {
      return g[0].name;
    });
    _ecgDed.dropped.forEach(function (g) {
      skipped.push({ name: g[0].name, kind: 'duplicate' });
    });
    var ecgGroups = _ecgDed.kept;
    return { ecgGroups: ecgGroups, companionLanes: companionLanes, skipped: skipped };
  }

  // ── §1 (ECG-INGEST-FOLLOWUPS-III) · PpgDex DROP-PLAN — pure, DOM-free, NAME-ONLY ────────────────
  // The PpgDex sibling of planIngest. PpgDex's loadFiles is CONTENT-first — it reads every file's text
  // up front, folds multipart via DSP.mergeMultipart on PARSED objects, and picks the nearest companion
  // by the PARSED rec.t0Ms — so a single NAME-only planner CANNOT own the final pick the way the ECG
  // planner owns its global lanes. What IS name-based — classify · skip/foreign · duplicate-session
  // set-aside · per-primary device-ELIGIBILITY — lifts HERE so the mixed Sense+H10 split and the
  // duplicate-`_PPG` set-aside are gate-backed DIRECTLY (mirroring §4's ECG group); the app keeps the
  // rec.t0Ms nearest pick over the returned eligible candidates. TWO asymmetries to planIngest:
  //   • companion kinds are acc/gyro/magn/ppi/marker (NOT rr/hr/acc) and association is PER-PRIMARY
  //     (each `_PPG` picks its own nearest eligible sidecar) → the return is eligibleByPrimary, not
  //     global lanes; device `_HR` is its own ignored-with-note lane (`hr`).
  //   • there is NO partKey fold here — PpgDex folds multipart content-side (DSP.mergeMultipart) BEFORE
  //     calling, so items arrive already merged.
  //
  // items: [{name, …}] — the POST-merge parsed objects; the SAME refs flow back in ppgPrimaries +
  //        eligibleByPrimary (refs, not bare names) so the app reparses their .text with NO remap.
  // opts.sniffedForeign : Map|obj name→foreignKind for ppg-NAMED items the caller's first-line content-
  //        sniff reclassified as foreign (a misnamed ECG/SpO₂/CGM/sensor-axis); default none → all real.
  // → { ppgPrimaries: [item,…],                                              // deduped real PPG, drop order
  //     eligibleByPrimary: { name → { acc:[item,…], gyro, magn, ppi, marker } },  // device-eligible per kind
  //     hr: [item,…],                                                        // device-HR lane (ignored-with-note)
  //     skipped: [{name, kind}] }                                            // foreign + sniff-foreign + duplicate
  function planIngestPpg(items, opts) {
    opts = opts || {};
    var sf = opts.sniffedForeign || null;
    var sfGet = function (name) {
      return sf ? (typeof sf.get === 'function' ? sf.get(name) : sf[name]) : undefined;
    };
    items = Array.isArray(items) ? items : [];
    var COMPANION = ['acc', 'gyro', 'magn', 'ppi', 'marker'];
    // (1) classify by name (the SAME ppgKind the app + routing-table test use); a name-'ppg' item the
    //     caller's content-sniff flagged foreign (sniffedForeign) is set aside with its sniffed kind.
    var ppgCand = [],
      hr = [],
      comp = { acc: [], gyro: [], magn: [], ppi: [], marker: [] },
      skipped = [];
    items.forEach(function (it) {
      var k = ppgKind(it.name);
      if (k === 'ppg') {
        var fk = sfGet(it.name);
        if (fk && fk !== 'ppg') {
          skipped.push({ name: it.name, kind: fk });
          return;
        }
      }
      if (k === 'skip') {
        skipped.push({ name: it.name, kind: foreignKind(it.name) });
        return;
      }
      if (k === 'ppg') ppgCand.push(it);
      else if (k === 'hr') hr.push(it);
      else if (comp[k]) comp[k].push(it);
    });
    // (2) same-session de-dupe via the shared _dedupeBySession (IV §2): a session dropped twice shares
    //     device id + structured stamp → keep the first, set the rest aside (a DISTINCT session has a
    //     different stamp → still loads separately).
    var _ppgDed = _dedupeBySession(ppgCand);
    _ppgDed.dropped.forEach(function (it) {
      skipped.push({ name: it.name, kind: 'duplicate' });
    });
    var ppgPrimaries = _ppgDed.kept;
    // (3) per-primary device ELIGIBILITY via the shared _isDeviceEligible (IV §2): only SAME-device
    //     sidecars are candidates for a `_PPG`. A bare / non-Polar candidate (deviceKey null on either
    //     side) stays eligible → the app's nearest-stamp pick (DexIngest.pickNearestByStamp, with the
    //     PARSED rec.t0Ms, app-side) disambiguates.
    var eligibleByPrimary = {};
    ppgPrimaries.forEach(function (pf) {
      var pfDev = deviceKey(pf.name),
        elig = {};
      COMPANION.forEach(function (k) {
        elig[k] = comp[k].filter(function (c) {
          return _isDeviceEligible(c.name, pfDev);
        });
      });
      eligibleByPrimary[pf.name] = elig;
    });
    return { ppgPrimaries: ppgPrimaries, eligibleByPrimary: eligibleByPrimary, hr: hr, skipped: skipped };
  }

  root.DexIngest = {
    deviceKey: deviceKey,
    stampMs: stampMs,
    foreignVendor: foreignVendor,
    ecgKind: ecgKind,
    ppgKind: ppgKind,
    foreignKind: foreignKind,
    sniffFirstLine: sniffFirstLine,
    planIngest: planIngest,
    planIngestPpg: planIngestPpg,
    pickNearestByStamp: pickNearestByStamp
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
