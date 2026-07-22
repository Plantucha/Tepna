/*
 * tools/build-docs.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Build the public GitHub-Pages deploy snapshot in ../docs (the served root per
 * docs/SITE-DEPLOY-AND-LAYOUT.md §D) from the repo-root source of truth. TWO phases, one command:
 *
 *   PHASE 1 — page-body sync (root → docs/, per-page):
 *     • straight copy every deploy .html whose root form links only to shipped targets
 *       (apps, guides, content, papers, clean wiring) — so re-bundles + content edits propagate;
 *     • MECHANICAL de-link for pages that link to non-shipped targets (Tier-3 tools/gates + any raw
 *       .md): every <a href="NON-PUBLIC">…</a> → <span class="tool-off">…</span>. This reproduces the
 *       existing hand-de-linked wiring pages byte-for-byte (verified 2026-07-04);
 *     • PRESERVE pages listed in suite.manifest.json deploy.delinkPreserve (editorially de-linked —
 *       e.g. Science.html's reworded lab-bench prose): never clobbered; flagged if root changed.
 *       Pass --force-delink to overwrite a preserved page with the mechanical de-link anyway.
 *
 *   PHASE 2 — discoverability artifacts (regenerated after the sync so they see the current page set):
 *     docs/{sitemap.xml, robots.txt, feed.xml, about.json, llms.txt, llms-full.txt}
 *
 *   PHASE 3 — project the canonical suite.manifest.json version into README + both index.html twins.
 *
 * ONE PASS SETTLES THE TREE (`build-docs && build-docs --check` is clean — it was not, before
 * 2026-07-14). The trap: llms-full.txt (Phase 2) concatenates README.md, which Phase 3 stamps — so
 * generating artifacts from on-disk bytes made the run order-dependent and left llms-full.txt one
 * release behind. Artifacts now derive their text via applyStamp() instead of re-reading the file.
 * If you add an artifact that embeds a stamped source, STAMP THE TEXT — do not re-read the file.
 *
 * Run:   node tools/build-docs.mjs                 (sync + regenerate)
 *        node tools/build-docs.mjs --check         (diff-only; non-zero exit if docs/ is stale)
 *        node tools/build-docs.mjs --force-delink  (also overwrite preserved pages, mechanical de-link)
 *
 * Pure / no-deps / no-network. Scope = every deploy file with a repo-root twin: HTML page bodies
 * (Phase 1a, with the de-link / preserve logic) + CSS/JS/image assets (Phase 1b, byte-compare + copy)
 * + the generated artifacts (Phase 2). Archival .md, .nojekyll, and the artifacts have no root twin and
 * are left untouched. A brand-new file not yet present in docs/ needs a first manual add.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'suite.manifest.json'), 'utf8'));
const DEPLOY_REL = (manifest.deploy && manifest.deploy.dir) || 'docs';
const DEPLOY = join(ROOT, DEPLOY_REL);
const DELINK_CLASS = (manifest.deploy && manifest.deploy.delinkClass) || 'tool-off';
const PRESERVE = new Set((manifest.deploy && manifest.deploy.delinkPreserve) || []);
const ARTIFACT_NAMES = new Set(['sitemap.xml', 'robots.txt', 'feed.xml', 'about.json', 'llms.txt', 'llms-full.txt']);
const BASE = manifest.site.url.replace(/\/+$/, '') + '/';
/* ── the date stamped into sitemap <lastmod> / feed <updated> / llms-full's header ────────────
   THE RELEASE DATE, NOT `new Date()`. A wall-clock stamp made this tool NON-DETERMINISTIC: it
   rewrote three committed artifacts every time the calendar rolled over, with no content change — so
   `build-docs --check` goes RED tomorrow on a tree that is perfectly in sync, and a CI drift gate
   built on it would cry wolf every midnight. (That is why the gate could not be wired before: the
   guard would have failed for a reason that is not drift.) It was also DISHONEST: <lastmod> claimed
   every served page was modified on whatever day the build happened to run. The newest
   RELEASE-MANIFEST record is the honest answer to "when did this served tree last change" — the
   suite ships by release — and it is stable between releases, so the artifacts become a pure
   function of committed content. Same doctrine as the Clock Contract's "never fabricate now()" and
   tools/build.mjs's determinism. Never fall back to now(): that re-arms the daily false red. */
