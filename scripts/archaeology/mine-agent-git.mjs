#!/usr/bin/env node
// Git Archaeology miner: agent git usage from Claude Code transcripts + human zsh history.
// LOCAL ONLY. Output goes to ~/.cache/madness-archaeology (outside any repo). Never commit/upload it.
// No npm deps. Streams every file line by line.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const HOME = os.homedir();
const OUT_DIR = path.join(HOME, '.cache', 'madness-archaeology');
const ROOTS = [
  '/Users/d.edens/lab/madness_interactive/Anathesmelt/claude-work-remote/projects',
  '/Users/d.edens/lab/madness_interactive/Anathesmelt/claude-prime/projects',
];
const HISTORY = path.join(HOME, '.zsh_history');
const YEAR = '2026';
const RETRY_MS = 2 * 60 * 1000;
const RECOVER_MS = 5 * 60 * 1000;
const READ_ONLY = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'blame', 'remote', 'branch',
  'reflog', 'describe', 'shortlog', 'grep', 'ls-remote', 'cat-file', 'diff-tree', 'rev-list', 'name-rev',
  'for-each-ref', 'config', 'ls-tree', 'merge-base', 'show-ref', 'tag', 'diff-index', 'check-ignore', 'help', 'version']);
const ORIENT = new Set(['status', 'diff', 'log']);

// ---------- redaction ----------
const REDACTIONS = [
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '<token>'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '<token>'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '<token>'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '<token>'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, '<jwt>'],
  [/(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 <redacted>'],
  [/((?:password|passwd|secret|token|api[_-]?key|auth|authorization)\w*\s*[=:]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1<redacted>'],
  [/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g, '$1<redacted>@'],
  [/\b[A-Fa-f0-9]{40,}\b/g, '<hex>'],
  [/\b[A-Za-z0-9+/_-]{48,}={0,2}/g, '<blob>'],
];
function redact(s) {
  if (!s) return s;
  for (const [re, rep] of REDACTIONS) s = s.replace(re, rep);
  return s;
}

// ---------- command parsing ----------
function stripHeredocs(cmd) {
  const lines = cmd.split('\n');
  const out = [];
  let term = null;
  for (const line of lines) {
    if (term !== null) {
      if (line.trim() === term) term = null;
      continue;
    }
    out.push(line);
    const m = line.match(/<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/);
    if (m) term = m[2];
  }
  return out.join('\n');
}

// quote-aware split on && || ; | & newline
function splitCompound(cmd) {
  const segs = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) {
      cur += c;
      if (c === '\\' && q === '"') { cur += cmd[++i] ?? ''; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '\\') { cur += c + (cmd[++i] ?? ''); continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '&' || c === '|' || c === ';' || c === '\n') {
      if ((c === '&' || c === '|') && cmd[i + 1] === c) i++;
      else if (c === '&' && (cmd[i - 1] === '>' || cmd[i + 1] === '>')) { cur += c; continue; }
      segs.push(cur); cur = ''; continue;
    }
    cur += c;
  }
  segs.push(cur);
  return segs.map((s) => s.trim()).filter(Boolean);
}

function tokenize(s) {
  const toks = [];
  let cur = '', q = null, has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"') { cur += s[++i] ?? ''; continue; }
      if (c === q) q = null; else cur += c;
      continue;
    }
    if (c === '"' || c === "'") { q = c; has = true; continue; }
    if (c === '\\') { cur += s[++i] ?? ''; has = true; continue; }
    if (/\s/.test(c)) { if (cur || has) toks.push(cur); cur = ''; has = false; continue; }
    cur += c; has = true;
  }
  if (cur || has) toks.push(cur);
  return toks;
}

