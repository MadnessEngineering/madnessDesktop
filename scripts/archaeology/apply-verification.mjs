#!/usr/bin/env node
// Git Archaeology "Divine" step 3 (apply half): writes verification.json and corrects findings.json / findings.md in place.
// The actual values below are what scripts/archaeology/verify-findings.mjs recomputed from the cached source files
// (sections f01, f01push, rapid, f02, agent, f07, probes, misc, retry, hook). Outputs go to ~/.cache/madness-archaeology only.
// Work-repo data appears only as aggregate counts; nothing here is sent anywhere.
import fs from 'node:fs';
import { OUT_DIR } from './lib.mjs';

const J = JSON.parse(fs.readFileSync(`${OUT_DIR}/findings.json`, 'utf8'));
if (J.verifiedAt) { console.error('findings.json already corrected (verifiedAt present); rerun findings.mjs first to regenerate the original.'); process.exit(1); }
const byId = Object.fromEntries(J.findings.map(f => [f.id, f]));
const spec = Object.fromEntries(J.speculative.map(s => [s.id, s]));
const RV = 'recomputed (verify-findings.mjs';
const ev = (claim, number, section, how) => ({ claim, number, source_file: `${RV} ${section})`, how_computed: how, verified: true });
const setNum = (f, claimStart, number, newClaim, newHow) => {
  const e = f.evidence.find(x => x.claim.startsWith(claimStart));
  if (!e) throw new Error(`no evidence "${claimStart}" in ${f.id}`);
  e.stated_before_verification = e.number; e.number = number; e.corrected = true;
  if (newClaim) e.claim = newClaim;
  if (newHow) e.how_computed = newHow;
};
const mark = f => { f.evidence.forEach(e => { if (e.verified === undefined) e.verified = true; }); };
const score = p => Math.round(p.events * p.minutes_each * p.fixability * 10) / 10;

// ============================== F01 ==============================
{
  const f = byId['F01-fixup'];
  f.title = 'Nudge to fold a follow-up fix into the last commit (amend exists; add the nudge and a fixup for older unpushed commits)';
  f.evidence.find(e => e.claim.startsWith('Madness-repo human commits labeled')).claim = 'Madness-repo human commits labeled followup-fix by gemini (the prompt gave gemini the minutes since the previous commit, so the label is partly defined by the gap)';
  f.evidence.push(
    ev('Baseline: share of ALL madness human commits within 30 min of the previous human commit in the same repo (percent)', 43.1, 'f01', '1550 of 3593; non-followup commits alone are 38.8%, so 83.2% for followup-fix is partly by construction'),
    ev('Of the 292, also share at least one file with the previous commit', 190, 'f01', 'git show --name-only on both commits; the other 102 are unrelated sequential commits'),
    ev('Of the 292, predecessor still contained in a remote ref today', 284, 'f01', 'git branch -r --contains; says nothing about push state when the fix was committed'),
    ev('Pairs inside the remote-tracking reflog window (about 90 days) whose predecessor was NOT yet pushed when the fix was committed', 30, 'f01push', 'refs/remotes/* reflog push times vs author dates; 51 pairs are inside the window (21 were already pushed), 241 are outside and unmeasurable'),
    ev('Madness reflog commit entries since 2026-01-01 (denominator for the 9 amends)', 982, 'f01', 'HEAD reflog action=commit; amends are 0.9% of commits'),
    ev('Of 22 randomly sampled followup-fix pairs read by hand, genuine same-topic follow-ups', 14, 'f01', 'manual read of subjects; the rest are submodule-pointer or unrelated sequential commits (approximate, n=22)'),
  );
  f.evidence.find(e => e.claim.startsWith('Commit amends')).claim = 'Commit amends recorded in madness reflogs since 2026-01-01 (reflog reaches back about 90 days for most repos, so this is a floor)';
  f.score_inputs = { events: 190, events_what: 'madness follow-up-fix commits within 30 min of, and sharing a file with, the previous human commit in the same repo', minutes_each: 3, fixability: 0.3 };
  f.score = score(f.score_inputs);
  f.estimated_cost = 'estimate: 190 follow-up fixes x ~3 min x 0.3 fixability = ~171 score points. Measured: 292 within 30 min, 190 of them touch a file the previous commit touched, and in the 51 pairs that fall inside the remote-reflog window 30 (59%) had an unpushed predecessor, so fixability 0.3 is below the measured ceiling of about 0.59 x 0.65. Assumed: the 3 minutes. The cost is mostly history noise, not lost time: the workshop doctrine is commit, push, fix forward, so a follow-up after a pushed commit is intended, not friction.';
  f.git_primitive = 'git commit --amend --no-edit (HEAD, unpushed) or git commit --fixup=<sha> followed by git rebase --autosquash <sha>^ (older unpushed commit); push state from git branch -r --contains <sha>';
  f.proposed_control = 'Amend already exists (History: "Amend Commit..." on the top commit; hotkey "Amend Last Commit"; amend notice in the commit box), and it is barely used: 9 amends against 982 commits. So add only the nudge: in the Changes commit box, when HEAD is not contained in any remote ref, is yours, is <=30 min old and shares a file with the staged files, show a chip "Fold into last commit: <subject>" that starts the existing amend flow. In History, right-click an unpushed commit -> "Fixup into this commit..." (git commit --fixup + autosquash), enabled only when every commit above it is also unpushed, otherwise disabled with the reason.';
  f.undo_story = 'before any rewrite the app writes refs/madness/backup/<branch>/<timestamp> at the old tip; the toast "Undo" runs git reset --keep <backup ref> (never --hard, which would discard edits made since; --keep refuses instead). HEAD@{1} is the old tip only after a plain amend; after an autosquash rebase the reflog has one entry per replayed commit, so the backup ref (and ORIG_HEAD until the next rewrite) is the recovery path';
  f.confidence = 'medium';
  f.already_exists = 'partial: amend exists (ui/history/commit-list.tsx "Amend Commit...", lib/hotkeys/default-bindings.ts "Amend Last Commit", ui/changes/commit-message.tsx amend notice); the nudge and fixup do not';
  mark(f);
}

