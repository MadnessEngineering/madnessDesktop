#!/usr/bin/env node
// Git Archaeology: commit miner. LOCAL ONLY. Output -> ~/.cache/madness-archaeology (never commit/send it).
//
// autoStream rules (chosen after sampling real subjects across all repos). A commit is "auto" (machine/ritual
// noise, excluded from human friction stats) if ANY of:
//   R1 /^chore\(themes\)/ or /regenerate theme/i                      theme regen after a MadnessThemes bump
//   R2 version/submodule pointer ritual: /^chore\(release\): bump to \d/, /^(update|bump) madness-themes/,
//      /^chore: bump .* submodule/, /^update (swarmdesk|elementalalloy|madnessvr|subrepos|guardian)( to latest)?$/i
//   R3 repo path contains /cursor_chathistory (history dump repo; every commit is a sync)
//   R4 /^auto-commit:/i in any repo (the ~5k "auto-commit: updated N files (...)" watcher), or in /Anathesmelt
//      subjects starting auto|sync|snapshot|backup|checkpoint|session|update (claude|cursor|config|history|chat)
//   R5 generic template detector: per repo (>=10 commits) normalise subjects (hex/digits -> #); if the single most
//      common template covers >80% of the repo's commits, every commit with that template is auto
//   R6 Replit platform subjects: saved progress at the end of the loop | published your app | transitioned from
//      ... mode | saved your changes before starting work | git commit prior to merge | pre-sync checkpoint |
//      restored to '...' | content-free marker | post-merge setup completed | exactly "Visual edit".
//      (NOT identity-based: the Replit TheMadTinker identity also authored real human feat/fix commits.)
// Merges ("Merge branch ...") stay HUMAN (isMerge flag is recorded); ambiguous subjects like "save" stay human.
// Identity rule: name+email must match /edens|danedens|madtinker|madness/i. A bare "dan" is NOT used (matches Dan Sheahan, Dan Croak...).
import { writeFileSync, mkdirSync } from 'node:fs';
import { findRepos, repoKind, isWorktreeCopy, git, OUT_DIR, SINCE } from './lib.mjs';

const t0 = Date.now();
mkdirSync(OUT_DIR, { recursive: true });
const repos = findRepos().sort((a, b) => isWorktreeCopy(a) - isWorktreeCopy(b) || a.length - b.length);

// ---- 1. identity census ----
const census = new Map();
for (const r of repos) {
  const o = git(r, ['log', '--all', `--since=${SINCE}`, '--format=%an\x1f%ae']);
  if (!o) continue;
  for (const l of o.split('\n')) if (l) census.set(l, (census.get(l) || 0) + 1);
}
const isDan = (name, email) => /edens|danedens|madtinker|madness/i.test(name + ' ' + email);
const ranked = [...census].sort((a, b) => b[1] - a[1]);
console.log('Top 15 author identities since', SINCE);
for (const [k, n] of ranked.slice(0, 15)) console.log(`  ${n}\t${k.replace('\x1f', ' <')}>${isDan(...k.split('\x1f')) ? '  [DAN]' : ''}`);
const danSet = ranked.filter(([k]) => isDan(...k.split('\x1f'))).map(([k, n]) => ({ identity: k.replace('\x1f', ' <') + '>', commits: n }));
console.log('CHOSEN Dan identities:'); danSet.forEach(d => console.log(`  ${d.commits}\t${d.identity}`));

// ---- 2. per-repo log ----
const FMT = '\x1e%H\x1f%P\x1f%an\x1f%ae\x1f%aI\x1f%s\x1f%b\x1f';
const AI_RE = /Claude-Session|Co-Authored-By:\s*Claude|Generated with|claude\.ai\/code|noreply@anthropic\.com|Co-authored-by:.*(Claude|Copilot|Gemini|Codex)/i;
const rawByRepo = new Map(); let raw = 0;
const bySha = new Map();
for (const r of repos) {
  const o = git(r, ['log', '--all', `--since=${SINCE}`, '-i', '-E', '--author=edens|madtinker|madness', '--numstat', `--format=${FMT}`]);
  if (!o) continue;
  for (const rec of o.split('\x1e')) {
    if (!rec.trim()) continue;
    const parts = rec.split('\x1f');
    if (parts.length < 7) continue;
    const [sha, parents, an, ae, date, subject, body] = parts;
    if (!isDan(an, ae)) continue;
    raw++;
    rawByRepo.set(r, (rawByRepo.get(r) || 0) + 1);
    const prev = bySha.get(sha);
    if (prev) { prev.alsoIn++; continue; }
    let ins = 0, del = 0; const files = [];
    for (const l of parts[7].split('\n')) {
      const m = l.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      files.push(m[3]); if (m[1] !== '-') ins += +m[1]; if (m[2] !== '-') del += +m[2];
    }
    const ct = subject.match(/^(\w+)(\([^)]*\))?!?:/);
    bySha.set(sha, {
      sha, repo: r, repoKind: repoKind(r), date, identity: `${an} <${ae}>`, subject,
      isMerge: parents.trim().split(/\s+/).filter(Boolean).length > 1,
      files: files.length, ins, del,
      aiAssisted: AI_RE.test(body),
      conventionalType: ct ? ct[1].toLowerCase() : null,
      alsoIn: 0, _files: files,
    });
  }
}
const rows = [...bySha.values()];