const BUILD_DATE = (() => {
  const rel = JSON.parse(readFileSync(join(ROOT, 'RELEASE-MANIFEST.json'), 'utf8')).releases;
  const newest = Array.isArray(rel) && rel.length ? rel[rel.length - 1] : null;
  if (!newest || !/^\d{4}-\d{2}-\d{2}$/.test(newest.date || '')) {
    throw new Error('build-docs: RELEASE-MANIFEST.json carries no dated release record — refusing to stamp a wall-clock date (it would red the deploy drift gate every midnight)');
  }
  return newest.date;
})();
const CHECK = process.argv.includes('--check');
const FORCE_DELINK = process.argv.includes('--force-delink');

// ── walk a dir for files (relative paths) ───────────────────────────────────
function walk(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, base, out);
    else out.push(relative(base, abs).split('\\').join('/'));
  }
  return out;
}
const deployFiles = walk(DEPLOY);
const htmlPages = deployFiles.filter((p) => /\.html$/i.test(p)).sort();
const htmlSet = new Set(htmlPages);

// ── de-link predicate + mechanical transform (proven byte-exact vs the hand de-link) ──
function resolveRel(dir, href) {
  const parts = dir ? dir.split('/') : [];
  for (const seg of href.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg === '.' || seg === '') continue;
    else parts.push(seg);
  }
  return parts.join('/');
}
function isNonPublic(dir, href) {
  const c = href.split('#')[0].split('?')[0];
  if (!c) return false; // pure anchor
  if (/^(https?:)?\/\//i.test(c) || /^mailto:/i.test(c)) return false; // external
  if (/\.md$/i.test(c)) return true; // raw markdown is never a public link
  if (/\.html$/i.test(c)) return !htmlSet.has(resolveRel(dir, c));
  return false; // css/js/img asset — keep
}
function mechanicalDelink(html, dir) {
  return html.replace(/<a\b[^>]*?\bhref="([^"]+)"[^>]*?>([\s\S]*?)<\/a>/gi, (m, href, inner) => (isNonPublic(dir, href) ? `<span class="${DELINK_CLASS}">${inner}</span>` : m));
}
function hasNonPublic(html, dir) {
  return [...html.matchAll(/<a\b[^>]*?\bhref="([^"]+)"[^>]*?>/gi)].some((m) => isNonPublic(dir, m[1]));
}

// ── PHASE 1 — page-body sync ────────────────────────────────────────────────
const log = { copy: [], delink: [], preserve: [], asset: [], stale: [], missingRoot: [], assetNoTwin: [], stamp: [], meta: [] };