// ============================== F02 ==============================
{
  const f = byId['F02-submodule'];
  f.title = 'Submodule pointer bump: prefilled message and bump-all (child-first push and commits-between already exist)';
  f.evidence.push(
    ev('Of the 234 bump-flavored commits, ones that actually change a gitlink (mode 160000)', 210, 'f02', 'git show --raw per commit; 184 change only gitlinks; regex precision 89.7%'),
    ev('Madness human commits that touch any gitlink regardless of subject', 703, 'f02', 'git show --raw on all 3593; 19.6% of madness human commits, so the subject regex undercounts pointer work by about 3x'),
  );
  f.evidence.find(e => e.claim.startsWith('Agent submodule calls')).how_computed = 'rows subcommand=submodule (127: status 72, update 23, add 22, foreach 6, sync 3, absorbgitdirs 1) plus diff with --submodule (31); mostly status, not bump friction';
  f.estimated_cost = 'estimate: 234 bump commits x ~1 min x 0.5 fixability = ~117. Revised down from 1.5 min x 0.7 because the app already does child-first push, shows the commits between recorded and checked-out SHAs in the submodule diff, commits inside a submodule and refreshes the parent gitlink, and has a Submodules panel with pull/push/rollback and push-all. What is left is writing the parent message and one-commit-for-all. Measured: 234 (subject regex) and 210 of them verified as gitlink commits; assumed: minutes and fixability.';
  f.score_inputs = { events: 234, events_what: 'madness human commits whose subject mentions a submodule/pointer bump or update', minutes_each: 1, fixability: 0.5 };
  f.score = score(f.score_inputs);
  f.git_primitive = 'git add <submodule path> (stages the gitlink), git diff --submodule=log (recorded vs checked-out, already used by the diff view), git commit with a message built from git log --format=%s <recorded>..<checked-out> inside the child';
  f.proposed_control = 'Narrowed to what is missing. In the Submodules panel row, show "recorded abc123 -> checked out def456 (+3)" next to the status badge (the data already comes from getSubmoduleCommitsBetween). Add a row button "Stage and prefill" that stages only that gitlink and puts "chore(<name>): bump submodule - <subject 1>; <subject 2>" in the commit box, and a footer "Bump all drifted" that stages every drifted gitlink into one commit with the message prefilled. No push is added: the app already pushes each child before the parent in performPush.';
  f.undo_story = 'ordinary commit: the existing "undo last commit" restores the old gitlinks (reflog entry commit: ...). The control never pushes, so there is no irreversible step in it';
  f.confidence = 'high';
  f.already_exists = 'partial: child-first push (lib/stores/app-store.ts performPush phase 1), commits between SHAs and commit-in-submodule with parent refresh (ui/diff/submodule-diff.tsx), panel with pull/push/rollback/push-all (ui/submodule-management/submodule-panel.tsx), CLI `madhub submodule <op>` (cli/main.ts). Missing: message prefill (no "bump" string in app/src outside theme strings), bump-all single commit, recorded-vs-checked-out on the panel row';
  mark(f);
}