const WRAPPERS = new Set(['do', 'then', 'else', 'if', 'while', '!', 'command', 'sudo', 'time', 'exec', 'nohup', 'env', '(', '{', 'xargs']);
function findTool(toks) {
  let i = 0;
  while (i < toks.length) {
    let t = toks[i].replace(/^[({]+/, '');
    if (!t) { i++; continue; }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || WRAPPERS.has(t)) { i++; continue; }
    const base = path.basename(t);
    if (base === 'git' || base === 'gh') return { tool: base, rest: toks.slice(i + 1) };
    return null;
  }
  return null;
}

const GIT_OPT_WITH_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);
function parseGit(rest) {
  let dir = null, sub = null, i = 0;
  while (i < rest.length) {
    const t = rest[i];
    if (t === '-C') { dir = rest[i + 1] ?? null; i += 2; continue; }
    if (GIT_OPT_WITH_ARG.has(t)) { i += 2; continue; }
    if (t.startsWith('--git-dir=') || t.startsWith('--work-tree=')) { i++; continue; }
    if (t.startsWith('-')) { i++; continue; }
    sub = t; i++; break;
  }
  if (!sub) return null;
  const flags = [];
  for (; i < rest.length; i++) {
    const t = rest[i];
    if (t === '--') break;
    if (/^--?[A-Za-z]/.test(t)) flags.push(t.replace(/=.*/, ''));
  }
  return { sub: sub.toLowerCase(), flags: [...new Set(flags)], gitC: dir };
}
function parseGh(rest) {
  const pos = [];
  const flags = [];
  for (const t of rest) {
    if (t.startsWith('-')) { if (/^--?[A-Za-z]/.test(t)) flags.push(t.replace(/=.*/, '')); } else if (pos.length < 2) pos.push(t);
  }
  return { sub: pos.join(' ') || '(none)', flags: [...new Set(flags)], gitC: null };
}

export function extractInvocations(cmd) {
  const res = [];
  const cleaned = stripHeredocs(cmd);
  for (const seg of splitCompound(cleaned)) {
    const found = [];
    const ft = findTool(tokenize(seg));
    if (ft) found.push(ft);
    // command substitutions: $(git ...) / `git ...`
    const subRe = /(?:\$\(|`)\s*(git|gh)\s+([^)`]*)/g;
    let m;
    while ((m = subRe.exec(seg))) found.push({ tool: m[1], rest: tokenize(m[2]) });
    for (const f of found) {
      const p = f.tool === 'git' ? parseGit(f.rest) : parseGh(f.rest);
      if (p) res.push({ tool: f.tool, ...p, text: seg });
    }
  }
  return res;
}

// ---------- error signature ----------
const SIGS = [
  ['rejected', /rejected/i],
  ['non-fast-forward', /non-fast-forward/i],
  ['conflict', /conflict/i],
  ['not a git repository', /not a git repository/i],
  ['would be overwritten', /would be overwritten/i],
  ['pathspec', /pathspec/i],
  ['detached HEAD', /detached HEAD/i],
  ['index.lock', /index\.lock/i],
  ['nothing to commit', /nothing to commit|no changes added to commit/i],
  ['no upstream', /no upstream/i],
  ['Permission denied', /permission denied/i],
  ['Authentication failed', /authentication failed/i],
  ['hook failure', /hook (?:failed|declined|returned|error)|PreToolUse:\w+ hook|pre-(?:commit|push|receive) hook|husky|hook.{0,40}(?:fail|reject|exit)|(?:fail|reject).{0,40}hook/i],
  ['divergent branches', /divergent branches/i],
];
function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (typeof b === 'string' ? b : b?.text ?? '')).join('\n');
  return '';
}
function errorSig(text) {
  for (const [name, re] of SIGS) if (re.test(text)) return { sig: name, named: true };
  let s = redact(text.replace(/\s+/g, ' ').trim()).replace(/\b[0-9a-f]{7,40}\b/g, '<sha>').slice(0, 80);
  return { sig: s || '(empty)', named: false };
}

// ---------- file walking ----------
function* walk(dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield p;
  }
}

// ---------- main ----------
const t0 = Date.now();
fs.mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, 'agent-git.jsonl');
const out = fs.createWriteStream(outPath);
const records = []; // compact, for analysis
const seenIds = new Set();
let filesScanned = 0, linesScanned = 0, bashCalls = 0, parseErrors = 0;

function emit(r) {
  r.command = redact(r.command.length > 300 ? r.command.slice(0, 300) + '…' : r.command);
  out.write(JSON.stringify(r) + '\n');
  records.push({
    session: r.session, source: r.source, kind: r.kind, t: Date.parse(r.timestamp), sub: r.subcommand,
    flags: r.flags, err: r.isError, sig: r.errorSignature, named: r.sigNamed, cmd: r.command, callId: r.callId,
  });
}