// ── PHASE 0 — project roster-derived <head> discovery meta into the guide + content pages ────
//   REPO-DISCOVERABILITY-FOLLOWUPS §5.3/§5.6. suite.manifest.json is the single source; this UPSERTS a
//   marked, roster-derived meta block (description · canonical · OG/Twitter) into each reference guide +
//   content page's <head>, in place at ROOT, so Phase 1a then syncs it to docs/. Idempotent — a
//   `<!-- meta:auto … /meta:auto -->` region is REPLACED, never duplicated — and `--check` reds if the
//   roster moved without a re-run. The front door (index.html) keeps its bespoke hand-authored head; only
//   the uniform guide/content set is generated (so the four surfaces can't drift from the roster).
const metaEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const META_RE = /<!-- meta:auto\b[\s\S]*?<!-- \/meta:auto -->\n?/;
const metaTargets = [
  ...manifest.nodes
    .filter((n) => !n.planned && n.guide)
    .map((n) => ({
      rel: n.guide,
      title: `${n.id} Reference — ${n.signal} · ${manifest.site.name}`,
      desc: `${n.summary} ${n.id} is a local-first ${n.signal} analyzer${n.device && n.device !== '—' ? ` for ${n.device}` : ''} — evidence-graded metrics, 100% in your browser, no upload or account.`
    })),
  ...manifest.content
    .filter((c) => c.description && /\.html$/i.test(c.href) && !c.href.startsWith('papers/'))
    .map((c) => ({ rel: c.href, title: `${c.label} — ${manifest.site.name}`, desc: c.description }))
];
function metaBlock(t) {
  const d = metaEsc(t.desc),
    ti = metaEsc(t.title),
    u = metaEsc(BASE + encodeURI(t.rel)),
    img = `${BASE}tepna-og.png`;
  return [
    '<!-- meta:auto — roster-derived by tools/build-docs.mjs (REPO-DISCOVERABILITY-FOLLOWUPS §5.3/§5.6); do not hand-edit, re-run the builder -->',
    `<meta name="description" content="${d}">`,
    `<link rel="canonical" href="${u}">`,
    '<meta name="theme-color" content="#070A0E">',
    '<meta property="og:type" content="article">',
    '<meta property="og:site_name" content="Tepna">',
    `<meta property="og:title" content="${ti}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:url" content="${u}">`,
    `<meta property="og:image" content="${img}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${ti}">`,
    `<meta name="twitter:description" content="${d}">`,
    `<meta name="twitter:image" content="${img}">`,
    '<!-- /meta:auto -->'
  ].join('\n');
}
function upsertMeta(abs, block) {
  // Inject the block into THIS file's own <head>, preserving the rest of the file byte-for-byte — so a
  // `preserve`d docs twin (editorially de-linked, Phase 1 skips it) still gets the meta without losing
  // its body. Returns true if the file changed (and was written, unless --check).
  if (!existsSync(abs)) return null;
  const orig = readFileSync(abs, 'utf8');
  const next = META_RE.test(orig) ? orig.replace(META_RE, block + '\n') : orig.replace(/<\/head>/i, block + '\n</head>');
  if (next === orig) return false;
  if (!CHECK) writeFileSync(abs, next);
  return true;
}
for (const t of metaTargets) {
  const block = metaBlock(t);
  const rootAbs = join(ROOT, t.rel);
  if (!existsSync(rootAbs)) {
    log.missingRoot.push(t.rel);
    continue;
  }
  // ROOT (source of truth). DEPLOY twin too: Phase 1 propagates it for a normal page, but a `preserve`d
  // page (Science.html) is never re-synced, so inject directly into its own head there as well.
  const rootChanged = upsertMeta(rootAbs, block);
  const docsChanged = upsertMeta(join(DEPLOY, t.rel), block);
  if (rootChanged) {
    if (CHECK) log.stale.push(t.rel);
    else log.meta.push(t.rel);
  }
  if (docsChanged) {
    if (CHECK) log.stale.push('docs/' + t.rel);
  }
}
// A visible, current-version footer stamped into every SERVED page (docs/ only — never the root source
// bundles, whose version-in-bundle stamping stays deferred per CLAUDE.md §📦, since a string in a bundle
// would move its file bytes and force an all-app re-bundle each release). Applied inside syncPage's
// deploy transform, so `docs/ == delink(root) + footer` and `--check` stays consistent; the deploy-drift
// gate then enforces currency for free (bump the version without re-running build-docs → stale footer →
// red). Idempotent: an existing badge is REPLACED, never duplicated. CSP-safe (inline style is permitted;
// there is no script), pointer-events:none so it never covers a control.
const _VER_FOOTER_RE = /\n?<div data-tepna-ver\b[^>]*>[\s\S]*?<\/div>(?=\s*<\/body>)/i;
function withFooter(html) {
  const badge =
    `\n<div data-tepna-ver style="position:fixed;right:6px;bottom:4px;z-index:2147483000;` +
    `font:400 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#7a8699;opacity:.45;` +
    `pointer-events:none;user-select:none" title="Tepna suite version">v${manifest.version}</div>`;
  if (_VER_FOOTER_RE.test(html)) return html.replace(_VER_FOOTER_RE, badge);
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, badge + '\n</body>');
  return html;                              // a fragment with no </body> — nothing to anchor to, leave it
}

function syncPage(rel) {
  const rootAbs = join(ROOT, rel);
  const docsAbs = join(DEPLOY, rel);
  if (!existsSync(rootAbs)) {
    log.missingRoot.push(rel);
    return;
  } // docs-only page (no source) — leave
  const dir = rel.includes('/') ? rel.split('/').slice(0, -1).join('/') : '';
  const root = readFileSync(rootAbs, 'utf8');
  const base = rel.split('/').pop();
  const preserved = PRESERVE.has(base) || PRESERVE.has(rel);
  let desired;
  if (preserved && !FORCE_DELINK) {
    // preserve editorial de-link; only warn if root drifted from a mechanical baseline
    const cur = existsSync(docsAbs) ? readFileSync(docsAbs, 'utf8') : '';
    if (hasNonPublic(root, dir)) log.preserve.push(rel);
    if (mechanicalDelink(root, dir) !== cur && CHECK) {
      /* editorial divergence is expected; not counted stale */
    }
    const stamped = withFooter(cur);         // the version footer still applies to a preserved twin
    if (stamped !== cur) {
      if (CHECK) log.stale.push('docs/' + rel);
      else writeFileSync(docsAbs, stamped);
    }
    return;
  }
  desired = withFooter(hasNonPublic(root, dir) ? mechanicalDelink(root, dir) : root);
  const cur = existsSync(docsAbs) ? readFileSync(docsAbs, 'utf8') : null;
  const kind = desired === root ? log.copy : log.delink;
  if (cur !== desired) {
    if (CHECK) {
      log.stale.push(rel);
    } else {
      writeFileSync(docsAbs, desired);
      kind.push(rel);
    }
  }
}
for (const rel of htmlPages) syncPage(rel);

