#!/usr/bin/env node
// Git Archaeology "Divine" step 3: adversarial recompute of findings.json evidence. READ-ONLY (git read commands only).
// Usage: node verify-findings.mjs [section]   -> prints JSON of recomputed numbers. Output stays on stdout (cache dir copy is made by the caller).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findRepos, repoKind, git, OUT_DIR } from './lib.mjs';

const rj = f => fs.readFileSync(`${OUT_DIR}/${f}`, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const commits = rj('commits.jsonl'), classified = rj('classified.jsonl'), agentAll = rj('agent-git.jsonl'), reflog = rj('reflog.jsonl');
const agent = agentAll.filter(r => r.source === 'agent' && r.kind === 'git');
const lab = new Map(classified.map(c => [c.sha, c.label]));
const baseId = id => id.replace(/:\d+$/, '');
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const T = c => new Date(c.date).getTime();
const out = {};
const want = process.argv[2];
const on = k => !want || want === k;

// ---------- F01 ----------
if (on('f01')) {
  const human = commits.filter(c => !c.autoStream);
  const mh = human.filter(c => c.repoKind === 'madness');
  const ff = mh.filter(c => lab.get(c.sha) === 'followup-fix');
  const byRepo = new Map();
  for (const c of human) (byRepo.get(c.repo) || byRepo.set(c.repo, []).get(c.repo)).push(c);
  for (const cs of byRepo.values()) cs.sort((a, b) => T(a) - T(b));
  const prevOf = new Map();
  for (const cs of byRepo.values()) for (let i = 1; i < cs.length; i++) prevOf.set(cs[i].sha, cs[i - 1]);
  const gap = c => { const p = prevOf.get(c.sha); return p ? (T(c) - T(p)) / 60000 : null; };
  const within = ff.filter(c => gap(c) !== null && gap(c) <= 30);
  const f = {};
  f.madnessHuman = mh.length; f.followupFix = ff.length; f.pct = +(ff.length / mh.length * 100).toFixed(1);
  f.within30 = within.length;
  f.within30PredFeature = within.filter(c => lab.get(prevOf.get(c.sha).sha) === 'feature').length;
  // BASELINE: share of ALL madness human commits within 30 min of predecessor, and of non-ff commits
  const nonff = mh.filter(c => lab.get(c.sha) !== 'followup-fix');
  const w30 = a => a.filter(c => gap(c) !== null && gap(c) <= 30).length;
  f.baseline = { allMadnessHumanWithin30: w30(mh), allPct: +(w30(mh) / mh.length * 100).toFixed(1), nonFollowupWithin30: w30(nonff), nonFollowupPct: +(w30(nonff) / nonff.length * 100).toFixed(1), followupPct: +(within.length / ff.length * 100).toFixed(1) };
  const fixLabel = mh.filter(c => lab.get(c.sha) === 'fix');
  f.baseline.plainFixWithin30Pct = +(w30(fixLabel) / fixLabel.length * 100).toFixed(1);
  // concentration by repo
  const rc = {}; for (const c of within) inc(rc, path.basename(c.repo));
  f.within30ByRepoTop = Object.entries(rc).sort((a, b) => b[1] - a[1]).slice(0, 6);
  // do the within30 pairs share a file with predecessor? (git read-only)
  const files = new Map();
  const filesOf = c => { if (!files.has(c.sha)) files.set(c.sha, new Set((git(c.repo, ['show', '--name-only', '--format=', c.sha]) || '').split('\n').filter(Boolean))); return files.get(c.sha); };
  let share = 0;
  for (const c of within) { const a = filesOf(prevOf.get(c.sha)), b = filesOf(c); if ([...a].some(x => b.has(x))) share++; }
  f.within30ShareFileWithPred = share;
  // pred is also an auto commit in between? (auto commits are excluded from the chain: check whether any auto commit sits between)
  const autoByRepo = new Map(); for (const c of commits.filter(c => c.autoStream)) (autoByRepo.get(c.repo) || autoByRepo.set(c.repo, []).get(c.repo)).push(T(c));
  f.within30WithAutoBetween = within.filter(c => { const p = prevOf.get(c.sha); return (autoByRepo.get(c.repo) || []).some(t => t > T(p) && t < T(c)); }).length;
  // is predecessor already contained in a remote ref NOW (i.e. pushed eventually)?
  let pushedNow = 0, checked = 0;
  for (const c of within) { const p = prevOf.get(c.sha); const o = git(c.repo, ['branch', '-r', '--contains', p.sha]); if (o === null) continue; checked++; if (o.trim()) pushedNow++; }
  f.predContainedInRemoteNow = { checked, pushedNow };
  // reflog: amend count vs plain commit entries, same window
  const rm = reflog.filter(r => r.repoKind === 'madness');
  const headRows = rm.filter(r => r.ref === 'HEAD' || r.action.startsWith('branch-'));
  const acts = {}; for (const r of headRows) inc(acts, r.action);
  f.reflogMadnessActions = { amendHeadCounted: acts['commit-amend'] || 0, commit: acts['commit'] || 0 };
  const amendAllRefs = rm.filter(r => r.action === 'commit-amend');
  f.reflogMadnessAmendRowsAnyRef = amendAllRefs.length;
  f.reflogMadnessAmendDistinctSha = new Set(amendAllRefs.map(r => r.sha)).size;
  const dates = rm.map(r => r.date).sort(); f.reflogMadnessEarliest = dates[0];
  const d90 = Date.now() - 90 * 864e5;
  f.reflogMadnessLast90 = { commit: headRows.filter(r => r.action === 'commit' && new Date(r.date) > d90).length, amend: headRows.filter(r => r.action === 'commit-amend' && new Date(r.date) > d90).length };
  // worktree copies in reflog
  f.reflogMadnessAmendByWorktree = amendAllRefs.reduce((o, r) => (inc(o, r.worktree ? 'wt' : 'main'), o), {});
  // median
  const gaps = [], outc = [...human].sort((a, b) => a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : T(a) - T(b));
  for (let i = 0; i < outc.length; i++) { if (lab.get(outc[i].sha) !== 'followup-fix') continue; for (let j = i - 1; j >= 0 && outc[j].repo === outc[i].repo; j--) if (lab.get(outc[j].sha) === 'feature') { gaps.push((T(outc[i]) - T(outc[j])) / 60000); break; } }
  f.featureToFixPairs = gaps.length; f.featureToFixMedian = Math.round(med(gaps));
  out.f01 = f;
}

// ---------- F01 rapid same-file (probe recompute) ----------
if (on('rapid')) {
  const human = commits.filter(c => !c.autoStream).sort((a, b) => T(a) - T(b));
  const byRepo = new Map(); for (const c of human) (byRepo.get(c.repo) || byRepo.set(c.repo, []).get(c.repo)).push(c);
  const cache = new Map();
  const fo = c => { if (!cache.has(c.sha)) cache.set(c.sha, new Set((git(c.repo, ['show', '--name-only', '--format=', c.sha]) || '').split('\n').filter(Boolean))); return cache.get(c.sha); };
  const k = {}; let n = 0;
  for (const cs of byRepo.values()) for (let i = 1; i < cs.length; i++) {
    const a = cs[i - 1], b = cs[i];
    if ((T(b) - T(a)) / 60000 >= 3) continue;
    const fa = fo(a), fb = fo(b);
    if ([...fa].some(x => fb.has(x))) { n++; inc(k, b.repoKind); }
  }
  out.rapid = { pairs: n, byKind: k };
}

// ---------- F01 push timing: was the predecessor already pushed (remote-tracking reflog) before the fix commit? ----------
if (on('f01push')) {
  const human = commits.filter(c => !c.autoStream);
  const byRepo = new Map();
  for (const c of human) (byRepo.get(c.repo) || byRepo.set(c.repo, []).get(c.repo)).push(c);
  for (const cs of byRepo.values()) cs.sort((a, b) => T(a) - T(b));
  const pairs = [];
  for (const cs of byRepo.values()) for (let i = 1; i < cs.length; i++) {
    const c = cs[i];
    if (c.repoKind === 'madness' && lab.get(c.sha) === 'followup-fix' && (T(c) - T(cs[i - 1])) / 60000 <= 30) pairs.push([cs[i - 1], c]);
  }
  const rl = new Map(); // repo -> [{t, sha}] remote-tracking reflog
  const rlOf = repo => {
    if (rl.has(repo)) return rl.get(repo);
    const o = git(repo, ['reflog', 'show', '--all', '--date=unix', '--format=%H\t%gD']) || '';
    const arr = [];
    for (const l of o.split('\n')) { const m = l.match(/^(\w{40})\t(refs\/remotes\/[^@]+)@\{(\d+)\}/); if (m) arr.push({ sha: m[1], t: +m[3] * 1000 }); }
    arr.sort((a, b) => a.t - b.t); rl.set(repo, arr); return arr;
  };
  const r = { pairs: pairs.length, pushedBeforeFix: 0, notPushedBeforeFix_pushedLater: 0, notPushedAnywhere: 0, outOfReflogWindow: 0, notPushedBeforeFix_total: 0 };
  const examples = [];
  for (const [p, c] of pairs) {
    const arr = rlOf(p.repo);
    if (!arr.length || T(c) < arr[0].t) { r.outOfReflogWindow++; continue; }
    const before = arr.filter(e => e.t >= T(p) - 60000 && e.t <= T(c));
    const isAnc = sha => { try { execFileSync('git', ['-C', p.repo, 'merge-base', '--is-ancestor', p.sha, sha], { stdio: 'ignore' }); return true; } catch { return false; } };
    if (before.some(e => isAnc(e.sha))) { r.pushedBeforeFix++; continue; }
    r.notPushedBeforeFix_total++;
    const later = arr.filter(e => e.t > T(c));
    if (later.some(e => isAnc(e.sha))) r.notPushedBeforeFix_pushedLater++; else r.notPushedAnywhere++;
  }
  out.f01push = r;
}

// ---------- F02 ----------
if (on('f02')) {
  const mh = commits.filter(c => c.repoKind === 'madness' && !c.autoStream);
  const a = mh.filter(c => /submodule|subrepo|pointer/i.test(c.subject));
  const b = a.filter(c => /bump|updat|pointer|sync|advance|refresh|pin/i.test(c.subject));
  const f = { madnessHuman: mh.length, mentions: a.length, bump: b.length, pct: +(b.length / mh.length * 100).toFixed(1) };
  f.inInventorium = b.filter(c => c.repo.endsWith('/projects/common/Inventorium')).length;
  f.files_le2 = b.filter(c => c.files <= 2).length;
  // precision: does the commit actually touch a gitlink (mode 160000)?
  let gitlink = 0, onlyGitlinks = 0, checked = 0;
  for (const c of b) {
    const o = git(c.repo, ['show', '--raw', '--no-abbrev', '--format=', c.sha]); if (o === null) continue; checked++;
    const lines = o.split('\n').filter(Boolean);
    const gl = lines.filter(l => /^:(160000|\d+) (160000|\d+) /.test(l) && (l.startsWith(':160000') || / 160000 /.test(l)));
    if (gl.length) gitlink++;
    if (gl.length && gl.length === lines.length) onlyGitlinks++;
  }
  f.precision = { checked, touchGitlink: gitlink, onlyGitlinks };
  // all-madness commits (human) touching gitlinks irrespective of subject: sample over madness human commits
  let anyGl = 0, chk2 = 0;
  for (const c of mh) { const o = git(c.repo, ['show', '--raw', '--no-abbrev', '--format=', c.sha]); if (o === null) continue; chk2++; if (o.split('\n').some(l => l.startsWith(':160000') || / 160000 /.test(l.split('\t')[0]))) anyGl++; }
  f.allMadnessHumanTouchingGitlink = { checked: chk2, touch: anyGl };
  const ms = JSON.parse(fs.readFileSync(`${OUT_DIR}/commits-summary.json`, 'utf8'));
  f.autoRuleHits = ms.autoRuleHits;
  const sub = agent.filter(r => r.subcommand === 'submodule').length;
  const dsub = agent.filter(r => r.subcommand === 'diff' && r.flags.some(x => x.startsWith('--submodule'))).length;
  f.agentSubmodule = { submodule: sub, diffSubmodule: dsub, total: sub + dsub };
  const sk = {}; for (const r of agent.filter(r => r.subcommand === 'submodule')) inc(sk, (r.command.match(/submodule\s+(\w+)/) || [])[1] || '?');
  f.agentSubmoduleVerbs = sk;
  out.f02 = f;
}

// ---------- agent: F04 / F06 / F07 / F08 / S1 / S2 ----------
if (on('agent')) {
  const ORIENT = new Set(['status', 'diff', 'log']);
  const f = {};
  f.total = agent.length;
  f.orient = agent.filter(r => ORIENT.has(r.subcommand)).length;
  f.orientPct = +(f.orient / agent.length * 100).toFixed(1);
  const calls = new Map(); // callId base -> rows
  for (const r of agent) { const b = baseId(r.callId); (calls.get(b) || calls.set(b, []).get(b)).push(r); }
  f.toolCalls = calls.size;
  f.toolCallsWithOrient = [...calls.values()].filter(rs => rs.some(r => ORIENT.has(r.subcommand))).length;
  const orientOnly = [...calls.entries()].filter(([, rs]) => rs.every(r => ORIENT.has(r.subcommand)));
  f.toolCallsOrientOnly = orientOnly.length;
  // bursts
  const info = [...calls.entries()].map(([id, rs]) => ({ id, session: rs[0].session, t: new Date(rs[0].timestamp).getTime(), orientOnly: rs.every(r => ORIENT.has(r.subcommand)), rs }));
  const bySess = new Map(); for (const c of info) (bySess.get(c.session) || bySess.set(c.session, []).get(c.session)).push(c);
  let bursts = 0, burstCalls = 0;
  const burstList = [];
  for (const cs of bySess.values()) {
    cs.sort((a, b) => a.t - b.t);
    let cur = [];
    const flush = () => { if (cur.length >= 2) { bursts++; burstCalls += cur.length; burstList.push(cur); } cur = []; };
    for (const c of cs) {
      if (!c.orientOnly) { flush(); continue; }
      if (cur.length && c.t - cur[cur.length - 1].t > 60000) flush();
      cur.push(c);
    }
    flush();
  }
  f.bursts = bursts; f.burstCalls = burstCalls; f.collapsible = burstCalls - bursts;
  // strict: what a snapshot (status + log -n + diff --stat/--name-only) would actually replace
  const replaceable = r => {
    const fl = r.flags || [];
    if (r.subcommand === 'status') return true;
    if (r.subcommand === 'log') return !fl.some(x => /^-[SG]/.test(x) || x === '--grep' || x.startsWith('--grep') || x === '--follow' || x === '-p' || x === '--patch');
    if (r.subcommand === 'diff') return fl.some(x => x === '--stat' || x === '--name-only' || x === '--name-status' || x === '--shortstat' || x === '--numstat') && !fl.includes('-p');
    return false;
  };
  let sBursts = 0, sCalls = 0;
  for (const b of burstList) {
    // keep only calls where every invocation is replaceable
    let cur = [];
    const flush = () => { if (cur.length >= 2) { sBursts++; sCalls += cur.length; } cur = []; };
    for (const c of b) { if (c.rs.every(replaceable)) cur.push(c); else flush(); }
    flush();
  }
  f.strict = { bursts: sBursts, calls: sCalls, collapsible: sCalls - sBursts };
  // content diffs inside burst calls
  let contentDiff = 0, burstInv = 0;
  for (const b of burstList) for (const c of b) for (const r of c.rs) { burstInv++; if (r.subcommand === 'diff' && !(r.flags || []).some(x => /^--(stat|name-only|name-status|shortstat|numstat)$/.test(x))) contentDiff++; }
  f.burstInvocations = burstInv; f.burstContentDiffs = contentDiff;
  f.gitC = agent.filter(r => r.gitC).length;
  f.diffStat = agent.filter(r => r.subcommand === 'diff' && r.flags.includes('--stat')).length;
  f.showStat = agent.filter(r => r.subcommand === 'show' && r.flags.includes('--stat')).length;
  f.revParse = agent.filter(r => r.subcommand === 'rev-parse').length;
  f.branchShowCurrent = agent.filter(r => r.subcommand === 'branch' && r.flags.includes('--show-current')).length;
  f.remoteV = agent.filter(r => r.subcommand === 'remote' && r.flags.includes('-v')).length;
  f.revListLR = agent.filter(r => r.subcommand === 'rev-list' && r.flags.includes('--left-right')).length;
  f.revListCount = agent.filter(r => r.subcommand === 'rev-list' && r.flags.includes('--count')).length;
  f.revListEither = agent.filter(r => r.subcommand === 'rev-list' && (r.flags.includes('--left-right') || r.flags.includes('--count'))).length;
  // F06
  const logs = agent.filter(r => r.subcommand === 'log');
  f.logCalls = logs.length;
  f.logSearch = logs.filter(r => r.flags.some(x => /^-S/.test(x) || x === '-G' || /^--grep/.test(x) || x === '--follow')).length;
  f.logSearchBreakdown = {}; for (const r of logs) for (const x of new Set(r.flags)) if (/^-S/.test(x) || x === '-G' || /^--grep/.test(x) || x === '--follow') inc(f.logSearchBreakdown, /^-S/.test(x) ? '-S' : x);
  f.isAncestor = agent.filter(r => r.subcommand === 'merge-base' && r.flags.includes('--is-ancestor')).length;
  f.branchContains = agent.filter(r => r.subcommand === 'branch' && r.flags.includes('--contains')).length;
  f.blame = agent.filter(r => r.subcommand === 'blame').length;
  // sessions touching madness projects vs work for search calls (aggregate)
  const kindOf = p => repoKind(String(p) + '/');
  f.logSearchByProjectKind = {}; for (const r of logs.filter(r => r.flags.some(x => /^-S/.test(x) || x === '-G' || /^--grep/.test(x) || x === '--follow'))) inc(f.logSearchByProjectKind, kindOf(r.project));
  f.isAncestorByProjectKind = {}; for (const r of agent.filter(r => r.subcommand === 'merge-base' && r.flags.includes('--is-ancestor'))) inc(f.isAncestorByProjectKind, kindOf(r.project));
  f.agentCallsByProjectKind = {}; for (const r of agent) inc(f.agentCallsByProjectKind, kindOf(r.project));
  // retries
  // F07
  const cp = agent.filter(r => r.subcommand === 'commit' || r.subcommand === 'push');
  f.commitPush = cp.length;
  const VER = new Set(['status', 'diff', 'log', 'show']);
  let same = 0, nextOnly = 0, eitherRows = 0, nextAny = 0;
  const sessCalls = new Map(); for (const c of info) (sessCalls.get(c.session) || sessCalls.set(c.session, []).get(c.session)).push(c);
  for (const cs of sessCalls.values()) cs.sort((a, b) => a.t - b.t);
  const idx = new Map(); for (const cs of sessCalls.values()) cs.forEach((c, i) => idx.set(c.id, [cs, i]));
  let perCallCP = 0, perCallVerifiedAny = 0, perCallSameOnly = 0, perCallNextOnly = 0;
  const seenCall = new Set();
  for (const r of cp) {
    const id = baseId(r.callId); const rs = calls.get(id);
    const ownIdx = rs.findIndex(x => x.callId === r.callId);
    const sameCall = rs.some((x, i) => i !== ownIdx && VER.has(x.subcommand)) ; // any verify in same call (before or after)
    const [cs, i] = idx.get(id); const nx = cs[i + 1];
    const nextCall = !!nx && nx.t - cs[i].t <= 60000 && nx.rs.some(x => VER.has(x.subcommand));
    if (sameCall) same++; if (nextCall) nextAny++; if (sameCall || nextCall) eitherRows++; if (!sameCall && nextCall) nextOnly++;
  }
  f.verify = { sameCall: same, nextCall: nextAny, either: eitherRows, nextCallOnly: nextOnly, eitherPct: +(eitherRows / cp.length * 100).toFixed(1) };
  // tool-call level: commit/push calls whose NEXT tool call is verify only
  const cpCalls = [...calls.entries()].filter(([, rs]) => rs.some(r => r.subcommand === 'commit' || r.subcommand === 'push'));
  let tcNext = 0, tcNextNotSame = 0;
  for (const [id, rs] of cpCalls) {
    const [cs, i] = idx.get(id); const nx = cs[i + 1];
    const sameV = rs.some(x => VER.has(x.subcommand));
    const nextV = !!nx && nx.t - cs[i].t <= 60000 && nx.rs.some(x => VER.has(x.subcommand));
    if (nextV) tcNext++; if (nextV && !sameV) tcNextNotSame++;
  }
  f.toolCallLevel = { commitPushToolCalls: cpCalls.length, nextCallVerify: tcNext, nextCallVerifyAndNoSameCallVerify: tcNextNotSame };
  const err = sub => agent.filter(r => r.subcommand === sub && r.isError).length;
  f.errors = { add: err('add'), addCalls: agent.filter(r => r.subcommand === 'add').length, commit: err('commit'), commitCalls: agent.filter(r => r.subcommand === 'commit').length, stash: err('stash'), stashCalls: agent.filter(r => r.subcommand === 'stash').length, branch: err('branch'), branchCalls: agent.filter(r => r.subcommand === 'branch').length };
  f.errSigsAddCommit = {}; for (const r of agent.filter(r => (r.subcommand === 'add' || r.subcommand === 'commit') && r.isError)) inc(f.errSigsAddCommit, String(r.errorSignature).slice(0, 50));
  f.stashPop = agent.filter(r => r.subcommand === 'stash' && /stash\s+pop/.test(r.command)).length;
  f.pushCalls = agent.filter(r => r.subcommand === 'push').length;
  f.pushRejected = agent.filter(r => r.subcommand === 'push' && r.isError && r.errorSignature === 'rejected').length;
  f.rejectedAnySub = agent.filter(r => r.isError && r.errorSignature === 'rejected').length;
  f.worktreeCalls = agent.filter(r => r.subcommand === 'worktree').length;
  // F08 / S1
  const iso = agent.filter(r => r.isError && String(r.errorSignature || '').startsWith('This session is isolated in the worktree'));
  f.iso = { total: iso.length, sessions: new Set(iso.map(r => r.session)).size, readOnly: iso.filter(r => !['add', 'commit', 'push'].includes(r.subcommand)).length, log: iso.filter(r => r.subcommand === 'log').length, byProjectKind: iso.reduce((o, r) => (inc(o, kindOf(r.project)), o), {}), withGitC: iso.filter(r => r.gitC).length, topProjects: Object.entries(iso.reduce((o, r) => (inc(o, path.basename(String(r.project))), o), {})).sort((a, b) => b[1] - a[1]).slice(0, 4) };
  const hook = agent.filter(r => r.isError && r.errorSignature === 'hook failure');
  f.hook = { total: hook.length, readOnly: hook.filter(r => ['show', 'diff', 'log', 'status', 'rev-parse', 'ls-files', 'branch', 'config'].includes(r.subcommand)).length };
  f.hook.pct = +(f.hook.readOnly / f.hook.total * 100).toFixed(1);
  f.errorSigTop = Object.entries(agent.filter(r => r.isError).reduce((o, r) => (inc(o, String(r.errorSignature).slice(0, 40)), o), {})).sort((a, b) => b[1] - a[1]).slice(0, 12);
  out.agent = f;
}

// ---------- F07 exact replica + refinement ----------
if (on('f07')) {
  const VERIFY = new Set(['status', 'diff', 'log', 'show']);
  const tsOf = r => Date.parse(r.timestamp);
  const idxOf = r => Number(r.callId.split(':').pop()) || 0;
  const bySess = new Map(); for (const r of agent) (bySess.get(r.session) || bySess.set(r.session, []).get(r.session)).push(r);
  for (const l of bySess.values()) l.sort((a, b) => tsOf(a) - tsOf(b) || (baseId(a.callId) < baseId(b.callId) ? -1 : baseId(a.callId) > baseId(b.callId) ? 1 : idxOf(a) - idxOf(b)));
  let total = 0, any = 0, same = 0, next = 0, nextNotSame = 0;
  const callsNextNotSame = new Set(), callsNext = new Set(), callsAll = new Set();
  for (const l of bySess.values()) for (let i = 0; i < l.length; i++) {
    const r = l[i]; if (r.subcommand !== 'commit' && r.subcommand !== 'push') continue;
    total++; callsAll.add(baseId(r.callId));
    const bid = baseId(r.callId); let sm = false, nx = false;
    for (let j = i + 1; j < Math.min(l.length, i + 8); j++) if (baseId(l[j].callId) === bid && VERIFY.has(l[j].subcommand)) sm = true;
    for (let j = i + 1; j < Math.min(l.length, i + 8); j++) if (baseId(l[j].callId) !== bid) { nx = VERIFY.has(l[j].subcommand) && tsOf(l[j]) - tsOf(r) <= 60000; break; }
    if (sm) same++; if (nx) { next++; callsNext.add(bid); } if (sm || nx) any++; if (nx && !sm) { nextNotSame++; callsNextNotSame.add(bid); }
  }
  out.f07 = { total, any, pct: +(any / total * 100).toFixed(1), same, next, nextNotSame, distinctToolCallsNext: callsNext.size, distinctToolCallsNextNotSame: callsNextNotSame.size, distinctCommitPushToolCalls: callsAll.size };
  // the 'verify' that follows might be the post-push check required by the verification discipline: is it a deploy check? count by verify subcommand
  const kinds = {};
  for (const l of bySess.values()) for (let i = 0; i < l.length; i++) { const r = l[i]; if (r.subcommand !== 'commit' && r.subcommand !== 'push') continue; const bid = baseId(r.callId); for (let j = i + 1; j < Math.min(l.length, i + 8); j++) if (baseId(l[j].callId) !== bid) { if (VERIFY.has(l[j].subcommand) && tsOf(l[j]) - tsOf(r) <= 60000) inc(kinds, r.subcommand + '->' + l[j].subcommand); break; } }
  out.f07.nextKinds = kinds;
  // errors: how many add/commit errors are non-git (hook blocks) or benign
  const e = agent.filter(r => (r.subcommand === 'add' || r.subcommand === 'commit') && r.isError);
  out.f07.errTotal = e.length; out.f07.errHook = e.filter(r => r.errorSignature === 'hook failure').length; out.f07.errNonHook = e.length - out.f07.errHook;
  // agent summary retry numbers
  const sm = JSON.parse(fs.readFileSync(`${OUT_DIR}/agent-git-summary.json`, 'utf8'));
  out.f07.summaryRetry = { add: sm.retrySequencesBySubcommand.add, commit: sm.retrySequencesBySubcommand.commit, log: sm.retrySequencesBySubcommand.log };
  out.f07.summaryKeys = Object.keys(sm);
}

// ---------- F03 / F05 live recompute + dedup by common git dir ----------
if (on('probes')) {
  const repos = findRepos();
  const nowSec = Math.floor(Date.now() / 1000), SIXTY = 60 * 86400;
  const common = r => { const o = git(r, ['rev-parse', '--git-common-dir']); if (o === null) return r; const d = o.trim(); return path.resolve(r, d); };
  const run = (list, label) => {
    const brKind = {}; const stashes = [];
    for (const r of list) {
      const kind = repoKind(r);
      const heads = (git(r, ['for-each-ref', 'refs/heads', '--format=%(refname:short)\t%(committerdate:unix)']) || '').split('\n').filter(Boolean).map(l => l.split('\t'));
      if (heads.length) {
        let def = (git(r, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']) || '').trim().replace(/^origin\//, '');
        const names = heads.map(h => h[0]);
        if (!def || !names.includes(def)) def = ['main', 'master'].find(n => names.includes(n)) || null;
        const cur = (git(r, ['symbolic-ref', '-q', '--short', 'HEAD']) || '').trim();
        const merged = def ? new Set((git(r, ['branch', '--merged', def, '--format=%(refname:short)']) || '').split('\n').filter(Boolean)) : new Set();
        const k = (brKind[kind] ||= { stale: 0, safe: 0, notMerged: 0, defOrCur: 0, noDef: 0, safeUnique: 0 });
        for (const [n, t] of heads) {
          if (nowSec - Number(t) <= SIXTY) continue;
          k.stale++;
          if (!def) { k.noDef++; continue; }
          if (n === def || n === cur) { k.defOrCur++; continue; }
          if (merged.has(n)) { k.safe++; /* tip equals default tip or ancestor */ } else k.notMerged++;
        }
      }
      const sl = (git(r, ['stash', 'list', '--format=%ct\t%gs']) || '').split('\n').filter(Boolean);
      if (sl.length) { const clean = (git(r, ['status', '--porcelain']) || '').trim() === ''; for (const l of sl) stashes.push({ repo: r, kind, ageDays: (nowSec - Number(l.split('\t')[0])) / 86400, clean, msg: l.split('\t')[1] }); }
    }
    const tot = f => Object.values(brKind).reduce((a, k) => a + k[f], 0);
    const ages = stashes.map(s => s.ageDays);
    return { label, repos: list.length, stale: tot('stale'), safe: tot('safe'), notMerged: tot('notMerged'), byKind: brKind, stashes: stashes.length, stashRepos: new Set(stashes.map(s => s.repo)).size, over90: ages.filter(a => a > 90).length, medianDays: Math.round(med(ages)), oldest: Math.round(Math.max(...ages)), clean: stashes.filter(s => s.clean).length, stashByKind: stashes.reduce((o, s) => (inc(o, s.kind), o), {}), desktopMarker: stashes.filter(s => /!!GitHub_Desktop/.test(s.msg)).length };
  };
  out.probesRaw = run(repos, 'raw (as the probe did)');
  const seen = new Set(); const dedup = [];
  for (const r of repos) { const c = common(r); if (seen.has(c)) continue; seen.add(c); dedup.push(r); }
  out.probesDedup = run(dedup, 'deduped by git common dir');
  out.worktreeCopies = repos.filter(r => r.includes('/.claude/worktrees/')).length;
  out.dupReposRemoved = repos.length - dedup.length;
}

// ---------- misc: speculative + dropped + summary-file numbers ----------
if (on('misc')) {
  const f = {};
  const mAll = commits.filter(c => c.repoKind === 'madness');
  f.madnessAll = mAll.length; f.madnessAuto = mAll.filter(c => c.autoStream).length; f.madnessAutoPct = +(f.madnessAuto / mAll.length * 100).toFixed(1);
  f.autoInTwoRepos = mAll.filter(c => c.autoStream && (c.repo.endsWith('/Anathesmelt') || c.repo.endsWith('/cursor_chathistory'))).length;
  f.wip = commits.filter(c => c.repoKind === 'madness' && !c.autoStream && lab.get(c.sha) === 'wip-checkpoint').length;
  // reflog resets / ping-pong
  const rm = reflog.filter(r => r.repoKind === 'madness' && (r.ref === 'HEAD'));
  f.madnessResets = rm.filter(r => r.action === 'reset').length;
  const resets = rm.filter(r => r.action === 'reset'); const rr = {}; for (const r of resets) inc(rr, path.basename(r.repo) + ' | ' + r.msg.slice(0, 40));
  f.madnessResetsTop = Object.entries(rr).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sm = JSON.parse(fs.readFileSync(`${OUT_DIR}/reflog-summary.json`, 'utf8'));
  f.reflogSummary = { pingPong: sm.checkoutPingPong_within10min, resetsMadness: sm.actionsByRepoKind.madness.reset, amend: sm.actionsByRepoKind.madness['commit-amend'], commitMadness: sm.actionsByRepoKind.madness.commit, rebaseAborts: sm.rebaseAborts, totalStashes: sm.currentState.totalStashes, branchesStale60d: sm.currentState.branchesStale60d };
  // ping-pong by kind (recompute from reflog rows, HEAD only)
  const pp = {};
  const byRepo = new Map(); for (const r of reflog.filter(r => r.ref === 'HEAD' && r.action === 'checkout')) (byRepo.get(r.repo) || byRepo.set(r.repo, []).get(r.repo)).push(r);
  for (const [repo, rs] of byRepo) { rs.sort((a, b) => new Date(a.date) - new Date(b.date)); const co = rs.map(e => { const m = e.msg.match(/moving from (.+) to (.+)$/); return m && { from: m[1], to: m[2], t: new Date(e.date).getTime() }; }).filter(Boolean); for (let i = 1; i < co.length; i++) if (co[i].from === co[i - 1].to && co[i].to === co[i - 1].from && co[i].t - co[i - 1].t <= 10 * 60000) inc(pp, repoKind(repo)); }
  f.pingPongByKind = pp;
  // push rejected rate
  const as = JSON.parse(fs.readFileSync(`${OUT_DIR}/agent-git-summary.json`, 'utf8'));
  f.agentSummaryChecks = { pushCount: as.perSubcommand.push.count, branchCount: as.perSubcommand.branch.count, branchErr: as.perSubcommand.branch.errors, stashErr: as.perSubcommand.stash.errors, stashCount: as.perSubcommand.stash.count, worktree: as.perSubcommand.worktree.count, blame: as.perSubcommand.blame.count, addErr: as.perSubcommand.add.errors, addCount: as.perSubcommand.add.count, commitErr: as.perSubcommand.commit.errors, commitCount: as.perSubcommand.commit.count };
  f.agentSummaryRetry = as.retrySequencesBySubcommand;
  f.pathspecSig = (as.topErrorSignatures.find(x => x.signature.startsWith('pathspec')) || {}).count;
  f.nothingToCommitSig = (as.topErrorSignatures.find(x => x.signature.startsWith('nothing to commit')) || {}).count;
  f.ignoredSig = (as.topErrorSignatures.find(x => x.signature.startsWith('Exit code 1 The following paths are ignored')) || {}).count;
  const cs = JSON.parse(fs.readFileSync(`${OUT_DIR}/commits-summary.json`, 'utf8'));
  f.commitsSummary = { human: cs.human, auto: cs.auto, rules: cs.autoRuleHits };
  // not-fully-merged after delete
  const nfm = agent.filter(r => r.isError && /not fully merged/.test(r.errorSignature || ''));
  f.notFullyMergedRows = nfm.length; f.notFullyMergedDistinctCalls = new Set(nfm.map(r => baseId(r.callId))).size;
  f.branchErrPct = +(as.perSubcommand.branch.errors / as.perSubcommand.branch.count * 100).toFixed(1);
  out.misc = f;
}

// ---------- log retries by cause ----------
if (on('retry')) {
  const ss = new Map(); for (const r of agent) (ss.get(r.session) || ss.set(r.session, []).get(r.session)).push({ ...r, t: Date.parse(r.timestamp) });
  const bySub = {}, cause = {};
  for (const arr of ss.values()) {
    arr.sort((a, b) => a.t - b.t);
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i]; if (!a.isError) continue;
      const ac = baseId(a.callId);
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j]; if (baseId(b.callId) === ac) continue;
        const dt = b.t - a.t; if (dt > 120000) break;
        if (b.subcommand === a.subcommand) { inc(bySub, a.subcommand); if (a.subcommand === 'log') { const sig = String(a.errorSignature); inc(cause, sig === 'hook failure' ? 'hook' : sig.startsWith('This session is isolated') ? 'worktree-isolation' : 'other'); } break; }
      }
    }
  }
  out.retry = { log: bySub.log, add: bySub.add, commit: bySub.commit, logCause: cause };
}