async function mineTranscript(file, root) {
  const rel = path.relative(root, file);
  const projDirName = rel.split(path.sep)[0];
  const pending = new Map(); // tool_use id -> {cmd, ts, cwd}
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  const sessionId = path.basename(file, '.jsonl');
  const toEmit = [];
  for await (const line of rl) {
    linesScanned++;
    const hasUse = line.includes('"tool_use"');
    const hasRes = pending.size > 0 && line.includes('"tool_result"');
    if (!hasUse && !hasRes) continue;
    let o;
    try { o = JSON.parse(line); } catch { parseErrors++; continue; }
    const content = o?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type === 'tool_use' && b.name === 'Bash' && typeof b.input?.command === 'string') {
        bashCalls++;
        const ts = o.timestamp;
        if (typeof ts !== 'string' || !ts.startsWith(YEAR)) continue;
        if (seenIds.has(b.id)) continue;
        if (!/\bg(?:it|h)\b/.test(b.input.command)) continue;
        seenIds.add(b.id);
        pending.set(b.id, { cmd: b.input.command, ts, cwd: o.cwd || null });
      } else if (b?.type === 'tool_result' && pending.has(b.tool_use_id)) {
        const p = pending.get(b.tool_use_id);
        pending.delete(b.tool_use_id);
        toEmit.push({ p, id: b.tool_use_id, isError: !!b.is_error, text: resultText(b.content) });
      }
    }
  }
  // unpaired calls (no result seen): isError unknown -> null
  for (const [id, p] of pending) toEmit.push({ p, id, isError: null, text: '' });
  for (const e of toEmit) {
    const invs = extractInvocations(e.p.cmd);
    if (!invs.length) continue;
    let sig = null, named = null;
    if (e.isError) { const r = errorSig(e.text); sig = r.sig; named = r.named; }
    invs.forEach((inv, idx) => emit({
      source: 'agent', kind: inv.tool, timestamp: e.p.ts, session: sessionId,
      project: e.p.cwd || projDirName, projectDir: projDirName,
      subcommand: inv.sub, flags: inv.flags, gitC: inv.gitC,
      isError: e.isError, errorSignature: sig, sigNamed: named,
      compound: invs.length > 1, callId: e.id + ':' + idx, command: inv.text,
    }));
  }
}

async function mineHistory() {
  if (!fs.existsSync(HISTORY)) return 0;
  const rl = readline.createInterface({ input: fs.createReadStream(HISTORY), crlfDelay: Infinity });
  let cur = null, n = 0;
  const flush = () => {
    if (!cur) return;
    const ts = new Date(cur.epoch * 1000).toISOString();
    if (ts.startsWith(YEAR) && /\bg(?:it|h)\b/.test(cur.cmd)) {
      extractInvocations(cur.cmd).forEach((inv, idx) => {
        n++;
        emit({
          source: 'human-shell', kind: inv.tool, timestamp: ts, session: 'zsh-history', project: null, projectDir: null,
          subcommand: inv.sub, flags: inv.flags, gitC: inv.gitC, isError: null, errorSignature: null, sigNamed: null,
          compound: false, callId: `h${cur.epoch}:${cur.seq}:${idx}`, command: inv.text,
        });
      });
    }
    cur = null;
  };
  let seq = 0;
  for await (const line of rl) {
    const m = line.match(/^: (\d+):\d+;(.*)$/);
    if (m) { flush(); cur = { epoch: +m[1], cmd: m[2], seq: seq++ }; }
    else if (cur) cur.cmd += '\n' + line;
  }
  flush();
  return n;
}

for (const root of ROOTS) {
  for (const f of walk(root)) {
    filesScanned++;
    try { await mineTranscript(f, root); } catch (e) { console.error('skip', f, e.message); }
  }
}
const humanN = await mineHistory();
await new Promise((r) => out.end(r));

// ---------- summary ----------
const inc = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const gitRecs = records.filter((r) => r.kind === 'git');
const ghRecs = records.filter((r) => r.kind === 'gh');

const totalsBySource = {};
for (const r of records) {
  const s = (totalsBySource[r.source] ||= { git: 0, gh: 0 });
  s[r.kind]++;
}

const bySub = new Map();
for (const r of gitRecs) {
  if (r.source !== 'agent') continue;
  const s = bySub.get(r.sub) || { count: 0, errors: 0, known: 0, flags: new Map() };
  s.count++;
  if (r.err !== null) s.known++;
  if (r.err) s.errors++;
  for (const f of r.flags) inc(s.flags, f);
  bySub.set(r.sub, s);
}
const perSubcommand = {};
for (const [k, s] of [...bySub.entries()].sort((a, b) => b[1].count - a[1].count)) {
  perSubcommand[k] = {
    count: s.count, errors: s.errors,
    errorRate: s.known ? +(s.errors / s.known).toFixed(4) : null,
    topFlags: top(s.flags, 8).map(([flag, count]) => ({ flag, count })),
  };
}

