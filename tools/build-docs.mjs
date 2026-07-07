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
const BUILD_DATE = new Date().toISOString().slice(0, 10);
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
  if (!c) return false;                                        // pure anchor
  if (/^(https?:)?\/\//i.test(c) || /^mailto:/i.test(c)) return false; // external
  if (/\.md$/i.test(c)) return true;                           // raw markdown is never a public link
  if (/\.html$/i.test(c)) return !htmlSet.has(resolveRel(dir, c));
  return false;                                                // css/js/img asset — keep
}
function mechanicalDelink(html, dir) {
  return html.replace(/<a\b[^>]*?\bhref="([^"]+)"[^>]*?>([\s\S]*?)<\/a>/gi,
    (m, href, inner) => (isNonPublic(dir, href) ? `<span class="${DELINK_CLASS}">${inner}</span>` : m));
}
function hasNonPublic(html, dir) {
  return [...html.matchAll(/<a\b[^>]*?\bhref="([^"]+)"[^>]*?>/gi)].some((m) => isNonPublic(dir, m[1]));
}

// ── PHASE 1 — page-body sync ────────────────────────────────────────────────
<<<<<<< HEAD
const log = { copy: [], delink: [], preserve: [], asset: [], stale: [], missingRoot: [], assetNoTwin: [] };
=======
const log = { copy: [], delink: [], preserve: [], asset: [], stale: [], missingRoot: [], assetNoTwin: [], stamp: [] };
>>>>>>> cf3e242 (Tepna suite)
function syncPage(rel) {
  const rootAbs = join(ROOT, rel);
  const docsAbs = join(DEPLOY, rel);
  if (!existsSync(rootAbs)) { log.missingRoot.push(rel); return; }   // docs-only page (no source) — leave
  const dir = rel.includes('/') ? rel.split('/').slice(0, -1).join('/') : '';
  const root = readFileSync(rootAbs, 'utf8');
  const base = rel.split('/').pop();
  const preserved = PRESERVE.has(base) || PRESERVE.has(rel);
  let desired;
  if (preserved && !FORCE_DELINK) {
    // preserve editorial de-link; only warn if root drifted from a mechanical baseline
    const cur = existsSync(docsAbs) ? readFileSync(docsAbs, 'utf8') : '';
    if (hasNonPublic(root, dir)) log.preserve.push(rel);
    if (mechanicalDelink(root, dir) !== cur && CHECK) { /* editorial divergence is expected; not counted stale */ }
    return;
  }
  desired = hasNonPublic(root, dir) ? mechanicalDelink(root, dir) : root;
  const cur = existsSync(docsAbs) ? readFileSync(docsAbs, 'utf8') : null;
  const kind = (desired === root) ? log.copy : log.delink;
  if (cur !== desired) {
    if (CHECK) { log.stale.push(rel); }
    else { writeFileSync(docsAbs, desired); kind.push(rel); }
  }
}
for (const rel of htmlPages) syncPage(rel);

// ── PHASE 1b — asset sync (css / js / images: byte-compare, copy on drift) ───
const assetFiles = deployFiles.filter((p) => !/\.(html|md)$/i.test(p) && p !== '.nojekyll' && !ARTIFACT_NAMES.has(p));
function syncAsset(rel) {
  const rootAbs = join(ROOT, rel), docsAbs = join(DEPLOY, rel);
  if (!existsSync(rootAbs)) { log.assetNoTwin.push(rel); return; }   // docs-only / generated — leave
  const a = readFileSync(rootAbs);
  const b = existsSync(docsAbs) ? readFileSync(docsAbs) : null;
  if (b && a.equals(b)) return;                                      // in-sync (byte-identical)
  if (CHECK) log.stale.push(rel);
  else { copyFileSync(rootAbs, docsAbs); log.asset.push(rel); }
}
for (const rel of assetFiles) syncAsset(rel);