// ---------- S1 hook split from transcript text ----------
if (on('hook')) {
  const readline = await import('node:readline');
  const ids = new Set(agent.filter(r => r.isError && r.errorSignature === 'hook failure').map(r => baseId(r.callId)));
  const text = new Map();
  const ROOTS = ['/Users/d.edens/lab/madness_interactive/Anathesmelt/claude-work-remote/projects', '/Users/d.edens/lab/madness_interactive/Anathesmelt/claude-prime/projects'];
  function* walk(dir) { let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(dir, e.name); if (e.isDirectory()) yield* walk(p); else if (e.name.endsWith('.jsonl')) yield p; } }
  for (const root of ROOTS) for (const f of walk(root)) {
    const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('"tool_result"') || !line.includes('hook')) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      const c = o?.message?.content; if (!Array.isArray(c)) continue;
      for (const b of c) if (b?.type === 'tool_result' && ids.has(b.tool_use_id) && !text.has(b.tool_use_id)) text.set(b.tool_use_id, typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map(x => x?.text ?? '').join('\n') : '');
    }
  }
  const by = {};
  for (const id of ids) { const t = text.get(id); let k = t === undefined ? 'text-not-found' : /\[guard:([\w-]+)\]/.exec(t) ? 'guard:' + /\[guard:([\w-]+)\]/.exec(t)[1] : /eslint-gate/.test(t) ? 'eslint-gate' : 'other'; inc(by, k); }
  // by distinct tool call vs rows
  out.hook = { distinctToolCalls: ids.size, byToolCall: by };
  const rows = agent.filter(r => r.isError && r.errorSignature === 'hook failure'); const byRow = {};
  for (const r of rows) { const t = text.get(baseId(r.callId)); let k = t === undefined ? 'text-not-found' : /\[guard:([\w-]+)\]/.exec(t) ? 'guard:' + /\[guard:([\w-]+)\]/.exec(t)[1] : /eslint-gate/.test(t) ? 'eslint-gate' : 'other'; inc(byRow, k); }
  out.hook.byRow = byRow; out.hook.rows = rows.length;
}

console.log(JSON.stringify(out, null, 1));
