/*
 * clock.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * THE Clock Contract parser — single-sourced (A5, owner-ratified 2026-07-03;
 * OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF §3). Extracted VERBATIM from the canonical
 * per-node mirror (the byte-identical block pulsedex/ecgdex/integrator carried; hrvdex's
 * commented copy; oxydex's was the same minus the unused _ckP2). The owned bundler inlines
 * this ONE file into every bundle, so it stays bundled-local AND single-source — the
 * copy-paste mirror + its drift risk are retired.
 *
 * Contract (CLAUDE.md §🔒): floating wall-clock tMs via Date.UTC on components-as-written;
 * zoned ISO authoritative; explicit vendor regexes (never locale Date.parse); DMY/MDY §3;
 * time-only rows anchor+roll; NEVER fabricate now() — miss ⇒ null.
 *
 * Adopters delegate via local aliases (var parseTimestamp = DexClock.parseTimestamp; …)
 * inside their IIFE — public surfaces (ECGDSP.parseTimestamp, bare re-export tails) are
 * unchanged. NODE-LOCAL VARIANTS THAT STAY (deliberate, do not force onto DexClock):
 * ppgdex-dsp.js (strict ISO/epoch subset + quote-stripping), glucodex-dsp.js (_ckParse +
 * numeric-returning MDY wrapper), cpapdex-dsp.js (EDF-subset). Load clock.js BEFORE any
 * delegating *-dsp.js (dex-coload.js enforces host membership).
 */