// ── PHASE 2 — discoverability artifacts (regenerate off the synced page set) ─
const encPath = (p) => encodeURI(p).replace(/&/g, '&amp;');
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pageTitle = (rel) => { try { const m = readFileSync(join(DEPLOY, rel), 'utf8').match(/<title>([^<]*)<\/title>/i); return m ? m[1].trim() : rel; } catch { return rel; } };
const live = manifest.nodes.filter((n) => !n.planned);

function buildSitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    htmlPages.map((p) => `  <url>\n    <loc>${BASE + (p === 'index.html' ? '' : encPath(p))}</loc>\n    <lastmod>${BUILD_DATE}</lastmod>\n  </url>`).join('\n') +
    `\n</urlset>\n`;
}
function buildRobots() {
  return `# ${manifest.site.brand}\n# tepna.net is a public deployment (also fully usable offline). Index freely.\nUser-agent: *\nAllow: /\n\nSitemap: ${BASE}sitemap.xml\n`;
}
function buildFeed() {
  const papers = htmlPages.filter((p) => p.startsWith('papers/') && p !== 'papers/papers.html');
  const entries = papers.map((p) => { const u = BASE + encPath(p); return `  <entry>\n    <title>${xmlEsc(pageTitle(p))}</title>\n    <link href="${u}"/>\n    <id>${u}</id>\n    <updated>${BUILD_DATE}T00:00:00Z</updated>\n  </entry>`; });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title>${xmlEsc(manifest.site.name)} — working preprints</title>\n  <link href="${BASE}papers/papers.html"/>\n  <link rel="self" href="${BASE}feed.xml"/>\n  <id>${BASE}papers/papers.html</id>\n  <updated>${BUILD_DATE}T00:00:00Z</updated>\n  <author><name>${xmlEsc(manifest.site.author)}</name></author>\n${entries.join('\n')}\n</feed>\n`;
}
function buildAbout() {
  return JSON.stringify({
    '@context': 'https://schema.org', '@type': 'SoftwareApplication',
    name: manifest.site.name, alternateName: manifest.site.brand,
    applicationCategory: 'HealthApplication', operatingSystem: 'Any (modern web browser)',
<<<<<<< HEAD
=======
    softwareVersion: manifest.version,
>>>>>>> cf3e242 (Tepna suite)
    url: manifest.site.url, codeRepository: manifest.site.repo, description: manifest.site.description,
    isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    license: manifest.site.licenseUrl, author: { '@type': 'Person', name: manifest.site.author },
    disclaimer: manifest.site.intendedUse,
    featureList: ['100% local — no network, no upload, no account', 'Evidence-graded metrics (every number carries a trust badge)', ...live.map((n) => `${n.id}: ${n.signal} — ${n.summary}`)],
    softwareHelp: live.map((n) => ({ '@type': 'WebPage', name: `${n.id} technical reference`, url: manifest.site.url + encodeURI(n.guide) }))
  }, null, 2) + '\n';
}
function buildLlms() {
  const L = [`# ${manifest.site.name}`, '', `> ${manifest.site.description}`, '', `Repository: ${manifest.site.repo} · License: ${manifest.site.license} · Author: ${manifest.site.author}`, '', '## Reference guides (per node)'];
  for (const n of live) L.push(`- [${n.id}](${manifest.site.url}${encodeURI(n.guide)}): ${n.signal} — ${n.summary}`);
  L.push('', '## Overview'); for (const c of manifest.content) L.push(`- [${c.label}](${manifest.site.url}${encodeURI(c.href)})`);
  L.push('', '## Authoritative context (source repository)'); for (const d of manifest.authoritativeContext) L.push(`- [${d.title}](${manifest.site.repo}/blob/main/${encodeURI(d.repoPath)}): ${d.note}`);
  L.push('', `Full concatenated context: ${manifest.site.url}llms-full.txt`, '');
  return L.join('\n');
}
function buildLlmsFull() {
  let out = `# ${manifest.site.brand} — concatenated authoritative context\n# Generated ${BUILD_DATE}. Public docs only (the internal build/gate constitution CLAUDE.md is intentionally excluded).\n\n`;
  for (const d of manifest.authoritativeContext) { let body; try { body = readFileSync(join(ROOT, d.repoPath), 'utf8'); } catch { body = `(not found: ${d.repoPath})`; } out += `\n\n${'='.repeat(78)}\n# ${d.title} — ${d.repoPath}\n${'='.repeat(78)}\n\n${body}`; }
  return out;
}
const artifacts = { 'sitemap.xml': buildSitemap(), 'robots.txt': buildRobots(), 'feed.xml': buildFeed(), 'about.json': buildAbout(), 'llms.txt': buildLlms(), 'llms-full.txt': buildLlmsFull() };
for (const [name, content] of Object.entries(artifacts)) {
  const dest = join(DEPLOY, name);
  const cur = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
  if (cur !== content) { if (CHECK) log.stale.push(name); else writeFileSync(dest, content); }
}