// ============================== F03 ==============================
{
  const f = byId['F03-prune'];
  f.title = 'One-time sweep of merged stale branches (bulk delete with a trash ref)';
  setNum(f, 'Local branches with tip older than 60 days', 1168, 'Local branches with tip older than 60 days (all repos, deduplicated by git common dir; the original probe counted worktree copies twice)');
  setNum(f, '... fully merged', 356, null, 'staleBranches.safeToDelete after dedupe: 356 of 1168 = 30.5% (probe said 514 = 36.7%)');
  setNum(f, '... of which in madness repos', 224);
  setNum(f, '... of which in work repos', 119);
  setNum(f, 'Stale but NOT merged (needs a human look), madness repos', 90);
  setNum(f, 'Stale but NOT merged, all kinds', 216);
  setNum(f, 'Agent `git branch` calls that errored', 10.8, null, 'perSubcommand.branch.errors (23) / count (212) = 10.85%; most are compound-call misattributions');
  setNum(f, '"branch not fully merged" refusals', 1, '"branch not fully merged" refusals after a delete attempt (11 rows, but all from ONE compound tool call; and it is git -d doing its job)');
  f.evidence.push(
    ev('Branch creations recorded in madness repos since 2026-01-01 (HEAD/branch reflogs)', 3, 'probes', 'reflog action branch-created, madness, one each in 2026-01, 2026-04 and 2026-09; reflog is partial past ~90 days, but it means the backlog is not regrowing at any visible rate'),
    ev('Of the 224 merged stale madness branches, ones in just two repos (Swarmonomicon 60, .hammerspoon 56)', 116, 'probes', 'for-each-ref per repo; 108 of 224 are feature/* names; only 33 sit in Inventorium, madnessDesktop and madness_interactive combined'),
  );
  f.score_inputs = { events: 356, events_what: 'stale branches fully merged into the default branch, safe to delete (deduplicated)', minutes_each: 0.5, fixability: 0.5 };
  f.score = score(f.score_inputs);
  f.estimated_cost = 'estimate: 356 branches x ~0.5 min x 0.5 fixability = ~89. Fixability cut from 0.9 to 0.5 because this is a one-time stock, not a rate: 3 branch creations in madness repos since January, so the sweep would be used about once. Measured: 356 deduplicated merged-stale branches (224 madness). Assumed: minutes. Merged branches carry no unique work, so the only cost is dropdown and orientation clutter.';
  f.proposed_control = 'In the interactive branch dropdown footer: "Clean up N merged branches..." opens a sheet. Section 1 "Merged into <default>, older than 60 days" lists each branch with tip date and last subject, all checked. Section 2 "Not merged" shows ahead count and last subject, all unchecked, with a "compare" link. Delete writes refs/madness/trash/<name>-<timestamp> for every deleted branch first. A "Recently cleaned up" tab in the same sheet lists trash refs with a Restore button. Local branches only; remote deletion is never offered here. Build it as one S/M sheet; it is a sweep tool, not a daily one.';
  f.confidence = 'low';
  f.already_exists = 'partial: single-branch "Delete..." only (ui/branches/branch-list-item-context-menu.tsx, ui/delete-branch/delete-branch-dialog.tsx); no bulk or merged-aware cleanup';
  mark(f);
}

// ============================== F04 ==============================
{
  const f = byId['F04-snapshot'];
  f.title = 'Repo snapshot for agents: one standalone call for status, last commits and diffstat across repos';
  setNum(f, 'Round trips collapsible', 281, 'Round trips a snapshot can actually replace: bursts of >=2 consecutive tool calls in which every git invocation is status, log without -S/-G/--grep/--follow/-p, or diff with a stat/name flag (the original 851 also counted content diffs and searches)', 'strict re-run of the burst count: 517 calls in 236 bursts, minus one kept per burst. Upper bound with any status/diff/log is 851');
  setNum(f, 'Ahead/behind probes', 89, null, 'rev-list rows with --count (89); every --left-right row (55) also has --count, so the union is 89, not 144');
  f.evidence.push(
    ev('Git invocations inside the 534 orient bursts (agents already batch: 1385 tool calls hold 1969 invocations)', 1969, 'agent', 'burst tool calls grouped by callId'),
    ev('... of those invocations, diffs that read content (no --stat/--name-only/--numstat)', 544, 'agent', 'a snapshot cannot replace reading an actual diff'),
  );
  f.estimated_cost = 'estimate: 281 avoidable tool-call round trips x ~0.3 agent-minutes x 0.9 fixability = ~76 (original 851 was an upper bound that included content diffs and history searches a snapshot cannot answer). Assumed: the 0.3 min per turn. Real wall time is unmeasured. Agents already compound many of these calls (1969 invocations in 1385 calls), so the gain is mostly tokens and multi-repo -C calls (1527, 9.4% of all calls).';
  f.score_inputs = { events: 281, events_what: 'tool-call round trips inside strictly snapshot-replaceable orient bursts', minutes_each: 0.3, fixability: 0.9 };
  f.score = score(f.score_inputs);
  f.git_primitive = 'git --no-optional-locks status --porcelain=v2 --branch (branch, upstream, ahead/behind, dirty counts; no-optional-locks so a read-only snapshot never takes index.lock against a concurrent commit), git log -3 --format, git diff --shortstat, git stash list, git worktree list --porcelain, plus .git/MERGE_HEAD / rebase-merge presence';
  f.proposed_control = 'One read-only function over several repos, exposed as a standalone Node script (not through the madhub CLI: madhub runs `open -n` to launch a new Electron instance and polls a result file, which costs seconds against a 20 ms git status; the CLI name stays madhub if it is hosted at all, e.g. `madhub snapshot`, with a fast path that does not start the app). Returns branch, upstream, ahead/behind, staged/unstaged/untracked counts with the top changed files, last 3 commits, stash count, sibling worktrees, submodule drift and in-progress merge/rebase, for one or many repos in one call. The human header strip is optional and unverified as a gap over the stock toolbar; skip it unless wanted.';
  f.confidence = 'low';
  f.already_exists = 'no snapshot command. A `madhub` CLI exists (cli/main.ts: open, clone, add, submodule, foreach, group, favorite) but every call launches the app via open -n, so it is not a fast read path';
  mark(f);
}

