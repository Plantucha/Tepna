/*
 * dex-forget.js — Tepna "erase all data on this device" (SECURITY-REMEDIATION F5)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * The single erase-all control for the Dex suite. Before this, each node's
 * "Clear" only reset the in-memory view (F5) and there was NO way to wipe the
 * union of health/identity data a user accumulates on a device: the unified
 * profile, each node's saved readings/settings, and the Integrator's IndexedDB
 * longitudinal store. This module owns:
 *
 *   · LOCAL_KEYS  — the canonical inventory of localStorage keys the Dex APPS
 *                   persist (health, identity, and app state). Kept beside the
 *                   storage-key inventory so a `dex-forget` gate leg can assert
 *                   it covers every key the app sources write (drift = RED).
 *                   Standalone research/analysis pages (cgm-hrv-coupling,
 *                   nights-icc, …) keep their own checkpoint keys/DBs and are
 *                   deliberately out of scope — their button never renders here.
 *   · IDB_DBS     — the IndexedDB databases to delete (the Integrator store).
 *   · eraseAll()  — remove every LOCAL_KEY (+ DexProfile.LEGACY_KEYS if loaded)
 *                   and deleteDatabase() each IDB. removeItem is a no-op on an
 *                   absent key, so the list is a superset-safe union.
 *   · ensureControl(mount) — idempotently render the button + a "what's stored
 *                   here" disclosure into a panel, wired to confirm→erase→reload.
 *
 * DOM-free except ensureControl (guarded), so it loads in a worker/Node too.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  // localStorage keys the Dex apps persist. Grouped for auditability; every key
  // an app source writes must appear here (the dex-forget gate enforces it).
  var LOCAL_KEYS = [
    // unified identity
    'tepna_profile',
    // legacy per-node profile schemas (folded + deleted by dex-profile migrate; cleared here defensively)
    'oxydex_profile',
    'o2ring_profile',
    'ecgdex_profile',
    'ppgdex_profile',
    'pulsedex_profile',
    'glucodex_profile',
    'prof_age',
    'prof_sex',
    'prof_weight',
    'prof_height',
    'prof_sbp',
    'prof_dbp',
    'prof_vo2gt',
    'prof_hrmax',
    'prof_hrrest',
    'prof_elev',
    // per-node saved data / settings
    'hrvdex_rows_v1',
    'hrvdex_dashMode',
    'glucodex_meals',
    'glucodex_calib',
    'glucodex_dispUnit',
    'ppgdex_active',
    // F4 raw-recording cache (dropped; cleared for users who cached under a prior version)
    'oxydex_last_csv',
    'oxydex_last_name',
    'o2ring_last_csv',
    'o2ring_last_name',
    // display / UI state
    'dex_theme',
    'oxydex_theme',
    'o2ring_theme',
    'welltory_theme',
    'dex_depth_tier',
    'oxydex_collapse_v1',
    'o2ring_collapse_v1'
  ];
  // IndexedDB databases holding suite health data (the Integrator longitudinal store).
  var IDB_DBS = ['ganglior_integrator'];

  // The effective key set at erase time = LOCAL_KEYS ∪ DexProfile.LEGACY_KEYS (in case a
  // legacy key is added there and not mirrored here — the gate flags it, this stays correct).
  function _keys() {
    var out = LOCAL_KEYS.slice();
    try {
      var lk = root.DexProfile && root.DexProfile.LEGACY_KEYS;
      if (lk && lk.length)
        lk.forEach(function (k) {
          if (out.indexOf(k) < 0) out.push(k);
        });
    } catch (e) {}
    return out;
  }

  // Wipe every known key + delete the IndexedDB stores. Returns a summary.
  // opts.localStorage / opts.indexedDB override root's (a test seam; production passes nothing).
  function eraseAll(opts) {
    opts = opts || {};
    var removed = [],
      idb = [];
    var ls = opts.localStorage;
    if (ls === undefined) {
      try {
        ls = root.localStorage;
      } catch (e) {
        ls = null;
      }
    }
    if (ls) {
      _keys().forEach(function (k) {
        try {
          if (ls.getItem(k) != null) removed.push(k);
          ls.removeItem(k);
        } catch (e) {}
      });
    }
    var db = opts.indexedDB;
    if (db === undefined) {
      try {
        db = root.indexedDB;
      } catch (e) {
        db = null;
      }
    }
    if (db) {
      IDB_DBS.forEach(function (name) {
        try {
          db.deleteDatabase(name);
          idb.push(name);
        } catch (e) {}
      });
    }
    return { removed: removed, idb: idb };
  }

  // Idempotently render the erase-all control into `mount` (a DOM element). Safe to
  // call on every panel re-render (it re-adds itself after an innerHTML wipe).
  function ensureControl(mount) {
    var doc = root.document;
    if (!doc || !mount || typeof mount.querySelector !== 'function') return;
    if (mount.querySelector('#dex-forget-ctl')) return; // already present this render

    var wrap = doc.createElement('div');
    wrap.id = 'dex-forget-ctl';
    wrap.style.cssText = 'margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08)';

    var note = doc.createElement('div');
    note.style.cssText = 'font-size:11px;line-height:1.5;color:var(--text3,#6F8096);margin-bottom:8px';
    // Static, non-untrusted copy — .textContent for belt-and-suspenders.
    note.textContent = 'Stored on this device only: your profile, each node’s saved readings and settings, and the Integrator’s longitudinal history. Nothing leaves your browser.';

    var btn = doc.createElement('button');
    btn.id = 'dex-forget-btn';
    btn.type = 'button';
    btn.textContent = 'Erase all data on this device';
    btn.style.cssText = 'cursor:pointer;font-size:12px;font-weight:600;padding:7px 13px;border-radius:8px;background:rgba(255,90,90,.08);border:1px solid rgba(255,90,90,.35);color:#ff7a7a';
    btn.addEventListener('click', function () {
      var ok = true;
      try {
        ok = root.confirm('Erase ALL Tepna data on this device?\n\nThis removes your profile, every node’s saved readings, and the Integrator’s longitudinal history. It cannot be undone.');
      } catch (e) {}
      if (!ok) return;
      eraseAll();
      try {
        btn.disabled = true;
        btn.textContent = 'Erased — reloading…';
      } catch (e) {}
      try {
        root.location.reload();
      } catch (e) {}
    });

    wrap.appendChild(note);
    wrap.appendChild(btn);
    mount.appendChild(wrap);
  }

  var DexForget = { LOCAL_KEYS: LOCAL_KEYS, IDB_DBS: IDB_DBS, eraseAll: eraseAll, ensureControl: ensureControl };
  root.DexForget = DexForget;
  if (typeof module !== 'undefined' && module.exports) module.exports = DexForget;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