<<<<<<< HEAD
=======
// ── PHASE 3 — project suite.manifest.json version into the human/discovery surfaces ─────────
//   CONTROLLED-RELEASES-FOLLOWUPS F2. suite.manifest.json is canonical (release.mjs stamps it +
//   CITATION.cff); this projects that ONE version into README + index.html (root & docs twin) so the
//   release-ledger check-6 stamp-parity gate has real surfaces to compare. Each rule UPDATES an existing
//   marker's number in place — it never INSERTS a marker (introduce a new marker by hand once, then this
//   maintains it), so a surface that lost its marker stays lost and check-6 reds it as `unstamped`.
const VERSION = manifest.version;
const stampRules = [
  ['README.md',       [[/(\*\*Suite version:\*\*\s*)\d+\.\d+\.\d+/g, `$1${VERSION}`]]],
  ['index.html',      [[/("softwareVersion":\s*")\d+\.\d+\.\d+(")/g, `$1${VERSION}$2`], [/(Michal Planicka · Apache-2\.0 · v)\d+\.\d+\.\d+/g, `$1${VERSION}`]]],
  ['docs/index.html', [[/("softwareVersion":\s*")\d+\.\d+\.\d+(")/g, `$1${VERSION}$2`], [/(Michal Planicka · Apache-2\.0 · v)\d+\.\d+\.\d+/g, `$1${VERSION}`]]],
];
for (const [rel, subs] of stampRules) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) { log.missingRoot.push(rel); continue; }
  const orig = readFileSync(abs, 'utf8');
  let txt = orig;
  for (const [re, repl] of subs) txt = txt.replace(re, repl);
  if (txt !== orig) { if (CHECK) log.stale.push(rel); else { writeFileSync(abs, txt); log.stamp.push(rel); } }
}

>>>>>>> cf3e242 (Tepna suite)
// ── report ──────────────────────────────────────────────────────────────────
if (CHECK) {
  if (log.stale.length) { console.error(`STALE (${log.stale.length}): ${log.stale.join(', ')}`); console.error('run: node tools/build-docs.mjs'); process.exit(1); }
  console.log(`docs/ current — ${htmlPages.length} pages, ${assetFiles.length} assets, ${Object.keys(artifacts).length} artifacts, ${log.preserve.length} preserved (${[...PRESERVE].join(', ') || 'none'})`);
} else {
  console.log(`Phase 1a (pages):  copied ${log.copy.length}, de-linked ${log.delink.length}, preserved ${log.preserve.length} (${[...PRESERVE].join(', ') || 'none'})`);
  if (log.preserve.length) console.log(`  ⚠ preserved (editorial de-link — re-apply manually if you edited its source, or --force-delink): ${log.preserve.join(', ')}`);
  console.log(`Phase 1b (assets): synced ${log.asset.length} of ${assetFiles.length} (css/js/img)`);
  console.log(`Phase 2 (artifacts): (re)generated ${Object.keys(artifacts).length}`);
<<<<<<< HEAD
=======
  console.log(`Phase 3 (version stamp): projected v${VERSION} into ${log.stamp.length} surface(s)${log.stamp.length ? ' (' + log.stamp.join(', ') + ')' : ''}`);
>>>>>>> cf3e242 (Tepna suite)
}
