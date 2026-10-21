#!/usr/bin/env node
// Git Archaeology: reflog miner. LOCAL ONLY. Output -> ~/.cache/madness-archaeology (never commit/send it).
// Counting rules: HEAD reflog is the source of truth for actions (branch reflogs duplicate it). From refs/heads/*
// we additionally keep only "branch:" entries (Created/renamed, which HEAD never records) and use "commit (amend)"
// entries for amend chains (they carry the branch name). Worktree copies contribute only their own HEAD.
// push is not in the reflog. Reflog retention defaults to 90 days (gc.reflogExpire), so months older than that are partial.
import { writeFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { findRepos, repoKind, isWorktreeCopy, git, OUT_DIR, SINCE } from './lib.mjs';

const t0 = Date.now();
mkdirSync(OUT_DIR, { recursive: true });
const repos = findRepos();
const sinceMs = new Date(SINCE).getTime();

const classify = gs => {
  const s = gs.trim();
  let m;
  if (/^commit \(amend\)/.test(s)) return 'commit-amend';
  if (/^commit \(merge\)/.test(s)) return 'commit-merge';
  if (/^commit \(initial\)/.test(s)) return 'commit-initial';
  if (/^commit/.test(s)) return 'commit';
  if (/^reset: moving to/.test(s)) return 'reset';
  if ((m = s.match(/^rebase(?: \(([^)]*)\)|:\s*(\w+))?/))) {
    const sub = (m[1] || m[2] || '').toLowerCase();
    if (/abort/.test(sub) || /^rebase: aborting/.test(s)) return 'rebase-abort';
    if (/^start/.test(sub)) return 'rebase-start';
    if (/^pick|^reword|^edit|^squash|^fixup/.test(sub)) return 'rebase-pick';
    if (/^continue/.test(sub)) return 'rebase-continue';
    if (/^finish/.test(sub)) return 'rebase-finish';
    return 'rebase-other';
  }
  if (/^checkout: moving from/.test(s)) return 'checkout';
  if (/^pull/.test(s)) return 'pull';
  if (/^merge/.test(s)) return 'merge';
  if (/^cherry-pick/.test(s)) return 'cherry-pick';
  if (/^revert/.test(s)) return 'revert';
  if (/^branch: Created/.test(s)) return 'branch-created';
  if (/^branch:/.test(s)) return 'branch-other';
  if (/^clone/.test(s)) return 'clone';
  if (/^fetch/.test(s)) return 'fetch';
  return 'other';
};
const weekKey = d => { // ISO week
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 864e5 + 1) / 7)).padStart(2, '0')}`;
};
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

const out = createWriteStream(`${OUT_DIR}/reflog.jsonl`);
const actionsByKind = {}, resetsPerWeek = {}, rowsByMonth = {}, rowsByMonthNoClone = {};
let rows = 0, earliest = null, amendChains = 0, rebaseAborts = 0, pingPong = 0, reposWithReflog = 0;
const perRepo = [];
const nowSec = Date.now() / 1000, SIXTY = 60 * 86400;

for (const r of repos) {
  const wt = isWorktreeCopy(r), kind = repoKind(r);
  const o = git(r, wt ? ['log', '-g', `--since=${SINCE}`, '--date=iso-strict', '--format=%gd\x1f%gs\x1f%H', 'HEAD']
                      : ['log', '-g', '--all', `--since=${SINCE}`, '--date=iso-strict', '--format=%gd\x1f%gs\x1f%H']);
  const ents = [];
  if (o) for (const l of o.split('\n')) {
    if (!l) continue;
    const [gd, gs, sha] = l.split('\x1f');
    const m = gd && gd.match(/^(.*)@\{(.+)\}$/);
    if (!m || gs === undefined) continue;
    const ref = m[1], when = new Date(m[2]);
    if (isNaN(when) || when.getTime() < sinceMs) continue;
    const action = classify(gs);
    const isHead = ref === 'HEAD';
    const isBranch = ref.startsWith('refs/heads/') || /^[^/]+$/.test(ref) && !isHead;
    if (!isHead && !(isBranch && (action.startsWith('branch-') || action === 'commit-amend'))) continue;
    ents.push({ ref, when, action, gs, sha, isHead });
  }
  ents.sort((a, b) => a.when - b.when);
  const head = ents.filter(e => e.isHead || e.action.startsWith('branch-'));
  for (const e of ents) {
    if (e.isHead || e.action.startsWith('branch-')) {
      inc(actionsByKind[kind] || (actionsByKind[kind] = {}), e.action);
      inc(rowsByMonth, e.when.toISOString().slice(0, 7)); if (e.action !== 'clone') inc(rowsByMonthNoClone, e.when.toISOString().slice(0, 7));
      if (e.action === 'reset') inc(resetsPerWeek, weekKey(e.when));
      if (e.action === 'rebase-abort') rebaseAborts++;
      if (!earliest || e.when < earliest) earliest = e.when;
    }
    out.write(JSON.stringify({ repo: r, repoKind: kind, worktree: wt, ref: e.ref, date: e.when.toISOString(), action: e.action, msg: e.gs.slice(0, 200), sha: e.sha }) + '\n');
    rows++;
  }
  // amend chains: >=2 amends on same branch ref, consecutive gaps <=15min (a chain counted once)
  const amendsByRef = {};
  for (const e of ents) if (e.action === 'commit-amend' && !e.isHead) (amendsByRef[e.ref] ||= []).push(e.when);
  for (const ts of Object.values(amendsByRef)) {
    let len = 1;
    for (let i = 1; i <= ts.length; i++) {
      if (i < ts.length && (ts[i] - ts[i - 1]) <= 15 * 60000) len++;
      else { if (len >= 2) amendChains++; len = 1; }
    }
  }
  // checkout ping-pong A->B->A within 10 min
  const co = head.filter(e => e.action === 'checkout').map(e => { const m = e.gs.match(/moving from (.+) to (.+)$/); return m && { from: m[1], to: m[2], t: e.when }; }).filter(Boolean);
  for (let i = 1; i < co.length; i++)
    if (co[i].from === co[i - 1].to && co[i].to === co[i - 1].from && co[i].t - co[i - 1].t <= 10 * 60000) pingPong++;

  // current state
  const stash = (git(r, ['stash', 'list']) || '').split('\n').filter(Boolean).length;
  const detached = git(r, ['symbolic-ref', '-q', 'HEAD']) === null;
  const br = (git(r, ['for-each-ref', 'refs/heads', '--format=%(committerdate:unix)']) || '').split('\n').filter(Boolean).map(Number);
  const stale = br.filter(t => nowSec - t > SIXTY).length;
  if (ents.length) reposWithReflog++;
  perRepo.push({ repo: r, kind, worktree: wt, reflogEntries: ents.length, stashCount: stash, detachedHead: detached, localBranches: br.length, branchesStale60d: stale });
}
await new Promise(res => out.end(res));

const sum = f => perRepo.reduce((a, p) => a + f(p), 0);
const summary = {
  generatedAt: new Date().toISOString(), since: SINCE,
  retentionCaveat: 'Reflog default expiry is 90 days (reachable) / 30 days (unreachable) and gc may prune; months older than ~90 days are PARTIAL. Do not read low old-month counts as low activity.',
  earliestReflogDateSeen: earliest && earliest.toISOString(),
  reposScanned: repos.length, reposWithReflogEntries: reposWithReflog, reflogRows: rows,
  headReflogEntriesByMonth: Object.fromEntries(Object.entries(rowsByMonth).sort()),
  headReflogEntriesByMonthExcludingClone: Object.fromEntries(Object.entries(rowsByMonthNoClone).sort()),
  note: 'Early months are dominated by clone entries (reflog start = clone date); detachedHead counts include submodules and pinned clones.',
  actionsByRepoKind: actionsByKind,
  amendChains_ge2_within15min: amendChains,
  resetsPerWeek: Object.fromEntries(Object.entries(resetsPerWeek).sort()),
  rebaseAborts, checkoutPingPong_within10min: pingPong,
  currentState: {
    reposWithStash: perRepo.filter(p => p.stashCount > 0).length, totalStashes: sum(p => p.stashCount),
    reposDetachedNow: perRepo.filter(p => p.detachedHead).length,
    totalLocalBranches: sum(p => p.localBranches), branchesStale60d: sum(p => p.branchesStale60d),
  },
  perRepo: perRepo.filter(p => p.reflogEntries || p.stashCount || p.detachedHead || p.branchesStale60d).sort((a, b) => b.reflogEntries - a.reflogEntries),
  elapsedSec: +((Date.now() - t0) / 1000).toFixed(1),
};
writeFileSync(`${OUT_DIR}/reflog-summary.json`, JSON.stringify(summary, null, 2));
console.log(`done in ${summary.elapsedSec}s: rows=${rows} earliest=${summary.earliestReflogDateSeen}`);