// ── PHASE 1b — asset sync (css / js / images: byte-compare, copy on drift) ───
const assetFiles = deployFiles.filter((p) => !/\.(html|md)$/i.test(p) && p !== '.nojekyll' && !ARTIFACT_NAMES.has(p));
function syncAsset(rel) {
  const rootAbs = join(ROOT, rel),
    docsAbs = join(DEPLOY, rel);
  if (!existsSync(rootAbs)) {
    log.assetNoTwin.push(rel);
    return;
  } // docs-only / generated — leave
  const a = readFileSync(rootAbs);
  const b = existsSync(docsAbs) ? readFileSync(docsAbs) : null;
  if (b && a.equals(b)) return; // in-sync (byte-identical)
  if (CHECK) log.stale.push(rel);
  else {
    copyFileSync(rootAbs, docsAbs);
    log.asset.push(rel);
  }
}
for (const rel of assetFiles) syncAsset(rel);

// ── VERSION STAMP RULES — declared HERE, above Phase 2, because Phase 2 CONSUMES them ───────
//   The rules are APPLIED by Phase 3 below (writing README + both index.html twins); they are declared
//   this early because llms-full.txt (a Phase-2 artifact) CONCATENATES README.md — a Phase-3 stamp
//   target. Generating that artifact from README's on-disk bytes made the run ORDER-DEPENDENT: Phase 2
//   read the version the PREVIOUS run had stamped, so a single `node tools/build-docs.mjs` left
//   llms-full.txt one release behind and `--check` then reported it STALE until you ran the writer a
//   second time. (Seen for real at v1.10.1: the artifact still read `Suite version: 1.10.0` while
//   Phase 3 had just stamped 1.10.1 into README.) Phase 2 now derives its text through applyStamp(),
//   so every artifact is a pure function of (source text, canonical version) and ONE pass settles.
//   Keep this invariant if you add an artifact that embeds a stamped file: stamp the text, don't
//   re-read the file. Phase NUMBERS are stable identities (briefs cite "build-docs Phase 3") — this
//   moves the DECLARATION, not the phase.
const VERSION = manifest.version;
const stampRules = [
  ['README.md', [[/(\*\*Suite version:\*\*\s*)\d+\.\d+\.\d+/g, `$1${VERSION}`]]],
  [
    'index.html',
    [
      [/("softwareVersion":\s*")\d+\.\d+\.\d+(")/g, `$1${VERSION}$2`],
      [/(Michal Planicka · Apache-2\.0 · v)\d+\.\d+\.\d+/g, `$1${VERSION}`]
    ]
  ],
  [
    'docs/index.html',
    [
      [/("softwareVersion":\s*")\d+\.\d+\.\d+(")/g, `$1${VERSION}$2`],
      [/(Michal Planicka · Apache-2\.0 · v)\d+\.\d+\.\d+/g, `$1${VERSION}`]
    ]
  ]
];
/* the canonical version projected INTO a source file's text (no disk read, no write) */
const applyStamp = (rel, txt) => {
  const rule = stampRules.find(([f]) => f === rel);
  if (!rule) return txt;
  let out = txt;
  for (const [re, repl] of rule[1]) out = out.replace(re, repl);
  return out;
};

// ── PHASE 2 — discoverability artifacts (regenerate off the synced page set) ─
const encPath = (p) => encodeURI(p).replace(/&/g, '&amp;');
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pageTitle = (rel) => {
  try {
    const m = readFileSync(join(DEPLOY, rel), 'utf8').match(/<title>([^<]*)<\/title>/i);
    return m ? m[1].trim() : rel;
  } catch {
    return rel;
  }
};
const live = manifest.nodes.filter((n) => !n.planned);