// ============================== rejected ==============================
const rejected = [];
const origRank = f => ({ original_rank: f.rank, original_score: f.score });
{
  const f = byId['F05-stash'];
  rejected.push({
    id: f.id, title: f.title, ...origRank(f),
    reason: 'Not recurring friction. Deduplicated (worktree copies share one stash list) there are 37 stashes, not 61: 34 older than 90 days, median 540 days, 26 in clean repos. The 13 in madness repos are all 303 to 640 days old, so no stash has been left behind in a madness repo for 10 months; the rest are work repos. 32 of the 37 were created by Desktop\'s own stash flow (!!GitHub_Desktop marker), so the app already shows the latest one per branch when that branch is open. This is a one-off backlog that `git stash list` clears in a sitting, and there is no creation-rate data to justify a browser. Re-raise only if new stashes start appearing.',
    numbers_wrong: [
      { claim: 'Stashes across scanned repos', stated: 61, actual: 37 },
      { claim: '... older than 90 days', stated: 58, actual: 34 },
      { claim: 'Median stash age in days', stated: 582, actual: 540 },
      { claim: 'Stashes in repos whose working tree is clean now', stated: 34, actual: 26 },
      { claim: 'Agent stash calls that errored (15 rows)', stated: 15, actual: '9 distinct tool calls' },
    ],
  });
}
{
  const f = byId['F06-history-search'];
  rejected.push({
    id: f.id, title: f.title, ...origRank(f),
    reason: 'The agent half is refuted: an agent already answers "which commit touched X" or "is it merged" with one `git log -S` / `merge-base --is-ancestor` / `branch --contains` call, so a wrapper saves nothing. The "log is the most retried subcommand (91)" support is not flag wrangling: 43 of the 91 retries start from a PreToolUse guard block (22) or a worktree-isolation refusal (21), the other 48 are mostly compound-call misattributions. 243 of the 336 log searches (72%) are in work projects. The human half (a History search box with contained-in chips) has no demand evidence at all: 2 git commands in Dan\'s zsh history, and no search appears in the app today so it cannot be judged from usage. Re-raise as speculative if Dan asks for search.',
    numbers_wrong: [{ claim: 'log retry sequences read as flag-wrangling', stated: 91, actual: '91 sequences, but 43 follow a guard/isolation block; none shown to be flag trouble' }],
  });
}
{
  const f = byId['F07-commit-paths'];
  rejected.push({
    id: f.id, title: f.title, ...origRank(f),
    reason: 'The headline saving collapses. 247 "extra round trips" are commit/push ROWS whose next tool call was a verify, and 167 of those already verified in the same call; the truly extra ones are 80 rows = 65 tool calls over ten months (about 20 agent-minutes). Of the 103 add/commit errors, 49 are PreToolUse guard blocks (git-add-all and similar) that a path-limited CLI would only route around, not fix, and the rest are mixed compound-call misattributions (pathspec "25" is 7 tool calls). Verifying after a commit is also the workshop\'s own rule (a claim is earned by running the check), so the 61.6% is the discipline working. A `madness-git commit` would be a fifth way to commit next to the app, git, and the guarded agent flow. Corrected score about 25 (119 events x 0.3 x 0.7).',
    numbers_wrong: [
      { claim: 'Extra round trips (verify in the NEXT tool call)', stated: 247, actual: '80 rows (65 tool calls) not already verified in the same call' },
      { claim: 'pathspec errors', stated: 25, actual: '25 rows = 7 tool calls' },
      { claim: 'add/commit errors treated as git failures', stated: 103, actual: '103 rows, 49 of them guard hook blocks' },
    ],
  });
}
{
  const f = byId['F08-worktree-peek'];
  rejected.push({
    id: f.id, title: f.title, ...origRank(f),
    reason: 'The refusals come from the Claude Code harness ("This session is isolated in the worktree"), not from git and not from the app, and all 104 are in work projects (85 from a single project), none in madness repos. The fix rests on an unverified hypothesis that a differently named wrapper would not be refused; if it worked it would be sidestepping a deliberate isolation guard. The existing worktree list shows only name and branch/HEAD (ui/worktrees/worktree-list-item.tsx), so the panel gap is real but unrelated to the refusals, and nothing measures a human wanting sibling HEADs. 104 rows are 70 tool calls in 54 sessions.',
    numbers_wrong: [{ claim: 'Worktree-isolation refusals (rows)', stated: 104, actual: '104 rows = 70 distinct tool calls (54 sessions confirmed)' }],
  });
}
{
  const s = spec['S2-push-rejected-recovery'];
  rejected.push({
    id: s.id, title: s.title, original_rank: null, original_score: null,
    reason: 'The 22 "rejected pushes" are rows whose error signature was "rejected": only 2 of them are push invocations (0.3% of 697 push calls, not 3.2%) and all 22 come from 7 tool calls in 7 sessions, the rest being other git commands in compound calls that shared one error.',
    numbers_wrong: [
      { claim: 'Rejected pushes', stated: 22, actual: '2 push rows (7 tool calls carry all 22 rows)' },
      { claim: 'Share of agent push calls (percent)', stated: 3.2, actual: 0.3 },
    ],
  });
}