// ---- 3. autoStream ----
const norm = s => s.toLowerCase().replace(/[0-9a-f]{7,40}/g, '#').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
const byRepoRows = new Map();
for (const c of rows) (byRepoRows.get(c.repo) || byRepoRows.set(c.repo, []).get(c.repo)).push(c);
const templateRepos = new Map(); // repo -> auto template
for (const [r, cs] of byRepoRows) {
  if (cs.length < 10) continue;
  const h = new Map(); for (const c of cs) h.set(norm(c.subject), (h.get(norm(c.subject)) || 0) + 1);
  const [t, n] = [...h].sort((a, b) => b[1] - a[1])[0];
  if (n / cs.length > 0.8) templateRepos.set(r, t);
}
const autoRule = c => {
  const s = c.subject;
  if (/^chore\(themes\)/i.test(s) || /regenerate theme/i.test(s)) return 'R1';
  if (/^(update|bump) madness-themes\b/i.test(s) || /^chore\(release\): bump to \d/i.test(s)) return 'R2';
  if (/^chore: bump .* submodule/i.test(s) || /^update (swarmdesk|elementalalloy|madnessvr|subrepos|guardian)( to latest)?$/i.test(s)) return 'R2';
  if (c.repo.includes('/cursor_chathistory')) return 'R3';
  if (/^auto-commit:/i.test(s)) return 'R4';
  if (/^(saved progress at the end of the loop|published your app|transitioned from .* mode|saved your changes before starting work|git commit prior to merge|pre-sync checkpoint|restored to '|post-merge setup completed|visual edit$)/i.test(s) || /content-free marker/i.test(s)) return 'R6';
  if (c.repo.includes('/Anathesmelt') && /^(auto|sync|snapshot|backup|checkpoint|session|update (claude|cursor|config|history|chat))/i.test(s)) return 'R4';
  if (templateRepos.get(c.repo) === norm(s)) return 'R5';
  return null;
};
const ruleHits = {};
for (const c of rows) { const k = autoRule(c); c.autoStream = !!k; c._rule = k; if (k) ruleHits[k] = (ruleHits[k] || 0) + 1; }

// ---- 4. outputs ----
const strip = ({ _files, _rule, ...rest }) => rest;
writeFileSync(`${OUT_DIR}/commits.jsonl`, rows.map(c => JSON.stringify(strip(c))).join('\n') + '\n');

const human = rows.filter(c => !c.autoStream);
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const byKind = {}, byMonth = {}, typeHist = {}, byRepoHuman = {};
for (const c of rows) { inc(byKind, c.repoKind + (c.autoStream ? ':auto' : ':human')); inc(byMonth, c.date.slice(0, 7) + (c.autoStream ? ':auto' : ':human')); }
for (const c of human) { inc(typeHist, c.conventionalType || '(none)'); inc(byRepoHuman, c.repo); }
const FRICTION_RE = /fix typo|\boops\b|\bwip\b|fixup!|squash!|\bamend|\bforgot|\bactually\b|\bagain\b|try again|revert/i;
const hs = [...human].sort((a, b) => new Date(a.date) - new Date(b.date));
const byRepoSorted = new Map();
for (const c of hs) (byRepoSorted.get(c.repo) || byRepoSorted.set(c.repo, []).get(c.repo)).push(c);
let reverts = 0, sloppy = 0, quickOverlap = 0, fixAfterFeat = 0;
const isFix = c => c.conventionalType === 'fix' || /^fix\b/i.test(c.subject);
const isFeat = c => c.conventionalType === 'feat' || /^(add|feat)\b/i.test(c.subject);
for (const c of hs) { if (/^revert/i.test(c.subject)) reverts++; if (FRICTION_RE.test(c.subject)) sloppy++; }
for (const cs of byRepoSorted.values()) {
  for (let i = 1; i < cs.length; i++) {
    const a = cs[i - 1], b = cs[i];
    const dt = (new Date(b.date) - new Date(a.date)) / 60000;
    if (dt < 3 && a._files.some(f => b._files.includes(f))) quickOverlap++;
  }
  // fix following a feat within 30 min (each fix counted once)
  for (let i = 0; i < cs.length; i++) {
    if (!isFix(cs[i])) continue;
    const t = new Date(cs[i].date);
    for (let j = i - 1; j >= 0; j--) {
      if ((t - new Date(cs[j].date)) / 60000 > 30) break;
      if (isFeat(cs[j])) { fixAfterFeat++; break; }
    }
  }
}
const summary = {
  generatedAt: new Date().toISOString(), since: SINCE,
  danIdentities: danSet,
  rawCount: raw, uniqueCount: rows.length, worktreeDupesRemoved: raw - rows.length,
  repoCountScanned: repos.length,
  auto: rows.length - human.length, human: human.length, autoRuleHits: ruleHits,
  templateRepos: Object.fromEntries([...templateRepos].map(([r, t]) => [r, t])),
  byRepoKind: byKind, byMonth: Object.fromEntries(Object.entries(byMonth).sort()),
  aiAssistedShare: { all: +(rows.filter(c => c.aiAssisted).length / rows.length).toFixed(3), human: +(human.filter(c => c.aiAssisted).length / human.length).toFixed(3) },
  conventionalTypeHistogramHuman: Object.fromEntries(Object.entries(typeHist).sort((a, b) => b[1] - a[1])),
  top20ReposByHumanCommits: Object.entries(byRepoHuman).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([repo, n]) => ({ repo, kind: repoKind(repo), humanCommits: n })),
  frictionHumanOnly: { reverts, sloppySubjects: sloppy, sameRepoUnder3minOverlappingFiles: quickOverlap, fixAfterFeatWithin30min: fixAfterFeat },
  elapsedSec: +((Date.now() - t0) / 1000).toFixed(1),
};
writeFileSync(`${OUT_DIR}/commits-summary.json`, JSON.stringify(summary, null, 2));
console.log(`done in ${summary.elapsedSec}s: raw=${raw} unique=${rows.length} human=${human.length} auto=${rows.length - human.length}`);