function buildSitemap() {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    htmlPages.map((p) => `  <url>\n    <loc>${BASE + (p === 'index.html' ? '' : encPath(p))}</loc>\n    <lastmod>${BUILD_DATE}</lastmod>\n  </url>`).join('\n') +
    `\n</urlset>\n`
  );
}
function buildRobots() {
  return `# ${manifest.site.brand}\n# tepna.net is a public deployment (also fully usable offline). Index freely.\nUser-agent: *\nAllow: /\n\nSitemap: ${BASE}sitemap.xml\n`;
}
function buildFeed() {
  const papers = htmlPages.filter((p) => p.startsWith('papers/') && p !== 'papers/papers.html');
  const entries = papers.map((p) => {
    const u = BASE + encPath(p);
    return `  <entry>\n    <title>${xmlEsc(pageTitle(p))}</title>\n    <link href="${u}"/>\n    <id>${u}</id>\n    <updated>${BUILD_DATE}T00:00:00Z</updated>\n  </entry>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title>${xmlEsc(manifest.site.name)} — working preprints</title>\n  <link href="${BASE}papers/papers.html"/>\n  <link rel="self" href="${BASE}feed.xml"/>\n  <id>${BASE}papers/papers.html</id>\n  <updated>${BUILD_DATE}T00:00:00Z</updated>\n  <author><name>${xmlEsc(manifest.site.author)}</name></author>\n${entries.join('\n')}\n</feed>\n`;
}
function buildAbout() {
  return (
    JSON.stringify(
      {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: manifest.site.name,
        alternateName: manifest.site.brand,
        applicationCategory: 'HealthApplication',
        operatingSystem: 'Any (modern web browser)',
        softwareVersion: manifest.version,
        url: manifest.site.url,
        codeRepository: manifest.site.repo,
        description: manifest.site.description,
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        license: manifest.site.licenseUrl,
        author: { '@type': 'Person', name: manifest.site.author },
        disclaimer: manifest.site.intendedUse,
        featureList: ['100% local — no network, no upload, no account', 'Evidence-graded metrics (every number carries a trust badge)', ...live.map((n) => `${n.id}: ${n.signal} — ${n.summary}`)],
        softwareHelp: live.map((n) => ({ '@type': 'WebPage', name: `${n.id} technical reference`, url: manifest.site.url + encodeURI(n.guide) }))
      },
      null,
      2
    ) + '\n'
  );
}
function buildLlms() {
  const L = [
    `# ${manifest.site.name}`,
    '',
    `> ${manifest.site.description}`,
    '',
    `Repository: ${manifest.site.repo} · License: ${manifest.site.license} · Author: ${manifest.site.author}`,
    '',
    '## Reference guides (per node)'
  ];
  for (const n of live) L.push(`- [${n.id}](${manifest.site.url}${encodeURI(n.guide)}): ${n.signal} — ${n.summary}`);
  L.push('', '## Overview');
  for (const c of manifest.content) L.push(`- [${c.label}](${manifest.site.url}${encodeURI(c.href)})`);
  L.push('', '## Authoritative context (source repository)');
  for (const d of manifest.authoritativeContext) L.push(`- [${d.title}](${manifest.site.repo}/blob/main/${encodeURI(d.repoPath)}): ${d.note}`);
  L.push('', `Full concatenated context: ${manifest.site.url}llms-full.txt`, '');
  return L.join('\n');
}
function buildLlmsFull() {
  let out = `# ${manifest.site.brand} — concatenated authoritative context\n# Generated ${BUILD_DATE}. Public docs only (the internal build/gate constitution CLAUDE.md is intentionally excluded).\n\n`;
  for (const d of manifest.authoritativeContext) {
    let body;
    try {
      // STAMPED, not raw-from-disk. README.md is BOTH an authoritativeContext source AND a Phase-3
      // stamp target, so reading its bytes here would fold in whatever version the PREVIOUS run left
      // behind — see the applyStamp header note. Stamping the text we concatenate makes this artifact
      // a pure function of (source text, canonical version), independent of phase order.
      body = applyStamp(d.repoPath, readFileSync(join(ROOT, d.repoPath), 'utf8'));
    } catch {
      body = `(not found: ${d.repoPath})`;
    }
    out += `\n\n${'='.repeat(78)}\n# ${d.title} — ${d.repoPath}\n${'='.repeat(78)}\n\n${body}`;
  }
  return out;
}
const artifacts = { 'sitemap.xml': buildSitemap(), 'robots.txt': buildRobots(), 'feed.xml': buildFeed(), 'about.json': buildAbout(), 'llms.txt': buildLlms(), 'llms-full.txt': buildLlmsFull() };

/* Every repo path a release run of this tool can rewrite: the generated artifacts under the deploy
   dir, plus every Phase-3 version-stamp target (README.md, index.html and its docs/ twin).
   Derived from the SAME `artifacts` map and `stampRules` the run uses — not a second list — so a
   new artifact or stamp target is covered the moment it is added there.
   Deliberately lists every MANAGED path, not only the ones that changed this run: `git add` on an
   unchanged file is a no-op, and listing only the changed set makes the line non-idempotent (run
   the tool twice and the second, shorter list silently drops the first run's files). Quoted where
   a path contains a space so the line pastes as-is. Explicit paths; never `git add -A` (§👥.2). */
function releaseSurfaces() {
  const q = (p) => (/\s/.test(p) ? `"${p}"` : p);
  return [...Object.keys(artifacts).map((n) => `${DEPLOY_REL}/${n}`), ...stampRules.map(([rel]) => rel)].sort().map(q);
}
for (const [name, content] of Object.entries(artifacts)) {
  const dest = join(DEPLOY, name);
  const cur = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
  if (cur !== content) {
    if (CHECK) log.stale.push(name);
    else writeFileSync(dest, content);
  }
}

// ── PHASE 3 — project suite.manifest.json version into the human/discovery surfaces ─────────
//   CONTROLLED-RELEASES-FOLLOWUPS F2. suite.manifest.json is canonical (release.mjs stamps it +
//   CITATION.cff); this projects that ONE version into README + index.html (root & docs twin) so the
//   release-ledger check-6 stamp-parity gate has real surfaces to compare. Each rule UPDATES an existing
//   marker's number in place — it never INSERTS a marker (introduce a new marker by hand once, then this
//   maintains it), so a surface that lost its marker stays lost and check-6 reds it as `unstamped`.
//   VERSION / stampRules / applyStamp are declared ABOVE Phase 2 (which consumes them); this phase is
//   where they are WRITTEN to disk.
for (const [rel] of stampRules) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    log.missingRoot.push(rel);
    continue;
  }
  const orig = readFileSync(abs, 'utf8');
  const txt = applyStamp(rel, orig);
  if (txt !== orig) {
    if (CHECK) log.stale.push(rel);
    else {
      writeFileSync(abs, txt);
      log.stamp.push(rel);
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────────
if (CHECK) {
  if (log.stale.length) {
    console.error(`STALE (${log.stale.length}): ${log.stale.join(', ')}`);
    console.error('run: node tools/build-docs.mjs');
    process.exit(1);
  }
  console.log(
    `docs/ current — ${htmlPages.length} pages, ${assetFiles.length} assets, ${Object.keys(artifacts).length} artifacts, ${log.preserve.length} preserved (${[...PRESERVE].join(', ') || 'none'})`
  );
} else {
  console.log(`Phase 0 (head meta): projected roster meta into ${log.meta.length} guide/content page(s)${log.meta.length ? ' (' + log.meta.length + ' updated)' : ' (all current)'}`);
  console.log(`Phase 1a (pages):  copied ${log.copy.length}, de-linked ${log.delink.length}, preserved ${log.preserve.length} (${[...PRESERVE].join(', ') || 'none'})`);
  if (log.preserve.length) console.log(`  ⚠ preserved (editorial de-link — re-apply manually if you edited its source, or --force-delink): ${log.preserve.join(', ')}`);
  console.log(`Phase 1b (assets): synced ${log.asset.length} of ${assetFiles.length} (css/js/img)`);
  console.log(`Phase 2 (artifacts): (re)generated ${Object.keys(artifacts).length}`);
  console.log(`Phase 3 (version stamp): projected v${VERSION} into ${log.stamp.length} surface(s)${log.stamp.length ? ' (' + log.stamp.join(', ') + ')' : ''}`);
  // ── what to stage ───────────────────────────────────────────────────────────
  //   This tool is the ONLY place that knows which paths it writes, so it is the only honest place
  //   to print the stage list. tools/release.mjs used to carry a hand-maintained copy, and it had
  //   drifted: it omitted sitemap.xml / feed.xml / llms-full.txt and docs/index.html. Following it
  //   literally produced a release commit missing four files that this run had just rewritten —
  //   and `--check` could not catch it, because --check reads the WORKING TREE (where they were
  //   already correct) while CI checks out the COMMIT (where they were absent).
  //   Derived from the same `artifacts` map and `log.stamp` the run actually used, so adding an
  //   artifact cannot silently fall out of the list. Explicit paths, never `git add -A` (§👥.2).
  console.log(`\nStage exactly what this run wrote:\n    git add ${releaseSurfaces().join(' ')}`);
}