// ============================== speculative ==============================
{
  const s = spec['S1-guard-false-positives'];
  s.evidence[0].claim = 'Hook-blocked git rows (the 165 rows come from only 54 distinct tool calls; compound calls repeat one block across their git invocations)';
  s.evidence.push(ev('Distinct tool calls behind the 165 hook-blocked rows (guard:piped-verification 36, guard:git-add-all 9, eslint-gate 9)', 54, 'hook', 'transcript tool_result text per callId'));
  s.evidence.forEach(e => { if (e.verified === undefined) e.verified = true; });
  s.verified = true;
  for (const id of ['S3-fold-auto-commit-runs', 'S4-save-point-refs']) { spec[id].evidence.forEach(e => { e.verified = true; }); spec[id].verified = true; }
}
const dropped = J.dropped.map(d => ({ ...d, verified: true }));
dropped.push({ idea: 'Pre-reset backup ref / checkout peek / detached-HEAD warning (re-checked)', reason: 'Reverified from source: 111 madness resets of which 97 are one `reset: moving to FETCH_HEAD` loop in one vendored repo; 43 checkout ping-pongs of which 3 madness (39 work, 1 other); 23 of 24 madness detached HEADs are submodule gitfiles. The drops stand.', verified: true });

// ============================== final assembly ==============================
const keepIds = ['F01-fixup', 'F02-submodule', 'F03-prune', 'F04-snapshot'];
const kept = keepIds.map(id => byId[id]).sort((a, b) => b.score - a.score);
kept.forEach((f, i) => { f.rank = i + 1; f.verified = true; f.logic_verdict = { 'F01-fixup': 'weak', 'F02-submodule': 'holds', 'F03-prune': 'weak', 'F04-snapshot': 'weak' }[f.id]; });
J.findings = kept;
J.speculative = Object.values(spec).filter(s => s.id !== 'S2-push-rejected-recovery');
J.dropped = dropped;
J.rejected = rejected;
J.verifiedAt = new Date().toISOString();
J.verifiedBy = 'scripts/archaeology/verify-findings.mjs + apply-verification.mjs';
J.rankingMethod += ' Verification (step 3): every evidence number was recomputed from the cached files; corrected values carry stated_before_verification. Scores were revised where the recompute or the app grep changed events, minutes or fixability; confidence is a separate field because F01, F02 and F03 are within a tie band.';
J.dataNotes.push('Many agent error counts are rows, not tool calls: a compound Bash call repeats one error on every git invocation in it. Distinct tool-call counts are given where they differ materially (hook blocks 165 rows = 54 calls; isolation refusals 104 rows = 70 calls; rejected 22 rows = 7 calls).');
J.dataNotes.push('Branch and stash counts in probes.json double counted worktree copies; the corrected figures are deduplicated by git common dir (650 repos, 5 duplicates removed).');
J.dataNotes.push('Label "followup-fix" was produced by gemini given the minutes since the previous commit, so its short gap is partly by construction; the baseline for any madness human commit is 43.1% within 30 min.');
J.dataNotes.push('The app already has: amend (history context menu, hotkey, commit box), child-first submodule push, commits-between in the submodule diff, a Submodules panel, single-branch delete, a latest-stash-per-branch flow, a worktree list, and a `madhub` CLI that launches the app via open -n.');

