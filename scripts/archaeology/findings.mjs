#!/usr/bin/env node
// Git Archaeology "Divine" step 2: evidence -> ranked friction table.
// Reads ONLY the cached miner outputs in ~/.cache/madness-archaeology/ (no repos, no external services),
// computes every number that findings cite, and writes findings.json + findings.md next to them.
// Every evidence.number in findings.json is produced by a metric computed in this file (see `metrics`).
// Work-kind repos appear only as aggregate counts in findings.md.
import fs from 'node:fs';
import { OUT_DIR } from './lib.mjs';

const rd = f => JSON.parse(fs.readFileSync(`${OUT_DIR}/${f}`, 'utf8'));
const rdl = f => fs.readFileSync(`${OUT_DIR}/${f}`, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const pct = (a, b) => round((100 * a) / b, 1);

const probes = rd('probes.json');
const agentSum = rd('agent-git-summary.json');
const commitSum = rd('commits-summary.json');
const reflogSum = rd('reflog-summary.json');
const classSum = rd('classified-summary.json');
const g = rdl('agent-git.jsonl').filter(r => r.source === 'agent' && r.kind === 'git');
const commits = rdl('commits.jsonl');
const labels = new Map(rdl('classified.jsonl').map(r => [r.sha, r.label]));

const tsOf = r => Date.parse(r.timestamp);
const baseId = r => r.callId.replace(/:\d+$/, '');
const idxOf = r => Number(r.callId.split(':').pop()) || 0;
const ORIENT = new Set(['status', 'diff', 'log']);
const VERIFY = new Set(['status', 'diff', 'log', 'show']);

// ---------- agent metrics ----------
const m = {};
m.agentGitCalls = g.length;
m.orientCalls = g.filter(r => ORIENT.has(r.subcommand)).length;
m.orientSharePct = pct(m.orientCalls, g.length);

// group git invocations into tool calls
const bySession = new Map();
for (const r of g) { if (!bySession.has(r.session)) bySession.set(r.session, []); bySession.get(r.session).push(r); }
for (const l of bySession.values()) l.sort((a, b) => tsOf(a) - tsOf(b) || (baseId(a) < baseId(b) ? -1 : baseId(a) > baseId(b) ? 1 : idxOf(a) - idxOf(b)));
const toolCalls = []; // {session, ts, subs:Set}
for (const [s, l] of bySession) {
  const seen = new Map();
  for (const r of l) {
    const k = baseId(r);
    if (!seen.has(k)) { const c = { session: s, ts: tsOf(r), subs: new Set() }; seen.set(k, c); toolCalls.push(c); }
    seen.get(k).subs.add(r.subcommand);
  }
}
m.gitToolCalls = toolCalls.length;
m.toolCallsWithOrient = toolCalls.filter(c => [...c.subs].some(x => ORIENT.has(x))).length;
m.toolCallsOrientOnly = toolCalls.filter(c => [...c.subs].every(x => ORIENT.has(x))).length;
// bursts: consecutive orient-only tool calls, same session, each <=60s after the previous; any other git tool call breaks the burst
{
  let bursts = 0, inBursts = 0, cur = [];
  const flush = () => { if (cur.length >= 2) { bursts++; inBursts += cur.length; } cur = []; };
  const sorted = [...toolCalls].sort((a, b) => (a.session < b.session ? -1 : a.session > b.session ? 1 : a.ts - b.ts));
  for (const c of sorted) {
    const orientOnly = [...c.subs].every(x => ORIENT.has(x));
    if (!orientOnly) { flush(); continue; }
    if (cur.length && (cur[cur.length - 1].session !== c.session || c.ts - cur[cur.length - 1].ts > 60000)) flush();
    cur.push(c);
  }
  flush();
  m.orientBursts = bursts;
  m.orientBurstToolCalls = inBursts;
  m.collapsibleRoundTrips = inBursts - bursts;
}
m.gitCWithTargetRepo = g.filter(r => r.gitC).length;
m.gitCSharePct = pct(m.gitCWithTargetRepo, g.length);
const flagCount = (sub, flag) => g.filter(r => r.subcommand === sub && r.flags.includes(flag)).length;
m.diffStat = flagCount('diff', '--stat');
m.showStat = flagCount('show', '--stat');
m.revParse = g.filter(r => r.subcommand === 'rev-parse').length;
m.branchShowCurrent = flagCount('branch', '--show-current');
m.remoteV = flagCount('remote', '-v');
m.revListLeftRight = flagCount('rev-list', '--left-right');
m.revListCount = flagCount('rev-list', '--count');
m.statusSb = flagCount('status', '-sb');

// verify-after-write: commit/push followed by status/diff/log/show in same tool call (later index) or next tool call <=60s
{
  let total = 0, any = 0, sameCall = 0, nextCall = 0;
  for (const l of bySession.values()) {
    for (let i = 0; i < l.length; i++) {
      const r = l[i];
      if (r.subcommand !== 'commit' && r.subcommand !== 'push') continue;
      total++;
      const bid = baseId(r);
      let same = false, nxt = false;
      for (let j = i + 1; j < Math.min(l.length, i + 8); j++) {
        if (baseId(l[j]) === bid) { if (VERIFY.has(l[j].subcommand)) same = true; }
      }
      for (let j = i + 1; j < Math.min(l.length, i + 8); j++) {
        if (baseId(l[j]) !== bid) { nxt = VERIFY.has(l[j].subcommand) && tsOf(l[j]) - tsOf(r) <= 60000; break; }
      }
      if (same) sameCall++;
      if (nxt) nextCall++;
      if (same || nxt) any++;
    }
  }
  m.commitPushCalls = total; m.commitPushVerified = any; m.commitPushVerifiedPct = pct(any, total);
  m.verifySameToolCall = sameCall; m.verifyNextToolCall = nextCall;
}
const perSub = agentSum.perSubcommand;
m.addErrors = perSub.add.errors; m.commitErrors = perSub.commit.errors;
m.addCalls = perSub.add.count; m.commitCalls = perSub.commit.count;
m.addCommitRetrySeqs = agentSum.retrySequencesBySubcommand.add + agentSum.retrySequencesBySubcommand.commit;
const sig = prefix => (agentSum.topErrorSignatures.find(s => s.signature.startsWith(prefix)) || { count: 0 }).count;
m.errPathspec = sig('pathspec');
m.errNothingToCommit = sig('nothing to commit');
m.errIgnoredPath = sig('Exit code 1 The following paths are ignored');
m.hookFailTotal = probes.hookFailures.total;
m.hookFailByHook = probes.hookFailures.byHook;
m.hookFailReadOnlySharePct = round(probes.hookFailures.readOnlySubcommandShare * 100, 1);
// log-history questions
const logs = g.filter(r => r.subcommand === 'log');
m.logCalls = logs.length;
m.logSearchOrFollow = logs.filter(r => r.flags.some(f => f === '-S' || f === '-G' || f === '--follow' || f.startsWith('--grep') || f === '--grep' || f.startsWith('-S'))).length;
m.mergeBaseIsAncestor = flagCount('merge-base', '--is-ancestor');
m.branchContains = flagCount('branch', '--contains');
m.blameCalls = perSub.blame.count;
m.logRetrySeqs = agentSum.retrySequencesBySubcommand.log;
m.historyQuestionCalls = m.logSearchOrFollow + m.mergeBaseIsAncestor + m.branchContains;
// stash
m.stashCalls = perSub.stash.count; m.stashErrors = perSub.stash.errors;
m.stashPopCalls = g.filter(r => r.subcommand === 'stash' && /\bstash\s+pop\b/.test(r.command)).length;
// worktree isolation
m.isoRefusals = probes.isolatedInWorktree.total;
m.isoSessions = probes.isolatedInWorktree.sessions;
const isoWrite = ['add', 'commit', 'push'].reduce((a, k) => a + (probes.isolatedInWorktree.bySubcommand[k] || 0), 0);
m.isoReadOnly = m.isoRefusals - isoWrite;
m.isoReadOnlyPct = pct(m.isoReadOnly, m.isoRefusals);
m.isoLog = probes.isolatedInWorktree.bySubcommand.log;
// rejected pushes
m.pushCalls = perSub.push.count; m.pushRejected = probes.afterRejected.count;
m.pushRejectedPct = pct(m.pushRejected, m.pushCalls);
m.worktreeCalls = perSub.worktree.count;

// ---------- commit metrics ----------
const madHuman = commits.filter(c => c.repoKind === 'madness' && !c.autoStream);
const madAll = commits.filter(c => c.repoKind === 'madness');
m.madnessHumanCommits = madHuman.length;
m.madnessFollowupFix = madHuman.filter(c => labels.get(c.sha) === 'followup-fix').length;
m.madnessFollowupFixPct = pct(m.madnessFollowupFix, madHuman.length);
{
  const byRepo = new Map();
  for (const c of commits.filter(c => !c.autoStream)) { if (!byRepo.has(c.repo)) byRepo.set(c.repo, []); byRepo.get(c.repo).push(c); }
  let within30 = 0, afterFeature = 0;
  for (const l of byRepo.values()) {
    l.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    for (let i = 1; i < l.length; i++) {
      const c = l[i];
      if (c.repoKind !== 'madness' || labels.get(c.sha) !== 'followup-fix') continue;
      const gap = Date.parse(c.date) - Date.parse(l[i - 1].date);
      if (gap <= 30 * 60000) { within30++; if (labels.get(l[i - 1].sha) === 'feature') afterFeature++; }
    }
  }
  m.followupWithin30m = within30; m.followupWithin30mPct = pct(within30, m.madnessFollowupFix); m.followupAfterFeature30m = afterFeature;
}
m.rapidSameFilePairs = probes.rapidSameFile.pairs;
m.rapidSameFileMadness = probes.rapidSameFile.byRepoKind.madness;
m.reflogAmendMadness = reflogSum.actionsByRepoKind.madness['commit-amend'];
m.featureToFixMedianMin = classSum.featureToFollowupFix.medianMinutes;
m.featureToFixPairs = classSum.featureToFollowupFix.pairs;
const bumpRe = /submodule|subrepo|pointer/i, bumpRe2 = /bump|updat|pointer|sync|advance|refresh|pin/i;
m.submoduleMentionCommits = madHuman.filter(c => bumpRe.test(c.subject)).length;
m.submoduleBumpCommits = madHuman.filter(c => bumpRe.test(c.subject) && bumpRe2.test(c.subject)).length;
m.submoduleBumpPct = pct(m.submoduleBumpCommits, madHuman.length);
m.submoduleBumpInventorium = madHuman.filter(c => bumpRe.test(c.subject) && bumpRe2.test(c.subject) && c.repo.endsWith('/projects/common/Inventorium')).length;
m.submoduleBumpFiles2OrLess = madHuman.filter(c => bumpRe.test(c.subject) && bumpRe2.test(c.subject) && c.files <= 2).length;
m.autoRuleR1ThemeRegen = commitSum.autoRuleHits.R1;
m.autoRuleR2PointerRitual = commitSum.autoRuleHits.R2;
m.agentSubmoduleCalls = perSub.submodule.count;
m.agentDiffSubmodule = flagCount('diff', '--submodule');
m.madnessAutoCommits = madAll.filter(c => c.autoStream).length;
m.madnessAutoPct = pct(m.madnessAutoCommits, madAll.length);
m.madnessAutoTwoRepos = madAll.filter(c => c.autoStream && /\/Anathesmelt$|\/cursor_chathistory$/.test(c.repo)).length;
m.madnessWipCheckpoint = madHuman.filter(c => labels.get(c.sha) === 'wip-checkpoint').length;

// ---------- branch / stash state ----------
const sb = probes.staleBranches;
m.staleBranches = sb.totalStale; m.safeToDelete = sb.safeToDelete; m.safePct = round(sb.safeShare * 100, 1);
m.safeMadness = sb.byRepoKind.madness.safeToDelete; m.safeWork = sb.byRepoKind.work.safeToDelete; m.safeOther = sb.byRepoKind.other.safeToDelete;
m.notMerged = sb.notMerged; m.notMergedMadness = sb.byRepoKind.madness.notMerged;
m.branchCalls = perSub.branch.count; m.branchErrors = perSub.branch.errors; m.branchErrorPct = round(perSub.branch.errorRate * 100, 1);
m.branchNotFullyMerged = probes.afterNotFullyMerged.count;
m.stashTotal = probes.stashes.total; m.stashRepos = probes.stashes.repos; m.stashOlder90 = probes.stashes.buckets['>90d'];
m.stashMedianDays = probes.stashes.medianDays; m.stashOldestDays = probes.stashes.oldestDays; m.stashInCleanRepo = probes.stashes.inRepoNowClean;
m.stashMadness = probes.stashes.byRepoKind.madness;

// ---------- findings ----------
const AG = 'agent-git.jsonl', AGS = 'agent-git-summary.json', CM = 'commits.jsonl', CMS = 'commits-summary.json',
  CL = 'classified.jsonl', CLS = 'classified-summary.json', PR = 'probes.json', RF = 'reflog-summary.json';
const ev = (claim, number, source_file, how_computed) => ({ claim, number, source_file, how_computed });

const F = [
  {
    key: 'snapshot',
    title: 'One-call repo snapshot (agent CLI/MCP surface + header strip)',
    audience: 'both',
    params: { events: m.collapsibleRoundTrips, events_what: 'tool-call round trips inside orient-only bursts that one snapshot call would replace', minutes_each: 0.3, fixability: 0.9 },
    evidence: [
      ev('Agent git calls that are status/diff/log orientation', m.orientCalls, AG, 'count rows source=agent kind=git with subcommand in {status,diff,log}'),
      ev('Share of all agent git calls that are orientation (percent)', m.orientSharePct, AG, `orientCalls / ${m.agentGitCalls} total agent git calls * 100`),
      ev('Git-bearing agent tool calls containing at least one orient call', m.toolCallsWithOrient, AG, `group rows by callId prefix (before ":n"); of ${m.gitToolCalls} tool calls count those with any status/diff/log`),
      ev('Orient-only tool calls (every git invocation in the call is status/diff/log)', m.toolCallsOrientOnly, AG, 'same grouping; all subcommands in {status,diff,log}'),
      ev('Round trips collapsible: orient-only tool calls that follow another orient-only call in the same session within 60s', m.collapsibleRoundTrips, AG, `bursts of >=2 consecutive orient-only tool calls (<=60s apart, same session, broken by any other git call): ${m.orientBurstToolCalls} calls in ${m.orientBursts} bursts, minus one kept per burst`),
      ev('Agent git calls that name another repo with -C', m.gitCWithTargetRepo, AG, 'rows where gitC is non-null'),
      ev('Diffstat questions (diff --stat plus show --stat)', m.diffStat + m.showStat, AG, `rows with subcommand diff and flag --stat (${m.diffStat}) plus subcommand show and flag --stat (${m.showStat})`),
      ev('Context probes that a snapshot also answers (rev-parse, branch --show-current, remote -v)', m.revParse + m.branchShowCurrent + m.remoteV, AG, `rev-parse rows (${m.revParse}) + branch --show-current (${m.branchShowCurrent}) + remote -v (${m.remoteV})`),
      ev('Ahead/behind probes (rev-list --left-right or --count)', m.revListLeftRight + m.revListCount, AG, `rev-list rows with --left-right (${m.revListLeftRight}) plus --count (${m.revListCount}); upper bound, some rows overlap`),
    ],
    estimated_cost: `estimate: ${m.collapsibleRoundTrips} avoidable tool-call round trips x ~0.3 agent-minutes (one model turn plus tool latency, assumed 15-20s) = ~${round(m.collapsibleRoundTrips * 0.3, 0)} agent-minutes, plus the tokens of repeated status/log output. Rests on the burst count (measured) and the per-turn latency (assumed). Not measured: real wall time (the miner has no durations).`,
    git_primitive: 'git status --porcelain=v2 --branch (branch, upstream, ahead/behind, dirty counts), git log -3 --format, git stash list, git worktree list --porcelain, git diff --submodule=short, plus .git/MERGE_HEAD / rebase-merge presence for in-progress operations',
    proposed_control: 'Two surfaces over one read-only data function. (1) Agent: `madness-git snapshot [--json] [--repos a,b,c]` shipped with the app, optionally an MCP tool `repo_snapshot`; returns branch, upstream, ahead/behind, staged/unstaged/untracked counts with top changed files and +/- stat, last 3 commits (sha, subject, age), stash count, sibling worktrees with their HEAD, submodule drift, in-progress merge/rebase. `--repos` answers for several repos in one call (the app already knows the repo list). (2) Human: a one-line "pulse" strip under the toolbar in the Changes tab showing the same fields; click expands the full JSON-equivalent card.',
    undo_story: 'read-only, nothing to undo',
    safety: 'read-only',
    madness_mode_only: true,
    effort: 'M',
  },
  {
    key: 'fixup',
    title: 'Fold a follow-up fix into the last commit (amend/fixup nudge, unpushed only)',
    audience: 'both',
    params: { events: m.followupWithin30m, events_what: 'madness follow-up-fix commits landing within 30 min of the previous human commit in the same repo', minutes_each: 3, fixability: 0.3 },
    evidence: [
      ev('Madness-repo human commits labeled followup-fix (gemini)', m.madnessFollowupFix, CL, `join classified.jsonl label=followup-fix with commits.jsonl repoKind=madness autoStream=false (of ${m.madnessHumanCommits} commits, ${m.madnessFollowupFixPct}%)`),
      ev('Of those, committed within 30 min of the previous human commit in the same repo', m.followupWithin30m, CM, 'sort non-auto commits per repo by date; count followup-fix commits (madness) whose predecessor is <=30 min earlier'),
      ev('Of those, the predecessor was labeled feature', m.followupAfterFeature30m, CL, 'same, with predecessor label=feature'),
      ev('Median minutes from a feature commit to its next followup-fix in the same repo (all kinds)', m.featureToFixMedianMin, CLS, `featureToFollowupFix.medianMinutes over ${m.featureToFixPairs} pairs`),
      ev('Rapid same-file commit pairs (<3 min apart, share a file), all repo kinds', m.rapidSameFilePairs, PR, 'rapidSameFile.pairs'),
      ev('... of which in madness repos', m.rapidSameFileMadness, PR, 'rapidSameFile.byRepoKind.madness'),
      ev('Commit amends recorded in madness reflogs since 2026-01-01 (people create new commits rather than amend)', m.reflogAmendMadness, RF, 'actionsByRepoKind.madness["commit-amend"]'),
    ],
    estimated_cost: `estimate: ${m.followupWithin30m} fix commits x ~3 min each (notice, write a message, extra history noise, later cleanup or squash) = ~${m.followupWithin30m * 3} min. Fixability is deliberately low (0.3) because the workshop pushes as it goes: only an UNPUSHED predecessor can be safely folded, and the data has no push-state per commit (gap). Rests on the within-30-minute count (measured); minutes and eligibility share are assumed.`,
    git_primitive: 'git commit --amend --no-edit (HEAD, unpushed) or git commit --fixup=<sha> followed by git rebase --autosquash <sha>^ (older unpushed commit)',
    proposed_control: 'In the Changes tab commit box: when HEAD is unpushed, authored by you and <=30 min old, show a chip "Fold into last commit: <subject>" next to the Commit button (shows the files both commits touch). In History, right-click an unpushed commit -> "Fixup into this commit..." which creates the fixup commit and runs autosquash only when every commit above it is also unpushed, otherwise the item is disabled with the reason. Extends the existing squash and reorder.',
    undo_story: 'before any rewrite the app writes refs/madness/backup/<branch>/<timestamp> pointing at the old tip and shows a toast "Undo" that does git reset --hard to it; the old tip is also in the reflog (HEAD@{1})',
    safety: 'destructive-with-backup',
    madness_mode_only: true,
    effort: 'M',
  },
  {
    key: 'submodule',
    title: 'Submodule pointer bump in one click (child-first push order)',
    audience: 'both',
    params: { events: m.submoduleBumpCommits, events_what: 'madness human commits whose subject mentions a submodule/pointer bump or update', minutes_each: 1.5, fixability: 0.7 },
    evidence: [
      ev('Madness human commits whose subject mentions submodule/subrepo/pointer', m.submoduleMentionCommits, CM, 'regex /submodule|subrepo|pointer/i on subject, repoKind=madness autoStream=false'),
      ev('... of which are bump/update flavored', m.submoduleBumpCommits, CM, 'same plus /bump|updat|pointer|sync|advance|refresh|pin/i (excludes plain "Add submodule")'),
      ev('Share of madness human commits (percent)', m.submoduleBumpPct, CM, `submoduleBumpCommits / ${m.madnessHumanCommits} * 100`),
      ev('... made in the Inventorium repo (the hub with nested repos)', m.submoduleBumpInventorium, CM, 'same filter, repo path ends /projects/common/Inventorium'),
      ev('... touching 2 or fewer files (pure pointer commits)', m.submoduleBumpFiles2OrLess, CM, 'same filter, files<=2'),
      ev('Pointer-ritual commits already classified as auto-stream by the miner (rule R2)', m.autoRuleR2PointerRitual, CMS, 'autoRuleHits.R2 (all repo kinds, excluded from the human counts above)'),
      ev('Theme-regeneration follow-up commits after a MadnessThemes bump (rule R1)', m.autoRuleR1ThemeRegen, CMS, 'autoRuleHits.R1'),
      ev('Agent submodule calls plus diff --submodule', m.agentSubmoduleCalls + m.agentDiffSubmodule, AG, `rows subcommand=submodule (${m.agentSubmoduleCalls}) plus diff with --submodule (${m.agentDiffSubmodule})`),
    ],
    estimated_cost: `estimate: ${m.submoduleBumpCommits} bump commits x ~1.5 min saved (open child, confirm it is pushed, return to parent, stage pointer, write a message from the child's log) = ~${round(m.submoduleBumpCommits * 1.5, 0)} min. Rests on the commit count (measured, subject regex so approximate) and the minutes (assumed). Plus R1 (${m.autoRuleR1ThemeRegen}) and R2 (${m.autoRuleR2PointerRitual}) ritual commits not counted in the estimate.`,
    git_primitive: 'git diff --submodule=log (recorded vs checked-out), git add <submodule path> (stages the gitlink), git submodule summary, git branch -r --contains <child sha> (is the child commit pushed?), then child push before parent push',
    proposed_control: 'Extend the Submodules panel: each row shows "recorded abc123 -> checked out def456 (+3 commits)" with the 3 subjects on hover and a pushed/unpushed badge for the child tip. Row button "Bump pointer" stages only that gitlink and pre-fills the commit box with "chore(<name>): bump submodule - <subject 1>; <subject 2>"; a footer "Bump all drifted" makes one commit for all rows. If a child tip is unpushed the button first offers "Push <name>, then bump" so the parent never points at a commit that is not on a remote.',
    undo_story: 'ordinary commit: the existing "undo last commit" restores the old gitlinks (reflog entry commit: ...); a child push is not undone (it is a plain push), the dialog says so before pushing',
    safety: 'reversible',
    madness_mode_only: true,
    effort: 'M',
  },
  {
    key: 'prune',
    title: 'Clean up merged stale branches (bulk, with a trash ref)',
    audience: 'human',
    params: { events: m.safeToDelete, events_what: 'stale branches fully merged into the default branch, safe to delete', minutes_each: 0.5, fixability: 0.9 },
    evidence: [
      ev('Local branches with tip older than 60 days (all repos, all kinds)', m.staleBranches, PR, 'staleBranches.totalStale'),
      ev('... fully merged into the default branch and not default/current (safe to delete)', m.safeToDelete, PR, `staleBranches.safeToDelete (${m.safePct}% of stale)`),
      ev('... of which in madness repos', m.safeMadness, PR, 'staleBranches.byRepoKind.madness.safeToDelete'),
      ev('... of which in work repos (aggregate)', m.safeWork, PR, 'staleBranches.byRepoKind.work.safeToDelete'),
      ev('Stale but NOT merged (needs a human look), madness repos', m.notMergedMadness, PR, 'staleBranches.byRepoKind.madness.notMerged'),
      ev('Stale but NOT merged, all kinds', m.notMerged, PR, 'staleBranches.notMerged'),
      ev('Agent `git branch` calls that errored (percent)', m.branchErrorPct, AGS, `perSubcommand.branch.errors (${m.branchErrors}) / count (${m.branchCalls})`),
      ev('"branch not fully merged" refusals after a delete attempt', m.branchNotFullyMerged, PR, 'afterNotFullyMerged.count'),
    ],
    estimated_cost: `estimate: ${m.safeToDelete} branches x ~0.5 min each to find, judge and delete one at a time = ~${round(m.safeToDelete * 0.5, 0)} min one-off backlog, then a small recurring cost. Mainly a clutter/orientation cost: the branch dropdown lists every one of them. Rests on the merged-branch count (measured by the probe) and minutes (assumed). It is a backlog, so the frequency is a one-off stock rather than a rate (gap: no per-week creation rate computed).`,
    git_primitive: 'git branch --merged <default> (candidates), git branch -d (refuses unmerged), git update-ref refs/madness/trash/<name> <sha> (backup), git branch -vv for ahead/behind of the unmerged ones',
    proposed_control: 'In the interactive branch dropdown footer: "Clean up N merged branches..." opens a sheet. Section 1 "Merged into <default>, older than 60 days" lists each branch with tip date and last subject, all checked. Section 2 "Not merged" shows ahead count and last subject, all unchecked, with a "compare" link. Delete writes refs/madness/trash/<name> for every deleted branch first. A "Recently cleaned up" tab in the same sheet lists trash refs with a Restore button. Local branches only; remote deletion is never offered here.',
    undo_story: 'each deleted branch keeps refs/madness/trash/<name>-<timestamp>; "Restore" recreates the branch from it (git branch <name> <trash ref>); trash refs older than 90 days are offered for purge, never auto-purged',
    safety: 'destructive-with-backup',
    madness_mode_only: true,
    effort: 'M',
  },
  {
    key: 'stash',
    title: 'Stash browser with age, convert-to-branch, and a backup on drop',
    audience: 'human',
    params: { events: m.stashTotal, events_what: 'stashes sitting in repos (to triage once, then keep tidy)', minutes_each: 3, fixability: 0.8 },
    evidence: [
      ev('Stashes across scanned repos', m.stashTotal, PR, `stashes.total (${m.stashRepos} repos)`),
      ev('... older than 90 days', m.stashOlder90, PR, "stashes.buckets['>90d']"),
      ev('Median stash age in days', m.stashMedianDays, PR, 'stashes.medianDays'),
      ev('Oldest stash in days', m.stashOldestDays, PR, 'stashes.oldestDays'),
      ev('Stashes in repos whose working tree is clean now (likely forgotten)', m.stashInCleanRepo, PR, 'stashes.inRepoNowClean'),
      ev('Stashes in madness repos', m.stashMadness, PR, 'stashes.byRepoKind.madness'),
      ev('Agent stash calls that errored', m.stashErrors, AGS, `perSubcommand.stash.errors of ${m.stashCalls} calls`),
      ev('Agent `stash pop` calls (stash used as a temporary parking spot)', m.stashPopCalls, AG, 'rows subcommand=stash whose command matches /stash pop/'),
    ],
    estimated_cost: `estimate: ${m.stashTotal} stashes x ~3 min to look at, decide, apply or drop = ~${m.stashTotal * 3} min one-off, but the real cost is risk: ${m.stashOlder90} stashes older than 90 days are effectively lost work (median ${m.stashMedianDays} days). Rests on the probe's counts (measured) and minutes (assumed). Today the app has a single-stash flow, so older entries are invisible.`,
    git_primitive: 'git stash list --format=%gd|%ct|%gs, git stash show -p, git stash branch <name> <stash>, git stash apply, git stash drop (with git update-ref refs/madness/stash-trash/<ts> <stash sha> first)',
    proposed_control: 'Extend the existing stash entry in the Changes tab into a "Stashes (N)" list in the same panel: each row shows message, branch it was made on, age, files touched; rows older than 90 days get an amber "forgotten?" badge. Row actions: Apply, Pop, "Turn into branch" (git stash branch), Drop. Drop writes refs/madness/stash-trash/<timestamp> first and the row moves to a "Dropped" section for 30 days with a Restore button.',
    undo_story: 'apply/pop: pop is reversible via "Dropped" restore; drop: refs/madness/stash-trash/<ts> keeps the stash commit alive, Restore does git stash store; turn-into-branch: delete the branch, the stash is kept until you drop it explicitly',
    safety: 'destructive-with-backup',
    madness_mode_only: true,
    effort: 'M',
  },
  {
    key: 'history-search',
    title: 'History search: message, content (pickaxe) and file history, with contained-in chips',
    audience: 'both',
    params: { events: m.historyQuestionCalls, events_what: 'agent calls asking which commit touched X or whether a commit is already in a branch', minutes_each: 0.3, fixability: 0.6 },
    evidence: [
      ev('Agent git log calls', m.logCalls, AG, 'rows subcommand=log'),
      ev('... that search content/message or follow a file (-S, -G, --grep, --follow)', m.logSearchOrFollow, AG, 'rows subcommand=log with any flag in {-S*, -G, --grep*, --follow}'),
      ev('"Is commit X in branch Y" asks: merge-base --is-ancestor', m.mergeBaseIsAncestor, AG, 'rows subcommand=merge-base with flag --is-ancestor'),
      ev('"Which branches contain X" asks: branch --contains', m.branchContains, AG, 'rows subcommand=branch with flag --contains'),
      ev('git log retry sequences (log is the most-retried subcommand)', m.logRetrySeqs, AGS, 'retrySequencesBySubcommand.log'),
      ev('git blame calls', m.blameCalls, AGS, 'perSubcommand.blame.count'),
    ],
    estimated_cost: `estimate: ${m.historyQuestionCalls} calls x ~0.3 min = ~${round(m.historyQuestionCalls * 0.3, 0)} agent-minutes, plus ${m.logRetrySeqs} log retry sequences (flag-wrangling). Human cost is unmeasured: Dan's shell history has only 2 git commands, so any human demand for pickaxe search must be inferred (gap). Rests on counts (measured) and per-call minutes (assumed).`,
    git_primitive: 'git log -S<text> / -G<regex> / --grep=<text> / --follow -- <path>, git branch --contains <sha>, git tag --contains <sha>, git merge-base --is-ancestor',
    proposed_control: 'History tab: a search box with a mode dropdown (Message | Changed text | File). "Changed text" runs git log -S (toggle -G for regex) and lists matching commits; "File" runs --follow on a path picked from the changed-files list. Selecting any commit shows a "Contained in" row of chips (branches and tags that contain it, from --contains) so "is it merged yet?" needs no extra step. Also exposed to agents as `madness-git find --text|--msg|--file <q> [--json]`.',
    undo_story: 'read-only, nothing to undo',
    safety: 'read-only',
    madness_mode_only: true,
    effort: 'M',
  },
  {
    key: 'commit-paths',
    title: 'Commit explicit paths with preflight and a receipt (agent surface)',
    audience: 'agent',
    params: { events: m.verifyNextToolCall + m.addErrors + m.commitErrors, events_what: 'extra round trips after commit/push to verify, plus add/commit errors', minutes_each: 0.3, fixability: 0.7 },
    evidence: [
      ev('Agent commit and push calls', m.commitPushCalls, AG, 'rows subcommand in {commit,push}'),
      ev('... followed by a status/diff/log/show check in the same tool call or the next one within 60s', m.commitPushVerified, AG, `same-call (${m.verifySameToolCall}) or next-call<=60s (${m.verifyNextToolCall}); ${m.commitPushVerifiedPct}% of commit/push`),
      ev('Extra round trips (verify in the NEXT tool call)', m.verifyNextToolCall, AG, 'commit/push rows whose next tool call (<=60s) is a status/diff/log/show'),
      ev('git add errors', m.addErrors, AGS, `perSubcommand.add.errors of ${m.addCalls}`),
      ev('git commit errors', m.commitErrors, AGS, `perSubcommand.commit.errors of ${m.commitCalls}`),
      ev('pathspec errors', m.errPathspec, AGS, 'topErrorSignatures entry "pathspec"'),
      ev('ignored-path add errors', m.errIgnoredPath, AGS, 'topErrorSignatures entry starting "Exit code 1 The following paths are ignored"'),
      ev('nothing-to-commit errors', m.errNothingToCommit, AGS, 'topErrorSignatures entry "nothing to commit"'),
      ev('add and commit retry sequences', m.addCommitRetrySeqs, AGS, 'retrySequencesBySubcommand.add + .commit'),
    ],
    estimated_cost: `estimate: ${m.verifyNextToolCall} avoidable verify round trips + ${m.addErrors + m.commitErrors} failed add/commit calls (some of those errors are guard hook blocks, not git; see speculative list) x ~0.3 agent-minutes = ~${round((m.verifyNextToolCall + m.addErrors + m.commitErrors) * 0.3, 0)} agent-minutes. Most verification already happens inside the same tool call (${m.verifySameToolCall}), so the saving is mainly tokens of repeated output, not round trips. Rests on counts (measured) and minutes (assumed).`,
    git_primitive: 'git add -- <paths> after git check-ignore -q and git ls-files --error-unmatch preflight, git commit -F <msg> -- <paths> (path-limited, never add -A), then git rev-parse HEAD and git status --porcelain=v2 --branch for the receipt',
    proposed_control: 'CLI `madness-git commit --paths a b c --message-file m.txt [--push] [--json]` (optional MCP tool `commit_paths`). Preflight refuses with a specific reason: path ignored, path unknown, nothing staged after filtering. Output is one JSON receipt: new sha, branch, files and +/- stat, ahead/behind after, and push result with the remote rejection reason when there is one. The GUI shows the same commit in History with a small "via madness-git" marker so a human can see what an agent did.',
    undo_story: 'commit: reflog entry commit: ... plus the receipt carries the previous HEAD sha, `madness-git undo` is git reset --soft <previous HEAD> (refused if the commit was pushed); push: not undone, the receipt says "pushed" in plain words',
    safety: 'reversible',
    madness_mode_only: true,
    effort: 'M',
  },
  {
    key: 'worktree-peek',
    title: 'Worktree-safe read surface: sibling HEADs in the worktree panel and CLI',
    audience: 'agent',
    params: { events: m.isoRefusals, events_what: 'worktree-isolation refusals of git commands', minutes_each: 0.3, fixability: 0.5 },
    evidence: [
      ev('Worktree-isolation refusals ("names git in a form too complex to verify")', m.isoRefusals, PR, 'isolatedInWorktree.total'),
      ev('... in distinct sessions', m.isoSessions, PR, 'isolatedInWorktree.sessions'),
      ev('... on read-only subcommands', m.isoReadOnly, PR, `isolatedInWorktree.total (${m.isoRefusals}) minus add+commit+push (${m.isoRefusals - m.isoReadOnly}); ${m.isoReadOnlyPct}%`),
      ev('... of which git log', m.isoLog, PR, 'isolatedInWorktree.bySubcommand.log'),
      ev('Agent worktree subcommand calls overall', m.worktreeCalls, AGS, 'perSubcommand.worktree.count'),
    ],
    estimated_cost: `estimate: ${m.isoRefusals} refused calls x ~0.3 agent-minutes (the retry after the refusal) = ~${round(m.isoRefusals * 0.3, 0)} agent-minutes. HYPOTHESIS, not verified: the refusal is keyed on how a command names git, so a differently-named wrapper command might not be refused. Fixability is 0.5 for that reason. All ${m.isoRefusals} cluster in a few worktree-isolated work sessions (aggregate only here).`,
    git_primitive: 'git worktree list --porcelain, git -C <worktree> log -1 --format=%H|%ct|%s, git rev-list --left-right --count <default>...<branch>',
    proposed_control: 'Worktrees panel (already in the app): each row gains HEAD short sha, subject, age, branch, ahead/behind versus the default branch and dirty flag. CLI `madness-git worktrees --json` returns the same rows in one call, so an isolated session asking "what is on main / the other worktree" does not need `git -C <other> log`.',
    undo_story: 'read-only, nothing to undo',
    safety: 'read-only',
    madness_mode_only: false,
    effort: 'S',
  },
];

for (const f of F) { f.score = round(f.params.events * f.params.minutes_each * f.params.fixability, 1); }
F.sort((a, b) => b.score - a.score);
F.forEach((f, i) => { f.rank = i + 1; f.id = `F${String(i + 1).padStart(2, '0')}-${f.key}`; });

const speculative = [
  { id: 'S1-guard-false-positives', title: 'PreToolUse guard hooks blocking read-only git commands', audience: 'agent',
    evidence: [
      ev('Hook-blocked git calls', m.hookFailTotal, PR, 'hookFailures.total'),
      ev('guard:piped-verification blocks', m.hookFailByHook['guard:piped-verification'], PR, 'hookFailures.byHook'),
      ev('guard:git-add-all blocks', m.hookFailByHook['guard:git-add-all'], PR, 'hookFailures.byHook'),
      ev('eslint-gate.sh blocks (an Inventorium hook blocking unrelated git commands)', m.hookFailByHook['PreToolUse:Bash script:eslint-gate.sh'], PR, 'hookFailures.byHook'),
      ev('Share on read-only git subcommands (percent)', m.hookFailReadOnlySharePct, PR, 'hookFailures.readOnlySubcommandShare * 100'),
    ],
    gap: 'These are Claude Code PreToolUse guards, not git and not the app. The fix lives in Anathesmelt guard_tool_use.py (a redirect like `git show HEAD:f > file` trips piped-verification) and the Inventorium eslint-gate.sh, not in madnessDesktop. Only the commit-paths CLI (F07) would sidestep the add-all blocks. Recorded as an oddity for a todo, not a madnessDesktop feature.' },
  { id: 'S2-push-rejected-recovery', title: 'Guided recovery after a rejected push (fetch, show divergence, pull --rebase --autostash)', audience: 'both',
    evidence: [ev('Rejected pushes', m.pushRejected, PR, 'afterRejected.count'), ev('Share of agent push calls (percent)', m.pushRejectedPct, PR, `afterRejected.count / perSubcommand.push.count (${m.pushCalls}) * 100`)],
    gap: 'Only 22 events, and a failed compound call shares one error across all its git invocations so some are misattributed. Also unknown whether the stock Desktop pull prompt already covers it. Needs a cleaner sample before building.' },
  { id: 'S3-fold-auto-commit-runs', title: 'Fold runs of auto-commit watcher commits in History', audience: 'human',
    evidence: [ev('Madness-repo commits that are auto-stream', m.madnessAutoCommits, CM, 'repoKind=madness autoStream=true'), ev('Share of all madness commits (percent)', m.madnessAutoPct, CM, `autoStream / ${madAll.length} madness commits * 100`), ev('... in just two config/history-dump repos', m.madnessAutoTwoRepos, CM, 'repo path ends /Anathesmelt or /cursor_chathistory')],
    gap: 'The commit volume is real but there is no data on how often the app opens those two repos or scrolls their history. Cost to Dan is unmeasured. Cheap (S) and read-only if wanted; held back for lack of demand evidence.' },
  { id: 'S4-save-point-refs', title: '"Save point" button that stores a hidden ref instead of a commit named save', audience: 'human',
    evidence: [ev('Madness human commits labeled wip-checkpoint (gemini)', m.madnessWipCheckpoint, CL, 'classified.jsonl label=wip-checkpoint joined to commits.jsonl repoKind=madness autoStream=false')],
    gap: 'No measure of harm (are these later squashed? do they hide real changes?) and no repo-level breakdown tied to the app. Also overlaps the existing stash feature.' },
];
const dropped = [
  { idea: 'Pre-reset backup ref', reason: 'madness reflogs show 111 resets but 97 are one automated vendor-sync loop (reset to FETCH_HEAD in a single vendored repo); the remaining 14 do not make a case.' },
  { idea: 'Peek at another branch without checking out', reason: 'checkout ping-pong within 10 min is 43 in total, only 3 in madness repos (nearly all in work repos); too thin.' },
  { idea: 'Detached-HEAD warning', reason: 'detached HEADs in madness repos are mostly submodule checkouts, which are detached by design; no friction evidence.' },
];

const out = {
  generatedAt: new Date().toISOString(),
  generatedBy: 'scripts/archaeology/findings.mjs',
  rankingMethod: 'score = events x minutes_each x fixability. events is a measured count; minutes_each and fixability are estimates (marked per finding in params and estimated_cost). Rerun the script to reproduce every evidence.number. Ordering is sensitive to the estimates; see params.',
  dataNotes: [
    'Agent data is 2026 only, from Claude Code transcripts; Dan has 2 git commands in zsh history vs 16213 agent git calls, so human-in-GUI friction is inferred from commits and reflogs.',
    'Reflog months older than ~90 days are partial.',
    'Work-kind repos were analyzed locally only (regex/heuristics, never sent to gemini); they appear as aggregate counts.',
  ],
  findings: F.map(f => ({ id: f.id, rank: f.rank, title: f.title, audience: f.audience, evidence: f.evidence, estimated_cost: f.estimated_cost, git_primitive: f.git_primitive, proposed_control: f.proposed_control, undo_story: f.undo_story, safety: f.safety, madness_mode_only: f.madness_mode_only, effort: f.effort, score_inputs: f.params, score: f.score })),
  speculative,
  dropped,
  metrics: m,
};
fs.writeFileSync(`${OUT_DIR}/findings.json`, JSON.stringify(out, null, 2));

// ---------- markdown ----------
const L = [];
L.push('# madnessDesktop friction findings (Git Archaeology, Divine step 2)');
L.push('');
L.push(`Generated ${out.generatedAt} by scripts/archaeology/findings.mjs from the cached miner outputs. Work repos appear only as aggregate counts.`);
L.push('');
L.push('How to read the ranking: score = events x minutes each x fixability. Events are measured counts. Minutes and fixability are my estimates, written next to each finding. The order is sensitive to those estimates, so treat neighbours as ties. Dan runs 2 git commands in zsh against 16,213 agent git calls, so the agent-side evidence is rich and the human-in-GUI side is inferred from commits and reflogs.');
L.push('');
L.push('| # | Finding | Who | Safety | Madness Mode | Effort | Score | Headline evidence |');
L.push('|---|---|---|---|---|---|---|---|');
const headline = {
  snapshot: `${m.orientSharePct}% of ${m.agentGitCalls} agent git calls are status/diff/log; ${m.collapsibleRoundTrips} round trips sit in 60s bursts`,
  fixup: `${m.followupWithin30m} of ${m.madnessFollowupFix} madness follow-up fixes land within 30 min of the previous commit; only ${m.reflogAmendMadness} amends`,
  submodule: `${m.submoduleBumpCommits} madness commits (${m.submoduleBumpPct}%) are submodule/pointer bumps`,
  prune: `${m.safeToDelete} of ${m.staleBranches} stale branches are fully merged (${m.safeMadness} in madness repos)`,
  stash: `${m.stashOlder90} of ${m.stashTotal} stashes are older than 90 days; ${m.stashInCleanRepo} sit in clean repos`,
  'history-search': `${m.historyQuestionCalls} agent search/ancestry calls; log is the most retried subcommand (${m.logRetrySeqs})`,
  'commit-paths': `${m.commitPushVerifiedPct}% of commit/push are followed by a verify; ${m.addErrors + m.commitErrors} add/commit errors`,
  'worktree-peek': `${m.isoRefusals} isolation refusals in ${m.isoSessions} sessions, ${m.isoReadOnlyPct}% read-only`,
};
for (const f of F) L.push(`| ${f.rank} | ${f.title} | ${f.audience} | ${f.safety} | ${f.madness_mode_only ? 'yes' : 'no'} | ${f.effort} | ${f.score} | ${headline[f.key]} |`);
L.push('');
for (const f of F) {
  L.push(`## ${f.rank}. ${f.title}`);
  L.push('');
  L.push(`Audience: ${f.audience}. Safety: ${f.safety}. Madness Mode only: ${f.madness_mode_only ? 'yes' : 'no'}. Effort: ${f.effort}. Score ${f.score} (events ${f.params.events} x ${f.params.minutes_each} min x ${f.params.fixability} fixability; all but events are estimates).`);
  L.push('');
  L.push('Evidence:');
  for (const e of f.evidence) L.push(`- ${e.claim}: **${e.number}** (${e.source_file}; ${e.how_computed})`);
  L.push('');
  L.push(`Cost. ${f.estimated_cost}`);
  L.push('');
  L.push(`Git primitive. ${f.git_primitive}.`);
  L.push('');
  L.push(`Proposed control. ${f.proposed_control}`);
  L.push('');
  L.push(`Undo. ${f.undo_story}.`);
  L.push('');
}
L.push('## Speculative (weak evidence, gap stated)');
L.push('');
for (const s of speculative) {
  L.push(`### ${s.title}`);
  L.push('');
  for (const e of s.evidence) L.push(`- ${e.claim}: **${e.number}** (${e.source_file}; ${e.how_computed})`);
  L.push('');
  L.push(`Gap. ${s.gap}`);
  L.push('');
}
L.push('## Dropped');
L.push('');
for (const d of dropped) L.push(`- ${d.idea}: ${d.reason}`);
L.push('');
fs.writeFileSync(`${OUT_DIR}/findings.md`, L.join('\n'));
console.log(JSON.stringify({ ranked: F.map(f => [f.rank, f.id, f.score]), metrics: m }, null, 1));
