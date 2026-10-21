#!/usr/bin/env node
// Git Archaeology "Divine" step 1A: classify human commits.
// madness|other rows -> gemini (batches of ~300, cached). work rows -> LOCAL regex only (never leaves the machine).
// Outputs (outside every repo): ~/.cache/madness-archaeology/classified.jsonl, classified-summary.json, gemini-batches/<n>.json
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { OUT_DIR } from './lib.mjs';

const BATCH = 300;
const LABELS = ['feature', 'fix', 'followup-fix', 'wip-checkpoint', 'config-churn', 'revert-or-undo', 'recovery', 'docs', 'refactor', 'chore', 'git-housekeeping', 'experiment'];
const BATCH_DIR = `${OUT_DIR}/gemini-batches`;
mkdirSync(BATCH_DIR, { recursive: true });

const rows = readFileSync(`${OUT_DIR}/commits.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(c => !c.autoStream);
rows.sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : new Date(a.date) - new Date(b.date)));
// minutes since previous commit in same repo (within the human set)
let prev = null;
for (const c of rows) {
  c.mins = prev && prev.repo === c.repo ? Math.max(0, Math.round((new Date(c.date) - new Date(prev.date)) / 60000)) : null;
  prev = c;
}

// ---------- local regex classifier ----------
function regexClassify(c) {
  const s = c.subject.trim(), t = (c.conventionalType || '').toLowerCase();
  const m = c.mins;
  if (/^revert\b|\brevert(ed|ing)?\b|\bundo\b|\broll ?back\b|\bback ?out\b/i.test(s) || t === 'revert') return 'revert-or-undo';
  if (/\brestor(e|ed|ing)\b|\brecover(ed|y|ing)?\b|\brescue\b|\bresurrect|\bbring back\b|\blost\b|\bun-?delete/i.test(s) || t === 'rescue') return 'recovery';
  if (c.isMerge || /^merge\b|\bsubmodule\b|\brebase\b|\bresolve conflict|\bgitignore\b|\bbranch\b.*\b(delete|clean|prune|rename)|\bsync (with|from) (main|master|origin)|\bpointer\b|^update .*(submodule|subrepo)|^bump .*submodule/i.test(s)) return 'git-housekeeping';
  if (/\bwip\b|work in progress|\bcheckpoint\b|\bsave point\b|\bsnapshot\b|^wip|\bwip:|temp commit|\bsavepoint\b/i.test(s)) return 'wip-checkpoint';
  if (/\bexperiment|\bspike\b|\bprototype\b|\btrying\b|\bpoc\b|\bplayground\b|\bsandbox\b/i.test(s) || t === 'experiment') return 'experiment';
  const isFix = t === 'fix' || t === 'hotfix' || /^(fix|fixes|fixed|hotfix|patch|bugfix|repair|correct|resolve)\b|\bfix(es|ed)?\b.*\b(bug|issue|error|crash|broken|typo|regression)|\boops\b|\bforgot\b|\bfix typo\b|\bactually\b|\bagain\b|\btry again\b|\bfollow-?up\b/i.test(s);
  if (isFix) {
    if (m !== null && m <= 120 && /oops|forgot|actually|again|typo|follow-?up|missed|missing|also|really|properly|finish|complete|forgotten|amend|fixup|squash|correct/i.test(s)) return 'followup-fix';
    if (m !== null && m <= 15) return 'followup-fix';
    return 'fix';
  }
  if (/^(docs?|readme|changelog)\b|\bdocs?\b.*\b(update|add|clarify|fix)|\bREADME\b|\bCHANGELOG\b|\.md\b|\bdocument(ation|ed|ing)?\b|\bnotes?\b$/i.test(s) || t === 'docs' || t === 'readme' || t === 'kb' || t === 'runbook') return 'docs';
  if (/\b(refactor|restructure|reorganis|reorganiz|rename|extract|cleanup|clean up|simplify|dedupe|dedup|consolidate|move)\b/i.test(s) || t === 'refactor' || t === 'rename') return 'refactor';
  if (/\b(config|settings?|env|\.env|dependenc|deps|npm|package(-lock)?\.json|yarn|pnpm|lockfile|ci\b|workflow|pipeline|docker|eslint|prettier|tsconfig|husky|hook|lint|gitattributes|tooling|build config|version bump|bump|upgrade|dependabot)\b/i.test(s) || ['build', 'ci', 'tooling', 'deploy', 'bin', 'scripts', 'sec', 'security'].includes(t)) return 'config-churn';
  if (t === 'chore' || /^chore\b|\btidy\b|\bformat(ting)?\b|\bstyle\b|\btypo\b|\bcosmetic\b|\bversion\b|\brelease\b|\bupdate\b$/i.test(s) || t === 'style') return 'chore';
  if (t === 'feat' || /^(add|adds|added|implement|implements|introduce|create|new|support|enable|feat)\b|\bfeature\b/i.test(s)) return 'feature';
  if (/^update\b|^improve|^enhance|^tweak|^adjust|^change|^make|^use\b|^allow/i.test(s)) return (m !== null && m <= 15) ? 'followup-fix' : 'feature';
  return 'chore';
}

// ---------- gemini ----------
const PROMPT = `You classify git commits made by one developer. Each input line is: idx<TAB>repo<TAB>minutes since previous commit in same repo<TAB>subject.
Labels (pick exactly one per line): ${LABELS.join(', ')}.
- followup-fix: fixes or finishes something committed minutes/hours earlier in the same repo (small gap + corrective wording).
- config-churn: settings/env/deps/ci tweaks. git-housekeeping: merges, branch/submodule/rebase tidying. recovery: restoring lost or broken work.
Reply with ONLY JSON lines, one per input line, no prose, no code fences: {"i":<idx>,"c":"<label>","why":"<=8 words"}`;

function callGemini(inputText) {
  // stdout goes to a file: gemini can exit before a pipe drains, truncating large JSON
  const tmpOut = `${BATCH_DIR}/.stdout.tmp`;
  const fd = openSync(tmpOut, 'w');
  let r;
  try {
    r = spawnSync('gemini', ['--skip-trust', '-p', PROMPT], { input: inputText, encoding: 'utf8', stdio: ['pipe', fd, 'pipe'], timeout: 600000, cwd: OUT_DIR });
  } finally { closeSync(fd); }
  const stdout = readFileSync(tmpOut, 'utf8');
  if (r.status !== 0 && !stdout) return { ok: false, err: `exit ${r.status} ${String(r.stderr || '').slice(-200)}` };
  try {
    const j = JSON.parse(stdout);
    if (typeof j.response !== 'string') return { ok: false, err: 'no .response' };
    return { ok: true, text: j.response };
  } catch (e) {
    return { ok: false, err: 'stdout not JSON: ' + stdout.length + ' bytes, tail ' + JSON.stringify(stdout.slice(-80)) };
  }
}
function parseLines(text, lo, hi) {
  const out = {};
  const clean = text.replace(/```(?:json|jsonl)?/gi, '');
  for (const line of clean.split('\n')) {
    const m = line.match(/\{[^{}]*\}/);
    if (!m) continue;
    try {
      const o = JSON.parse(m[0]);
      if (Number.isInteger(o.i) && o.i >= lo && o.i < hi && LABELS.includes(o.c)) out[o.i] = { c: o.c, why: String(o.why || '').slice(0, 80) };
    } catch {}
  }
  return out;
}