(function (root) {
'use strict';

function tzOffset(instantMs){ return new Date(instantMs).getTimezoneOffset()*60000; }
function _ckP2(n){ return n<10?'0'+n:''+n; }
function _ckNumEpoch(n){
  if(!isFinite(n)) return null;
  if(n < 1e11) n = n*1000;                       // 10-digit (or smaller) → seconds → ms
  if(n < 1e11 || n > 4e12) return null;          // implausible epoch range
  var off = tzOffset(n);
  return { tMs: n - off, offsetMin: -off/60000 };
}
function _ckZoneMin(z){ var zs=z.replace(':',''); var sign=zs[0]==='-'?-1:1;
  return sign*(parseInt(zs.slice(1,3),10)*60 + parseInt(zs.slice(3,5),10)); }
/* Contract §3 — decide day vs month from the first two slash fields.
   `locked` (from resolveDMY) means the ORDER WAS PROVEN FOR THIS FILE: apply it unconditionally, so a
   single row can no longer flip the order mid-file. A row the lock cannot explain (its month field lands
   outside 1..12) is a contradiction, and a contradiction is null — never a guess.
   Unlocked (no pre-scan) keeps the historical per-call behavior for back-compat. */
function _ckDMY(a,b,preferDMY,locked){
  if(locked){
    var ld = preferDMY ? a : b, lmo = preferDMY ? b : a;
    return (lmo>=1 && lmo<=12 && ld>=1 && ld<=31) ? {d:ld,mo:lmo} : null;
  }
  if(a>12) return {d:a,mo:b};
  if(b>12) return {d:b,mo:a};
  return preferDMY ? {d:a,mo:b} : {d:b,mo:a};
}

/* Contract §3, the FILE-LEVEL lock: "Any row with day-component > 12 ⇒ file is unambiguous; lock that
   order for the whole file … Never switch order mid-file."  Scan every stamp ONCE up front:
     a row whose 1st slash field > 12 PROVES DMY · a row whose 2nd field > 12 PROVES MDY.
   Both proofs present ⇒ the file contradicts itself ⇒ refuse (contradictory:true) rather than guess.
   Neither ⇒ genuinely ambiguous ⇒ fall back to the caller's preferDMY, unlocked.
   Pass the result into parseTimestamp as { preferDMY: r.dmy, dmyLocked: r.locked }.
   Only the two ambiguous vendor shapes are scanned (4a "HH:MM:SS D/M/Y" and 4c "D/M/Y HH:MM"); ISO and
   YYYY/MM/DD carry no ambiguity. */
function resolveDMY(rawStamps, preferDMY){
  var pref = preferDMY !== false, sawDMY = false, sawMDY = false;
  var RE_A = /^(\d{1,2}):(\d{2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/;   // 4a — O2Ring
  var RE_C = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/; // 4c — Welltory etc.
  var list = rawStamps || [];
  for(var i=0;i<list.length;i++){
    var s = list[i]; if(typeof s !== 'string') continue;
    s = s.trim().replace(/^["']|["']$/g,'');
    var a=null,b=null,m;
    if((m = s.match(RE_A))){ a=+m[4]; b=+m[5]; }
    else if((m = s.match(RE_C))){ a=+m[1]; b=+m[2]; }
    else continue;
    if(a>12) sawDMY = true;
    if(b>12) sawMDY = true;
    if(sawDMY && sawMDY) break;                    // contradiction proven — no need to scan further
  }
  if(sawDMY && sawMDY) return { dmy:pref, locked:false, contradictory:true };
  if(sawDMY)           return { dmy:true,  locked:true,  contradictory:false };
  if(sawMDY)           return { dmy:false, locked:true,  contradictory:false };
  return { dmy:pref, locked:false, contradictory:false };
}

function parseTimestamp(raw, opts){
  opts = opts || {};
  var preferDMY = opts.preferDMY !== false;        // default true (O2Ring/Welltory exports are DMY)
  var dmyLocked = opts.dmyLocked === true;         // set by resolveDMY — the order is proven for this file
  var anchor = (opts.dateAnchorMs != null && isFinite(opts.dateAnchorMs)) ? opts.dateAnchorMs : null;
  if(raw == null) return null;
  if(typeof raw === 'number') return _ckNumEpoch(raw);
  var s = String(raw).trim().replace(/^["']|["']$/g,'');
  if(!s) return null;
  var m;
  // 1. all-digits epoch (ms or s) — but not a 14-digit YYYYMMDDHHMMSS run (step 4b)
  if(/^\d{10,13}$/.test(s)) return _ckNumEpoch(parseInt(s,10));
  // 2. ISO-8601 WITH explicit zone (Z or ±HH:MM): zone authoritative, re-express as local wall clock
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?\s*(Z|[+-]\d{2}:?\d{2})$/);
  if(m){ var off=(m[8]==='Z')?0:_ckZoneMin(m[8]);
    return { tMs: Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],m[6]?+m[6]:0, m[7]?+((m[7]+'00').slice(0,3)):0), offsetMin: off }; }
  // 3. ISO / "YYYY-MM-DD[ T]HH:MM[:SS][.sss]" NO zone → components verbatim (ms preserved)
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/);
  if(m) return { tMs: Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],m[6]?+m[6]:0, m[7]?+((m[7]+'00').slice(0,3)):0), offsetMin: null };
  // 4a. "HH:MM:SS DD/MM/YYYY" | "HH:MM:SS MM/DD/YYYY" (O2Ring)
  m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m){ var dm=_ckDMY(+m[4],+m[5],preferDMY,dmyLocked);
    if(!dm) return null;                           // row contradicts the file's proven order → honest null
    return { tMs: Date.UTC(+m[6],dm.mo-1,dm.d,+m[1],+m[2],+m[3]), offsetMin: null }; }
  // 4b. compact "YYYYMMDDHHMMSS" (14-digit, O2Ring filename embed)
  m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if(m) return { tMs: Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]), offsetMin: null };
  // 4c. "DD/MM/YYYY HH:MM[:SS]" | "MM/DD/YYYY HH:MM[:SS]" (Welltory etc.)
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(m){ var dm2=_ckDMY(+m[1],+m[2],preferDMY,dmyLocked);
    if(!dm2) return null;                          // row contradicts the file's proven order → honest null
    return { tMs: Date.UTC(+m[3],dm2.mo-1,dm2.d,+m[4],+m[5],m[6]?+m[6]:0), offsetMin: null }; }
  // 4d. "YYYY/MM/DD HH:MM[:SS]"
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(m) return { tMs: Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],m[6]?+m[6]:0), offsetMin: null };
  // 5. Time-only "HH:MM[:SS]" → combine with dateAnchorMs, monotonic roll-forward
  m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(m){
    if(anchor == null) return null;                // never fabricate Jan-1-2000
    var d0 = new Date(anchor);
    var t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate(), +m[1],+m[2], m[3]?+m[3]:0);
    if(opts.prevTMs != null && isFinite(opts.prevTMs)){ while(t < opts.prevTMs) t += 86400000; }
    return { tMs: t, offsetMin: null };
  }
  // 6. Fallback — NEVER now(). A missing stamp stays visible (null).
  return null;
}

root.DexClock = { tzOffset: tzOffset, _ckP2: _ckP2, _ckNumEpoch: _ckNumEpoch, _ckZoneMin: _ckZoneMin, _ckDMY: _ckDMY, resolveDMY: resolveDMY, parseTimestamp: parseTimestamp };
if (typeof module !== 'undefined' && module.exports) module.exports = root.DexClock;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