// ---------- verification.json ----------
const V = [
  { id: 'F01-fixup', numbers_checked: 7, numbers_wrong: [], logic_verdict: 'weak', already_exists: true, already_exists_where: 'amend: ui/history/commit-list.tsx (Amend Commit... on row 0), lib/hotkeys/default-bindings.ts (Amend Last Commit), ui/changes/commit-message.tsx (amend notice); nudge and fixup absent', undo_story_ok: false, undo_story_why: 'backup ref is real, but "reset --hard" would destroy edits made since and HEAD@{1} is only the old tip after a plain amend (autosquash writes one reflog entry per replayed commit); rewritten to reset --keep plus the backup ref', keep: true, notes: 'All 7 numbers reproduce (351, 292, 94, 22, 784, 143, 9). The 83.2% within-30-min share is partly by construction (gemini saw the gap; baseline for all madness commits is 43.1%). Only 190 of 292 share a file with the previous commit and about 14 of 22 hand-read samples were genuine follow-ups. Within the 90-day remote-reflog window 30 of 51 pairs had an unpushed predecessor (241 pairs unmeasurable). Fix-forward is the workshop doctrine so the harm is history noise, not lost time. Score re-based to 190 events x 3 x 0.3 = 171.' },
  { id: 'F02-submodule', numbers_checked: 8, numbers_wrong: [], logic_verdict: 'holds', already_exists: true, already_exists_where: 'child-first push in performPush (lib/stores/app-store.ts), commits-between and commit-in-submodule in ui/diff/submodule-diff.tsx, Submodules panel with push-all in ui/submodule-management/submodule-panel.tsx, `madhub submodule` in cli/main.ts; missing: message prefill, bump-all, row-level recorded-vs-checked-out', undo_story_ok: true, undo_story_why: 'the narrowed control is an ordinary commit with no push, undone by the existing undo-last-commit; the original "push child then bump" step was irreversible and already exists, so it was removed from the proposal', keep: true, notes: 'All 8 numbers reproduce. Regex precision checked with git show --raw: 210 of 234 touch a gitlink. 703 of 3593 madness human commits (19.6%) touch a gitlink at all, so the 234 undercounts. Strongest evidence of recurring clerical work. The original proposal duplicated shipped features; scope cut to message prefill and bump-all, score 234 x 1 x 0.5 = 117.' },
  { id: 'F03-prune', numbers_checked: 8, numbers_wrong: [
    { claim: 'Local branches with tip older than 60 days', stated: 1402, actual: 1168 }, { claim: 'fully merged (safe to delete), all kinds', stated: 514, actual: 356 }, { claim: 'safe, madness repos', stated: 229, actual: 224 }, { claim: 'safe, work repos', stated: 272, actual: 119 }, { claim: 'stale not merged, madness', stated: 91, actual: 90 }, { claim: 'stale not merged, all kinds', stated: 289, actual: 216 }, { claim: 'agent git branch error percent', stated: 10.9, actual: 10.8 }, { claim: 'branch not fully merged refusals', stated: 11, actual: '11 rows from 1 tool call' }, { claim: 'safe share of stale (percent)', stated: 36.7, actual: 30.5 }], logic_verdict: 'weak', already_exists: false, already_exists_where: 'only single-branch Delete... (ui/branches/branch-list-item-context-menu.tsx, ui/delete-branch/delete-branch-dialog.tsx)', undo_story_ok: true, undo_story_why: 'refs/madness/trash/<name>-<ts> keeps the tip commit alive and `git branch <name> <ref>` restores it; merged branches hold no unique work anyway; local only', keep: true, notes: 'The probe double counted worktree copies (655 repos vs 650 unique). It is a one-time stock, not a rate: 3 branch creations in madness repos since January, 116 of 224 madness candidates sit in two repos (Swarmonomicon, .hammerspoon) that may not even be opened in the app. Fixability cut to 0.5, score 356 x 0.5 x 0.5 = 89. Build only as one cheap sweep sheet.' },
  { id: 'F04-snapshot', numbers_checked: 9, numbers_wrong: [
    { claim: 'Round trips collapsible (orient bursts)', stated: 851, actual: '851 only as an upper bound counting content diffs; 281 for calls a snapshot can replace' }, { claim: 'Ahead/behind probes (rev-list --left-right or --count)', stated: 144, actual: 89 }], logic_verdict: 'weak', already_exists: false, already_exists_where: 'no snapshot; the madhub CLI (cli/main.ts) exists but launches the app with open -n and polls a file, so it is not a fast path', undo_story_ok: true, undo_story_why: 'read-only; made honest by requiring git --no-optional-locks so it never takes index.lock against a concurrent commit', keep: true, notes: 'The other 7 numbers reproduce (7468, 46.1%, 4998, 2939, 1527, 1326, 637). 544 of 1969 invocations inside the bursts are content diffs, and agents already compound calls (1969 invocations in 1385 calls). Score 281 x 0.3 x 0.9 = 76. Hosting it in madhub would cost seconds per call; it must be a standalone script.' },
  { id: 'F05-stash', numbers_checked: 8, numbers_wrong: rejected.find(r => r.id === 'F05-stash').numbers_wrong, logic_verdict: 'refuted', already_exists: true, already_exists_where: 'latest Desktop stash per branch (lib/git/stash.ts getStashes/getLastDesktopStashEntryForBranch, ui/stashing/*); 32 of 37 stashes carry the Desktop marker', undo_story_ok: true, undo_story_why: 'update-ref refs/madness/stash-trash/<ts> then git stash store would restore a dropped stash', keep: false, notes: 'Dropped: 37 unique stashes not 61; the 13 madness ones are all 303-640 days old (dead habit, not friction); one-off backlog.' },
  { id: 'F06-history-search', numbers_checked: 6, numbers_wrong: rejected.find(r => r.id === 'F06-history-search').numbers_wrong, logic_verdict: 'refuted', already_exists: false, already_exists_where: 'no history search or contained-in chips in the app (grep for pickaxe, -S, --grep, --contains found nothing)', undo_story_ok: true, undo_story_why: 'read-only', keep: false, notes: 'Counts reproduce (3543, 336, 68, 57, 91, 25) but agents already do this in one native call, 72% of the searches are in work projects, 43 of 91 retries are guard blocks, and there is no human demand evidence.' },
  { id: 'F07-commit-paths', numbers_checked: 9, numbers_wrong: rejected.find(r => r.id === 'F07-commit-paths').numbers_wrong, logic_verdict: 'refuted', already_exists: false, already_exists_where: 'no madness-git commit surface; git-add-all and piped-verification guards already exist in Anathesmelt guard_tool_use.py', undo_story_ok: true, undo_story_why: 'reset --soft to the receipt sha is sound while unpushed', keep: false, notes: '1983/1221/1141/247 reproduce exactly under the ranker definitions, but the avoidable part is 80 rows (65 calls) and half the errors are guard blocks. Fifth way to commit.' },
  { id: 'F08-worktree-peek', numbers_checked: 5, numbers_wrong: rejected.find(r => r.id === 'F08-worktree-peek').numbers_wrong, logic_verdict: 'refuted', already_exists: true, already_exists_where: 'worktree list exists (ui/worktrees/worktree-list.tsx) with name and branch/HEAD only', undo_story_ok: true, undo_story_why: 'read-only', keep: false, notes: 'Counts reproduce (104, 54, 101, 69, 93). The refusals are a harness guard in work sessions only; fix is an unverified bypass.' },
  { id: 'S1-guard-false-positives', numbers_checked: 5, numbers_wrong: [{ claim: 'Hook-blocked git calls', stated: 165, actual: '165 rows = 54 tool calls (36 piped-verification, 9 git-add-all, 9 eslint-gate)' }], logic_verdict: 'weak', already_exists: false, already_exists_where: 'not an app feature', undo_story_ok: true, undo_story_why: 'n/a', keep: true, notes: 'Stays speculative; belongs in a todo for Anathesmelt guard_tool_use.py and the Inventorium eslint-gate.sh. Row counts reproduce, call counts corrected.' },
  { id: 'S2-push-rejected-recovery', numbers_checked: 2, numbers_wrong: rejected.find(r => r.id === 'S2-push-rejected-recovery').numbers_wrong, logic_verdict: 'refuted', already_exists: false, already_exists_where: 'unknown', undo_story_ok: true, undo_story_why: 'n/a', keep: false, notes: 'Dropped: 2 real push rejections out of 697.' },
  { id: 'S3-fold-auto-commit-runs', numbers_checked: 3, numbers_wrong: [], logic_verdict: 'weak', already_exists: false, already_exists_where: 'no run folding in History', undo_story_ok: true, undo_story_why: 'read-only display change', keep: true, notes: '5537, 60.6%, 5345 reproduce. Still no demand evidence; stays speculative.' },
  { id: 'S4-save-point-refs', numbers_checked: 1, numbers_wrong: [], logic_verdict: 'weak', already_exists: false, already_exists_where: 'overlaps stash', undo_story_ok: true, undo_story_why: 'hidden refs are recoverable', keep: true, notes: '104 reproduces. No harm measurement; stays speculative.' },
  { id: 'dropped-ideas', numbers_checked: 6, numbers_wrong: [], logic_verdict: 'holds', already_exists: false, already_exists_where: 'n/a', undo_story_ok: true, undo_story_why: 'n/a', keep: true, notes: 'Drops stand: 111 resets (97 one FETCH_HEAD loop), 43 ping-pongs (3 madness), 23 of 24 madness detached HEADs are submodules.' },
];
fs.writeFileSync(`${OUT_DIR}/verification.json`, JSON.stringify({ generatedAt: J.verifiedAt, generatedBy: 'scripts/archaeology/apply-verification.mjs', summary: { kept: keepIds, rejected: rejected.map(r => r.id), numbersWrongTotal: V.reduce((a, v) => a + v.numbers_wrong.length, 0) }, items: V }, null, 2));
fs.writeFileSync(`${OUT_DIR}/findings.json`, JSON.stringify(J, null, 2));