const gRows = []; // {idx,c}
rows.forEach((c, k) => { c.idx = k; });
const gIdx = rows.filter(c => c.repoKind === 'madness' || c.repoKind === 'other');
// (idx = global position among all human rows; only madness|other lines are ever emitted to gemini)
const batches = [];
for (let i = 0; i < gIdx.length; i += BATCH) batches.push(gIdx.slice(i, i + BATCH));

let calls = 0, failures = 0, cachedBatches = 0;
const gemLabel = new Map(); // idx -> {c,why}
const unparsed = [];
for (let n = 0; n < batches.length; n++) {
  const b = batches[n];
  const file = `${BATCH_DIR}/${n}.json`;
  let res = null;
  if (existsSync(file)) { try { res = JSON.parse(readFileSync(file, 'utf8')); cachedBatches++; } catch {} }
  if (!res) {
    const lo = Math.min(...b.map(c => c.idx)), hi = Math.max(...b.map(c => c.idx)) + 1;
    const input = b.map(c => `${c.idx}\t${basename(c.repo)}\t${c.mins ?? 'first'}\t${c.subject.replace(/[\t\n]/g, ' ').slice(0, 200)}`).join('\n');
    let got = {};
    let attempts = 0;
    for (; attempts < 2; attempts++) {
      calls++;
      const r = callGemini(input);
      if (!r.ok) { failures++; console.error(`batch ${n} attempt ${attempts + 1} failed: ${r.err}`); continue; }
      got = parseLines(r.text, lo, hi);
      if (Object.keys(got).length >= b.length * 0.5) break;
      failures++; console.error(`batch ${n} attempt ${attempts + 1} parsed only ${Object.keys(got).length}/${b.length}`);
    }
    const missing = b.filter(c => !got[c.idx]).map(c => c.idx);
    res = { n, size: b.length, labels: got, unparsed: missing };
    if (Object.keys(got).length) writeFileSync(file, JSON.stringify(res)); // only cache usable results
  }
  for (const [i, v] of Object.entries(res.labels)) gemLabel.set(+i, v);
  console.error(`batch ${n}/${batches.length}: ${Object.keys(res.labels).length}/${b.length} labeled`);
}