const sigMap = new Map(), sigEx = new Map();
for (const r of gitRecs) {
  if (r.source !== 'agent' || !r.err) continue;
  inc(sigMap, r.sig);
  if (!sigEx.has(r.sig)) sigEx.set(r.sig, r.cmd.replace(/\s+/g, ' ').slice(0, 120));
}
const topErrorSignatures = top(sigMap, 25).map(([signature, count]) => ({ signature, count, exampleCommand: sigEx.get(signature) }));

// sequences per session (agent git only, chronological)
const sessions = new Map();
for (const r of gitRecs) {
  if (r.source !== 'agent') continue;
  if (!sessions.has(r.session)) sessions.set(r.session, []);
  sessions.get(r.session).push(r);
}
const retryBySub = new Map(), recov = new Map();
for (const arr of sessions.values()) {
  arr.sort((a, b) => a.t - b.t);
  // collapse to one entry per tool call for sequencing
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i];
    if (!a.err) continue;
    const aCall = a.callId.split(':')[0];
    let retried = false, recovered = false;
    for (let j = i + 1; j < arr.length; j++) {
      const b = arr[j];
      if (b.callId.split(':')[0] === aCall) continue;
      const dt = b.t - a.t;
      if (dt > RECOVER_MS) break;
      if (!retried && dt <= RETRY_MS && b.sub === a.sub) { retried = true; inc(retryBySub, a.sub); }
      if (!recovered) { recovered = true; inc(recov, `${a.named ? a.sig : 'other'} -> ${b.sub}`); }
      if (retried && recovered) break;
    }
  }
}
const agentGit = gitRecs.filter((r) => r.source === 'agent');
const ro = agentGit.filter((r) => READ_ONLY.has(r.sub)).length;
const orient = agentGit.filter((r) => ORIENT.has(r.sub)).length;
const humanGit = gitRecs.filter((r) => r.source === 'human-shell');
const humanRo = humanGit.filter((r) => READ_ONLY.has(r.sub)).length;

const ghBySub = new Map();
for (const r of ghRecs) if (r.source === 'agent') inc(ghBySub, r.sub);

const errCount = agentGit.filter((r) => r.err).length;
const knownCount = agentGit.filter((r) => r.err !== null).length;
const summary = {
  generatedAt: new Date().toISOString(),
  runtimeSeconds: +((Date.now() - t0) / 1000).toFixed(1),
  scan: { filesScanned, linesScanned, bashToolUses: bashCalls, jsonParseErrors: parseErrors, dedupedByToolUseId: true },
  notes: [
    'isError is per tool call; in compound commands every git invocation in that call shares the call error/signature.',
    'human-shell history has no outcome data (isError null).',
    'Only 2026-dated entries kept. Commands truncated to 300 chars and redacted.',
  ],
  totalsBySource,
  agentGit: { total: agentGit.length, errors: errCount, errorRate: knownCount ? +(errCount / knownCount).toFixed(4) : null },
  perSubcommand,
  topErrorSignatures,
  retrySequencesBySubcommand: Object.fromEntries(top(retryBySub, 100)),
  retrySequencesTotal: [...retryBySub.values()].reduce((a, b) => a + b, 0),
  topRecoveryPairs: top(recov, 15).map(([pair, count]) => ({ pair, count })),
  readOnlyShare: {
    agentReadOnlyCalls: ro, agentTotal: agentGit.length, agentReadOnlyShare: agentGit.length ? +(ro / agentGit.length).toFixed(4) : null,
    agentOrientStatusDiffLog: orient, agentOrientShare: agentGit.length ? +(orient / agentGit.length).toFixed(4) : null,
    humanReadOnlyShare: humanGit.length ? +(humanRo / humanGit.length).toFixed(4) : null,
    readOnlySet: [...READ_ONLY],
  },
  ghAgentTopSubcommands: top(ghBySub, 15).map(([sub, count]) => ({ sub, count })),
};
fs.writeFileSync(path.join(OUT_DIR, 'agent-git-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ runtimeSeconds: summary.runtimeSeconds, scan: summary.scan, totalsBySource, humanN, records: records.length }));