// ---------- markdown ----------
const L = [];
L.push('# madnessDesktop friction findings (Git Archaeology, Divine step 3: verified)');
L.push('');
L.push(`Verified ${J.verifiedAt}. Every evidence number was recomputed from the cached source files; corrected ones show the earlier value. Work repos appear only as aggregate counts.`);
L.push('');
L.push('How to read the ranking: score = events x minutes each x fixability. Events are measured counts; minutes and fixability are estimates written next to each finding. Ranks 1 to 3 are within a tie band, and confidence is listed separately. Dan runs 2 git commands in zsh against 16,213 agent git calls, so the agent side is rich and the human-in-GUI side is inferred from commits and reflogs. Many agent error counts are rows, not tool calls (a compound call repeats one error); distinct calls are given where it matters.');
L.push('');
L.push('| # | Finding | Who | Safety | Madness Mode | Effort | Score | Verdict | Confidence | Already in app |');
L.push('|---|---|---|---|---|---|---|---|---|---|');
for (const f of J.findings) L.push(`| ${f.rank} | ${f.title} | ${f.audience} | ${f.safety} | ${f.madness_mode_only ? 'yes' : 'no'} | ${f.effort} | ${f.score} | ${f.logic_verdict} | ${f.confidence} | ${f.already_exists.split(':')[0]} |`);
L.push('');
for (const f of J.findings) {
  L.push(`## ${f.rank}. ${f.title}`);
  L.push('');
  L.push(`Audience: ${f.audience}. Safety: ${f.safety}. Madness Mode only: ${f.madness_mode_only ? 'yes' : 'no'}. Effort: ${f.effort}. Verified: ${f.verified}. Verdict: ${f.logic_verdict}. Confidence: ${f.confidence}. Score ${f.score} (events ${f.score_inputs.events} x ${f.score_inputs.minutes_each} min x ${f.score_inputs.fixability} fixability; minutes and fixability are estimates).`);
  L.push('');
  L.push(`Already in the app: ${f.already_exists}`);
  L.push('');
  L.push('Evidence:');
  for (const e of f.evidence) L.push(`- ${e.claim}: **${e.number}**${e.corrected ? ` (corrected, was ${e.stated_before_verification})` : ''} (${e.source_file}; ${e.how_computed})`);
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
for (const s of J.speculative) {
  L.push(`### ${s.title}`);
  L.push('');
  L.push(`Verified: ${s.verified}.`);
  for (const e of s.evidence) L.push(`- ${e.claim}: **${e.number}** (${e.source_file}; ${e.how_computed})`);
  L.push('');
  L.push(`Gap. ${s.gap}`);
  L.push('');
}
L.push('## Rejected in verification');
L.push('');
for (const r of J.rejected) {
  L.push(`### ${r.title}${r.original_rank ? ` (was rank ${r.original_rank}, score ${r.original_score})` : ''}`);
  L.push('');
  L.push(r.reason);
  L.push('');
  for (const w of r.numbers_wrong) L.push(`- Wrong number: ${w.claim}: stated ${w.stated}, actual ${w.actual}`);
  L.push('');
}
L.push('## Dropped earlier (reverified)');
L.push('');
for (const d of J.dropped) L.push(`- ${d.idea}: ${d.reason}`);
L.push('');
fs.writeFileSync(`${OUT_DIR}/findings.md`, L.join('\n'));
console.log(JSON.stringify({ kept: kept.map(f => [f.rank, f.id, f.score]), rejected: rejected.map(r => r.id), numbersWrong: V.reduce((a, v) => a + v.numbers_wrong.length, 0) }));