// ---------- merge ----------
const out = [];
for (const c of rows) {
  let label, method;
  if (c.repoKind === 'work') { label = regexClassify(c); method = 'regex'; }
  else if (gemLabel.has(c.idx)) { label = gemLabel.get(c.idx).c; method = 'gemini'; }
  else { label = regexClassify(c); method = 'regex'; unparsed.push(c.idx); }
  out.push({ sha: c.sha, repoKind: c.repoKind, label, method, repo: c.repo, mins: c.mins, date: c.date });
}
writeFileSync(`${OUT_DIR}/classified.jsonl`, out.map(o => JSON.stringify({ sha: o.sha, repoKind: o.repoKind, label: o.label, method: o.method })).join('\n') + '\n');

const hist = {};
for (const o of out) { const k = `${o.repoKind}:${o.method}`; (hist[k] ||= {})[o.label] = (hist[k][o.label] || 0) + 1; }
const byRepo = {};
for (const o of out) { const r = (byRepo[o.repo] ||= { n: 0, ff: 0, kind: o.repoKind }); r.n++; if (o.label === 'followup-fix') r.ff++; }
const ffRate = Object.entries(byRepo).filter(([, r]) => r.n >= 20).map(([repo, r]) => ({ repo: basename(repo), kind: r.kind, commits: r.n, followupFix: r.ff, rate: +(r.ff / r.n).toFixed(3) })).sort((a, b) => b.rate - a.rate).slice(0, 15);
// median minutes feature -> next followup-fix in same repo
const gaps = [];
for (let i = 0; i < out.length; i++) {
  if (out[i].label !== 'followup-fix') continue;
  for (let j = i - 1; j >= 0 && out[j].repo === out[i].repo; j--) {
    if (out[j].label === 'feature') { gaps.push((new Date(out[i].date) - new Date(out[j].date)) / 60000); break; }
  }
}
gaps.sort((a, b) => a - b);
const med = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
const summary = {
  generatedAt: new Date().toISOString(), humanRows: out.length, geminiEligible: gIdx.length, geminiLabeled: gemLabel.size,
  geminiCalls: calls, geminiFailures: failures, cachedBatches, batches: batches.length, unparsedFellBackToRegex: unparsed.length,
  labelHistogramByKindMethod: hist,
  followupFixRateTop15: ffRate,
  featureToFollowupFix: { pairs: gaps.length, medianMinutes: med === null ? null : Math.round(med), p25: gaps.length ? Math.round(gaps[Math.floor(gaps.length * 0.25)]) : null, p75: gaps.length ? Math.round(gaps[Math.floor(gaps.length * 0.75)]) : null },
  note: 'work rows regex-only (never sent to gemini). unparsed gemini rows fall back to regex and are marked method:regex.',
};
writeFileSync(`${OUT_DIR}/classified-summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ calls, failures, cachedBatches, labeled: gemLabel.size, eligible: gIdx.length, unparsed: unparsed.length, medianFeatToFollowupMin: summary.featureToFollowupFix }));
