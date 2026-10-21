#!/usr/bin/env node
// Git Archaeology "Divine" step 1B: deeper LOCAL probes (no external services). Read-only against repos.
// Output: ~/.cache/madness-archaeology/probes.json (never into a repo).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { findRepos, repoKind, git, OUT_DIR } from './lib.mjs';

const ROOTS = [
  '/Users/d.edens/lab/madness_interactive/Anathesmelt/claude-work-remote/projects',
  '/Users/d.edens/lab/madness_interactive/Anathesmelt/claude-prime/projects',
];
const readJsonl = f => fs.readFileSync(`${OUT_DIR}/${f}`, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const topN = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const short = (s, n = 160) => String(s).replace(/\s+/g, ' ').replace(/\b[0-9a-f]{40}\b/g, '<hex>').slice(0, n);

const agent = readJsonl('agent-git.jsonl').filter(r => r.source === 'agent' && r.kind === 'git');
const commits = readJsonl('commits.jsonl');
const probes = { generatedAt: new Date().toISOString() };

// ---------- 1+2: transcript error text for hook failures / isolated worktree ----------
const wantHook = new Set(), wantIso = new Set(), wantFM = new Set();
const baseId = id => id.replace(/:\d+$/, '');
const callById = new Map();
for (const r of agent) {
  if (!r.isError) continue;
  const sig = r.errorSignature || '';
  if (sig === 'hook failure') { wantHook.add(baseId(r.callId)); }
  else if (sig.startsWith('This session is isolated in the worktree')) wantIso.add(baseId(r.callId));
  else if (/not fully merged/.test(sig)) wantFM.add(baseId(r.callId));
}
const textById = new Map();
function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(b => (typeof b === 'string' ? b : b?.text ?? '')).join('\n');
  return '';
}
function* walk(dir) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else if (e.isFile() && e.name.endsWith('.jsonl')) yield p;
  }
}
const wanted = new Set([...wantHook, ...wantIso]);
for (const root of ROOTS) for (const f of walk(root)) {
  const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"tool_result"')) continue;
    let hit = false; for (const id of wanted) if (line.includes(id)) { hit = true; break; }
    if (!hit) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const c = o?.message?.content; if (!Array.isArray(c)) continue;
    for (const b of c) if (b?.type === 'tool_result' && wanted.has(b.tool_use_id) && !textById.has(b.tool_use_id)) textById.set(b.tool_use_id, resultText(b.content));
  }
}
const HOOK_PATTERNS = [
  ['guard:<name> (bracketed)', t => { const m = t.match(/\[guard:([\w-]+)\]/i); return m ? `guard:${m[1]}` : null; }],
  ['submodule-guard', t => /submodule-guard/i.test(t) ? 'submodule-guard' : null],
  ['PreToolUse hook (Claude Code)', t => { const m = t.match(/PreToolUse:(\w+) hook[^\[]*\[[^\]]*?([\w.-]+\.(?:sh|py|js|mjs))\b/i); return m ? `PreToolUse:${m[1]} script:${m[2]}` : (/PreToolUse:(\w+) hook/i.test(t) ? 'PreToolUse hook (script unparsed)' : null); }],
  ['husky', t => /husky/i.test(t) ? 'husky' : null],
  ['lint-staged', t => /lint-staged/i.test(t) ? 'lint-staged' : null],
  ['commit-msg', t => /commit-msg/i.test(t) ? 'commit-msg' : null],
  ['pre-push', t => /pre-push/i.test(t) ? 'pre-push' : null],
  ['pre-commit', t => /pre-commit/i.test(t) ? 'pre-commit' : null],
  ['pre-receive', t => /pre-receive/i.test(t) ? 'pre-receive' : null],
  ['post-* hook', t => { const m = t.match(/\b(post-(?:checkout|commit|merge|rewrite))\b/i); return m ? m[1] : null; }],
  ['generic "hook" mention', t => /hook/i.test(t) ? 'generic-hook-text' : null],
];
const hookBy = {}, hookEx = {};
const hookRows = agent.filter(r => r.isError && r.errorSignature === 'hook failure');
const hookBySub = {};
for (const r of hookRows) {
  const t = textById.get(baseId(r.callId));
  let name = t === undefined ? '(error text not found)' : 'unclassified';
  if (t !== undefined) for (const [, fn] of HOOK_PATTERNS) { const n = fn(t); if (n) { name = n; break; } }
  inc(hookBy, name); inc(hookBySub, r.subcommand);
  if (!hookEx[name]) hookEx[name] = { command: short(r.command, 100), text: t ? short(t.slice(Math.max(0, t.search(/hook|guard|husky/i) - 40)), 160) : null };
}
probes.hookFailures = {
  total: hookRows.length, byHook: Object.fromEntries(topN(hookBy, 30)), examples: hookEx,
  byGitSubcommand: Object.fromEntries(topN(hookBySub, 12)),
  readOnlySubcommandShare: +(hookRows.filter(r => ['show', 'diff', 'log', 'status', 'rev-parse', 'ls-files', 'branch', 'config'].includes(r.subcommand)).length / (hookRows.length || 1)).toFixed(3),
  note: 'miner matches signature on result text; read-only git commands showing "hook failure" usually means the Bash call was blocked by a PreToolUse guard (not git itself).',
};

const isoRows = agent.filter(r => r.isError && (r.errorSignature || '').startsWith('This session is isolated in the worktree'));
const isoSub = {}, isoCmd = {}, isoFull = [];
for (const r of isoRows) { inc(isoSub, r.subcommand); inc(isoCmd, short(r.command.replace(/"[^"]*"/g, '"…"'), 60)); }
const isoText = [...wantIso].map(id => textById.get(id)).find(Boolean);
probes.isolatedInWorktree = {
  total: isoRows.length, bySubcommand: Object.fromEntries(topN(isoSub, 15)), topCommands: topN(isoCmd, 12),
  sessions: new Set(isoRows.map(r => r.session)).size, projects: Object.fromEntries(topN(isoRows.reduce((o, r) => (inc(o, path.basename(String(r.project))), o), {}), 6)),
  exampleText: isoText ? short(isoText, 300) : null,
};

// ---------- 3: rapid same-file commits ----------
const human = commits.filter(c => !c.autoStream).sort((a, b) => new Date(a.date) - new Date(b.date));
const byRepo = new Map(); for (const c of human) (byRepo.get(c.repo) || byRepo.set(c.repo, []).get(c.repo)).push(c);
const autoByRepo = new Map(); for (const c of commits.filter(c => c.autoStream)) (autoByRepo.get(c.repo) || autoByRepo.set(c.repo, []).get(c.repo)).push(new Date(c.date).getTime());
const filesCache = new Map();
const filesOf = c => {
  if (!filesCache.has(c.sha)) filesCache.set(c.sha, new Set((git(c.repo, ['show', '--name-only', '--format=', c.sha]) || '').split('\n').filter(Boolean)));
  return filesCache.get(c.sha);
};
const norm = s => s.toLowerCase().replace(/[0-9a-f]{7,40}/g, '#').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 60);
const rapid = [];
for (const cs of byRepo.values()) for (let i = 1; i < cs.length; i++) {
  const a = cs[i - 1], b = cs[i];
  if ((new Date(b.date) - new Date(a.date)) / 60000 >= 3) continue;
  const fa = filesOf(a), fb = filesOf(b);
  if ([...fa].some(f => fb.has(f))) rapid.push([a, b]);
}
const rk = {}, pairs = {}; let ai = 0, aiBoth = 0, autoAdj = 0, merges = 0;
for (const [a, b] of rapid) {
  inc(rk, b.repoKind);
  if (a.aiAssisted || b.aiAssisted) ai++;
  if (a.aiAssisted && b.aiAssisted) aiBoth++;
  const ta = new Date(a.date).getTime(), tb = new Date(b.date).getTime();
  if ((autoByRepo.get(a.repo) || []).some(t => t >= ta - 3 * 60000 && t <= tb + 3 * 60000)) autoAdj++;
  if (a.isMerge || b.isMerge) merges++;
  inc(pairs, `${norm(a.subject)}  ->  ${norm(b.subject)}`);
}
const tot = rapid.length || 1;
probes.rapidSameFile = {
  pairs: rapid.length, byRepoKind: rk, byRepoKindShare: Object.fromEntries(Object.entries(rk).map(([k, v]) => [k, +(v / tot).toFixed(3)])),
  aiAssistedEitherShare: +(ai / tot).toFixed(3), aiAssistedBothShare: +(aiBoth / tot).toFixed(3),
  autoStreamAdjacentShare: +(autoAdj / tot).toFixed(3), involvesMergeShare: +(merges / tot).toFixed(3),
  top10SubjectPairs: topN(pairs, 10),
  note: 'pair = consecutive human commits in same repo <3 min apart sharing >=1 file (same rule as the miner). autoAdjacent = an autoStream commit in same repo within 3 min of the pair.',
};

// ---------- 4: what the agent did next ----------
const bySession = new Map(); for (const r of agent) (bySession.get(r.session) || bySession.set(r.session, []).get(r.session)).push(r);
function nextCmds(rr, n = 3) {
  const rows = bySession.get(rr.session) || [];
  const i = rows.indexOf(rr); const out = []; const seen = new Set([baseId(rr.callId)]);
  for (let j = i + 1; j < rows.length && out.length < n; j++) {
    const b = baseId(rows[j].callId);
    // same compound call: later git invocations in it count as 'next' only if they are a different invocation
    out.push(short(rows[j].command, 110)); seen.add(b);
  }
  return out;
}
function nextProbe(filterFn) {
  const rows = agent.filter(r => r.isError && filterFn(r.errorSignature || ''));
  const seqs = rows.map(r => ({ cmd: short(r.command, 110), next: nextCmds(r) }));
  const first = {}, firstSub = {};
  for (const s of seqs) { const sub = (s.next[0] || '(none)').replace(/^git\s+(-C\s+\S+\s+)?/, '').split(/\s+/)[0]; inc(firstSub, sub); }
  return { count: rows.length, firstNextSubcommand: Object.fromEntries(topN(firstSub, 8)), samples: seqs.slice(0, 6) };
}
probes.afterRejected = nextProbe(s => s === 'rejected');
probes.afterNotFullyMerged = nextProbe(s => /not fully merged/.test(s));

// ---------- 5+6: stale branches, stashes ----------
const repos = findRepos();
const nowSec = Math.floor(Date.now() / 1000), SIXTY = 60 * 86400;
const brKind = {};
const stashes = [];
for (const r of repos) {
  const kind = repoKind(r);
  const heads = (git(r, ['for-each-ref', 'refs/heads', '--format=%(refname:short)\t%(committerdate:unix)']) || '').split('\n').filter(Boolean).map(l => l.split('\t'));
  if (heads.length) {
    let def = (git(r, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']) || '').trim().replace(/^origin\//, '');
    const names = heads.map(h => h[0]);
    if (!def || !names.includes(def)) def = ['main', 'master'].find(n => names.includes(n)) || null;
    const cur = (git(r, ['symbolic-ref', '-q', '--short', 'HEAD']) || '').trim();
    const merged = def ? new Set((git(r, ['branch', '--merged', def, '--format=%(refname:short)']) || '').split('\n').filter(Boolean)) : new Set();
    const k = (brKind[kind] ||= { stale60d: 0, safeToDelete: 0, notMerged: 0, defaultOrCurrent: 0, noDefaultBranch: 0 });
    for (const [n, t] of heads) {
      if (nowSec - Number(t) <= SIXTY) continue;
      k.stale60d++;
      if (!def) { k.noDefaultBranch++; continue; }
      if (n === def || n === cur) { k.defaultOrCurrent++; continue; }
      if (merged.has(n)) k.safeToDelete++; else k.notMerged++;
    }
  }
  const sl = (git(r, ['stash', 'list', '--format=%ct\t%gs']) || '').split('\n').filter(Boolean);
  if (sl.length) {
    const clean = (git(r, ['status', '--porcelain']) || '').trim() === '';
    for (const l of sl) stashes.push({ repo: r, kind, ageDays: (nowSec - Number(l.split('\t')[0])) / 86400, clean });
  }
}
const tot2 = Object.values(brKind).reduce((a, k) => a + k.stale60d, 0);
const sum = f => Object.values(brKind).reduce((a, k) => a + k[f], 0);
probes.staleBranches = {
  note: 'local only, read-only. stale = branch tip older than 60d (same def as reflog miner). safeToDelete = stale, fully merged into repo default branch (origin/HEAD, else main/master), not default/current.',
  totalStale: tot2, safeToDelete: sum('safeToDelete'), notMerged: sum('notMerged'), defaultOrCurrent: sum('defaultOrCurrent'), noDefaultBranch: sum('noDefaultBranch'),
  safeShare: +(sum('safeToDelete') / (tot2 || 1)).toFixed(3), byRepoKind: brKind,
};
const ages = stashes.map(s => s.ageDays);
const bucket = a => (a < 7 ? '<7d' : a < 30 ? '7-30d' : a < 90 ? '30-90d' : '>90d');
const bk = {}; for (const a of ages) inc(bk, bucket(a));
probes.stashes = {
  total: stashes.length, repos: new Set(stashes.map(s => s.repo)).size,
  oldestDays: ages.length ? Math.round(Math.max(...ages)) : null, medianDays: ages.length ? Math.round(median(ages)) : null,
  buckets: bk, inRepoNowClean: stashes.filter(s => s.clean).length,
  byRepoKind: stashes.reduce((o, s) => (inc(o, s.kind), o), {}),
  note: 'stash ages from %ct of the stash commit; clean = `git status --porcelain` empty now (worktree/submodule copies may share a stash list).',
};

fs.writeFileSync(`${OUT_DIR}/probes.json`, JSON.stringify(probes, null, 2));
console.log(JSON.stringify({
  hook: probes.hookFailures.byHook, iso: probes.isolatedInWorktree.bySubcommand, rapid: probes.rapidSameFile.pairs,
  stale: { total: tot2, safe: sum('safeToDelete') }, stashes: probes.stashes.total,
}));
