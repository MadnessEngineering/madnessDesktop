#!/usr/bin/env node
// Preload sampler: a local, read-only web page that shows what each
// context-injection path would put in front of an agent for a given repo,
// side by side, with an approximate token cost. Built to look at token spend
// before the git-aware snapshot (Git Archaeology F04) goes live.
//
//   node scripts/archaeology/preload-sampler.mjs   ->  http://127.0.0.1:4747
//
// Panels:
//   A. Old per-prompt hook: the real fetch_omnispindle_context() from
//      Anathesmelt's user_prompt_submit.py, imported and called (no logging,
//      no session writes).
//   B. get_context_bundle as the Omnispindle server ships it today.
//   C. Git-aware prototype: local git snapshot + todos ranked by file overlap
//      + lessons by similarity. The ranking runs here, client side.
//   D. The real SessionStart path: Anathesmelt's work_context.py
//      build_work_context(), imported and called. Server-side ranking via
//      get_context_bundle(files, branch, query). This is what the hook injects
//      when hooks_config git_context_injection is on.
//
// Omnispindle is reached the same way agents reach it: the HTTP MCP endpoint
// and Authorization header from ~/.claude.json. The header is never printed.

import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'

const PORT = Number(process.env.PORT || 4747)
const HOME = os.homedir()
const LAB = path.join(HOME, 'lab/madness_interactive')
const COMMON = path.join(LAB, 'projects/common')
const HOOKS = path.join(LAB, 'Anathesmelt/claude-prime/hooks')
const UV = path.join(HOME, '.local/bin/uv')

// ---------- helpers ----------

// chars/4 undercounted these blocks by ~42%: paths, hex ids and symbols
// tokenize densely. Measured 2026-10-21 with the Measure button below
// (D 693 chars = 290 tokens, B 2975 chars = 1268 tokens), so ~2.4 chars/token.
const CHARS_PER_TOKEN = 2.4
const approxTokens = s => Math.ceil((s || '').length / CHARS_PER_TOKEN)

// Exact count: input-token delta of `claude -p` with and without the block,
// using a fixed system prompt, no tools, no MCP and no hooks so the baseline
// is stable (verified identical across runs). Costs a few thousand tokens.
const CLAUDE_ARGS = ['-p', '--settings', '{"disableAllHooks": true}', '--strict-mcp-config',
  '--mcp-config', '{"mcpServers":{}}', '--system-prompt', 'Reply with OK.', '--tools', '',
  '--output-format', 'json', '--max-turns', '1']
async function claudeInputTokens(prompt) {
  const r = await run('claude', [...CLAUDE_ARGS, prompt], { timeout: 120000 })
  if (!r.ok) throw new Error('claude -p failed: ' + (r.stderr || String(r.err)).slice(0, 200))
  const u = JSON.parse(r.stdout).usage || {}
  return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
}
let baselineTokens = null
async function exactTokens(text) {
  if (!text) return 0
  if (baselineTokens === null) baselineTokens = await claudeInputTokens('OK?')
  return (await claudeInputTokens('OK?\n' + text)) - baselineTokens
}

function run(cmd, args, opts = {}) {
  return new Promise(resolve => {
    const t = Date.now()
    execFile(cmd, args, { timeout: 30000, maxBuffer: 8 << 20, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr), ms: Date.now() - t, err })
    })
  })
}

const git = (repo, ...args) => run('git', ['--no-optional-locks', '-C', repo, ...args])

function listRepos() {
  const out = []
  for (const name of fs.readdirSync(COMMON)) {
    const p = path.join(COMMON, name)
    if (fs.existsSync(path.join(p, '.git'))) out.push(p)
  }
  out.push(path.join(LAB, 'Anathesmelt'))
  return out.sort()
}

// Omnispindle project names are the lowercased repo directory name.
const projectFor = repo => path.basename(repo).toLowerCase().replace(/-/g, '_')

// ---------- MCP client (streamable HTTP) ----------

function mcpConfig() {
  const cfg = JSON.parse(fs.readFileSync(path.join(HOME, '.claude.json'), 'utf8'))
  const here = cfg.projects?.[path.join(COMMON, 'madnessDesktop')]?.mcpServers?.omnispindle
  const s = here?.url ? here : cfg.mcpServers?.omnispindle
  if (!s?.url) throw new Error('no HTTP omnispindle server in ~/.claude.json')
  return { url: s.url, headers: s.headers || {} }
}

let mcp = null
async function mcpPost(body, withSession = true) {
  const { url, headers } = mcp.cfg
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(withSession && mcp.session ? { 'mcp-session-id': mcp.session } : {}),
    },
    body: JSON.stringify(body),
  })
  const sid = res.headers.get('mcp-session-id')
  if (sid) mcp.session = sid
  const text = await res.text()
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 200)}`)
  if (body.id === undefined) return null
  if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue
      try {
        const msg = JSON.parse(line.slice(5))
        if (msg.id === body.id) return msg
      } catch {}
    }
    throw new Error('MCP: no matching event in stream')
  }
  return JSON.parse(text)
}

let rpcId = 1
async function mcpCall(name, args) {
  if (!mcp) {
    mcp = { cfg: mcpConfig(), session: null }
    await mcpPost({
      jsonrpc: '2.0', id: rpcId++, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'preload-sampler', version: '0.1' } },
    }, false)
    await mcpPost({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }
  const t = Date.now()
  const msg = await mcpPost({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } })
  if (msg.error) throw new Error(`MCP ${name}: ${msg.error.message}`)
  const raw = (msg.result?.content || []).map(c => c.text || '').join('\n')
  let data = raw
  try { data = JSON.parse(raw) } catch {}
  return { raw, data, ms: Date.now() - t }
}

// ---------- panel A: old per-prompt hook ----------

async function oldHook(repo) {
  const py = `
import sys, os, json, time
sys.path.insert(0, ${JSON.stringify(HOOKS)})
import user_prompt_submit as u
from urllib.parse import urlparse
p = u.detect_project(); t = time.time(); r = u.fetch_omnispindle_context(p)
uri = os.getenv('MONGODB_URI', 'mongodb://localhost:27017/')
print(json.dumps({"project": p, "text": r, "ms": int((time.time()-t)*1000),
  "dbHost": urlparse(uri).hostname, "dbName": os.getenv('MONGODB_DB', 'swarmonomicon')}))`
  const r = await run(UV, ['run', '--quiet', '--python', '3.12', '--with', 'pymongo', '--with', 'python-dotenv', 'python', '-c', py], { cwd: repo })
  if (!r.ok) return { error: (r.stderr || String(r.err)).trim().split('\n').slice(-3).join('\n') }
  const d = JSON.parse(r.stdout.trim().split('\n').pop())
  const text = d.text || ''
  return {
    text,
    notes: [
      `detect_project() -> "${d.project}" (expected "${projectFor(repo)}")`,
      `reads mongodb host ${d.dbHost}, db "${d.dbName}"`,
      'fires on EVERY prompt',
      text ? '' : 'returned nothing (the hook would inject nothing)',
    ].filter(Boolean),
    ms: d.ms,
    perPrompt: true,
  }
}

// ---------- panel B: server bundle today ----------

async function bundleToday(repo) {
  const r = await mcpCall('get_context_bundle', { project: projectFor(repo) })
  return { text: r.raw, notes: ['raw tool output, as an agent receives it', 'agent must choose to call it'], ms: r.ms, perPrompt: false }
}

// ---------- panel C: git-aware prototype ----------

function sameFile(a, b) {
  const n = s => s.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '')
  a = n(a); b = n(b)
  return a === b || a.endsWith('/' + b) || b.endsWith('/' + a)
}

async function gitSnapshot(repo) {
  const [st, lg, sl, gd] = await Promise.all([
    git(repo, 'status', '--porcelain=v2', '--branch'),
    git(repo, 'log', '-5', '--name-only', '--format=@@%h%x09%cr%x09%s'),
    git(repo, 'stash', 'list'),
    git(repo, 'rev-parse', '--git-dir'),
  ])
  const snap = { branch: '?', ahead: 0, behind: 0, upstream: null, changed: [], commits: [], stash: 0, inProgress: null }
  for (const line of st.stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) snap.branch = line.slice(14)
    else if (line.startsWith('# branch.upstream ')) snap.upstream = line.slice(18)
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/)
      if (m) { snap.ahead = +m[1]; snap.behind = +m[2] }
    } else if (/^[12u] /.test(line)) snap.changed.push(line.split(' ').pop().split('\t')[0])
    else if (line.startsWith('? ')) snap.changed.push(line.slice(2))
  }
  let cur = null
  for (const line of lg.stdout.split('\n')) {
    if (line.startsWith('@@')) {
      const [sha, when, subject] = line.slice(2).split('\t')
      cur = { sha, when, subject, files: [] }
      snap.commits.push(cur)
    } else if (line.trim() && cur) cur.files.push(line.trim())
  }
  snap.stash = sl.stdout.split('\n').filter(Boolean).length
  const gitDir = path.resolve(repo, gd.stdout.trim())
  if (fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))) snap.inProgress = 'merge'
  if (fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))) snap.inProgress = 'rebase'
  return snap
}

async function gitAware(repo, maxTodos, maxLessons) {
  const t = Date.now()
  const snap = await gitSnapshot(repo)
  const touched = [...new Set([...snap.changed, ...snap.commits.flatMap(c => c.files)])]
  const project = projectFor(repo)

  const todosRes = await mcpCall('query_todos', {
    // 'review' means done-awaiting-review, so it is not open work
    filter: { project, status: { $in: ['pending', 'in_progress', 'blocked'] } },
    limit: 500, brief: true,
  })
  const items = todosRes.data?.items || []
  const ranked = items.map(td => {
    // metadata.files is usually a list; some todos store one comma/newline-separated string
    let files = td.metadata?.files || td.files || []
    if (typeof files === 'string') files = files.split(/[,\n]/).map(f => f.trim()).filter(Boolean)
    if (!Array.isArray(files)) files = []
    const hits = touched.filter(f => files.some(tf => sameFile(f, tf)))
    let score = hits.length * 3
    const why = []
    if (hits.length) why.push('touches ' + hits.slice(0, 2).map(h => path.basename(h)).join(', ') + (hits.length > 2 ? ` +${hits.length - 2}` : ''))
    if (td.status === 'in_progress') { score += 2; why.push('in progress') }
    return { id: td.id, description: td.description || '', status: td.status, priority: td.priority, score, why, fileCount: files.length }
  }).sort((a, b) => b.score - a.score)
  const keptTodos = ranked.filter(r => r.score > 0).slice(0, maxTodos)

  const query = [...snap.commits.map(c => c.subject), ...touched.slice(0, 8)].join(' ; ')
  let lessons = [], lessonNote = ''
  try {
    const lr = await mcpCall('find_relevant', { query, types: ['lessons'], limit: maxLessons })
    const arr = lr.data?.lessons?.items || lr.data?.lessons || lr.data?.results?.lessons || []
    lessons = (Array.isArray(arr) ? arr : []).slice(0, maxLessons)
    const method = lr.data?.lessons?.method || lr.data?.method
    if (method) lessonNote = `lessons matched by ${method}` + (method === 'regex' ? ' (embeddings unavailable on the server, so these are keyword hits, not similarity)' : '')
    if (!lessons.length) lessonNote = 'find_relevant returned no lessons (raw: ' + String(lr.raw).slice(0, 160) + ')'
  } catch (e) { lessonNote = 'find_relevant failed: ' + e.message }

  const short = s => (s.length > 90 ? s.slice(0, 89) + '…' : s)
  const lines = []
  const ab = snap.upstream ? ` ↑${snap.ahead} ↓${snap.behind}` : ' (no upstream)'
  const last = snap.commits[0]
  lines.push(`[git] ${path.basename(repo)} @ ${snap.branch}${ab} · ${snap.changed.length} changed · stash ${snap.stash}${snap.inProgress ? ' · ' + snap.inProgress.toUpperCase() + ' IN PROGRESS' : ''}`)
  if (last) lines.push(`last: ${last.sha} ${short(last.subject)} (${last.when})`)
  if (snap.changed.length) lines.push('changed: ' + snap.changed.slice(0, 6).join(', ') + (snap.changed.length > 6 ? ` +${snap.changed.length - 6}` : ''))
  if (keptTodos.length) {
    lines.push('[todos for this work]')
    for (const k of keptTodos) lines.push(`• ${k.id.slice(0, 8)} [${k.priority || '-'}] ${short(k.description)} (why: ${k.why.join('; ')})`)
  }
  if (lessons.length) {
    lines.push('[lessons]')
    for (const l of lessons) {
      const sim = l.similarity_score ?? l.score
      lines.push(`• ${String(l.id || '').slice(0, 8)} ${short(l.topic || l.title || '')}${sim != null ? ` (why: similarity ${Number(sim).toFixed(2)})` : ''}`)
    }
  }
  if (keptTodos.length || lessons.length) lines.push('(get_todo / get_lesson <id> for detail)')
  return {
    text: lines.join('\n'),
    notes: [
      `project "${project}": ${items.length} open todos scanned, ${ranked.filter(r => r.fileCount).length} carry files, ${ranked.filter(r => r.score > 0).length} matched`,
      `${touched.length} paths touched (working tree + last 5 commits)`,
      lessonNote,
      'injected once per session + on branch switch',
    ].filter(Boolean),
    ms: Date.now() - t,
    perPrompt: false,
    candidates: ranked.slice(0, 15),
    lessonQuery: query,
  }
}

// ---------- panel D: the real SessionStart hook path ----------

async function hookPath(repo, maxTodos) {
  const py = `
import sys, json, time
sys.path.insert(0, ${JSON.stringify(HOOKS)})
import work_context as w
t = time.time(); text, debug = w.build_work_context(${JSON.stringify(repo)}, limit=${Number(maxTodos)})
debug.pop('work_context', None)
print(json.dumps({"text": text, "debug": debug, "ms": int((time.time()-t)*1000)}))`
  const r = await run(UV, ['run', '--quiet', '--python', '3.12', 'python', '-c', py], { cwd: repo })
  if (!r.ok) return { error: (r.stderr || String(r.err)).trim().split('\n').slice(-3).join('\n') }
  const d = JSON.parse(r.stdout.trim().split('\n').pop())
  return {
    text: d.text || '',
    notes: [
      `snapshot from ${d.debug.snapshot_source || '?'}`,
      d.debug.reason || 'server work_context ok',
      'regex lesson hits are dropped; only semantic matches are injected',
      'gated by hooks_config git_context_injection (default off); fresh sessions only',
    ],
    ms: d.ms,
    perPrompt: false,
  }
}

// ---------- server ----------

let lastSample = null
async function sample(repo, opts) {
  const safe = async f => { try { return await f() } catch (e) { return { error: e.message } } }
  const [a, b, c, d] = await Promise.all([
    safe(() => oldHook(repo)),
    safe(() => bundleToday(repo)),
    safe(() => gitAware(repo, opts.maxTodos, opts.maxLessons)),
    safe(() => hookPath(repo, opts.maxTodos)),
  ])
  for (const p of [a, b, c, d]) if (p.text !== undefined) { p.chars = p.text.length; p.tokens = approxTokens(p.text) }
  const out = { repo, project: projectFor(repo), panels: { old: a, today: b, gitAware: c, hook: d } }
  lastSample = out
  return out
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  try {
    if (u.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(PAGE)
    }
    if (u.pathname === '/api/repos') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(listRepos()))
    }
    if (u.pathname === '/api/measure') {
      if (!lastSample) { res.writeHead(400); return res.end('sample first') }
      const exact = {}
      for (const [k, p] of Object.entries(lastSample.panels)) {
        if (p.text === undefined) continue
        try { exact[k] = await exactTokens(p.text) } catch (e) { exact[k] = { error: e.message } }
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ repo: lastSample.repo, exact }))
    }
    if (u.pathname === '/api/sample') {
      const repo = u.searchParams.get('repo')
      if (!listRepos().includes(repo)) { res.writeHead(400); return res.end('unknown repo') }
      const out = await sample(repo, {
        maxTodos: Math.min(10, Number(u.searchParams.get('maxTodos') || 3)),
        maxLessons: Math.min(10, Number(u.searchParams.get('maxLessons') || 3)),
      })
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(out))
    }
    res.writeHead(404); res.end()
  } catch (e) {
    res.writeHead(500); res.end(String(e.message))
  }
})

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Preload Sampler</title>
<style>
:root{--bg:#f3f4f1;--surface:#fff;--fg:#1b201e;--muted:#5d6662;--rule:#d8dcd7;--brass:#8a5a12;--bad:#a33a2c;--ok:#2f7a3a;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#111513;--surface:#181d1b;--fg:#e3e7e4;--muted:#9aa49f;--rule:#2c3330;--brass:#d8a24a;--bad:#ef8c7c;--ok:#7cc98a;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-sans-serif,system-ui,sans-serif}
.wrap{max-width:1400px;margin:0 auto;padding:24px 16px;display:grid;gap:16px}
h1{margin:0;font-size:22px}.muted{color:var(--muted)}
form{display:flex;gap:10px;flex-wrap:wrap;align-items:end}
label{display:grid;gap:4px;font:600 11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
select,input,button{font:14px ui-sans-serif,system-ui;padding:7px 10px;border:1px solid var(--rule);background:var(--surface);color:var(--fg)}
button{background:var(--brass);color:var(--surface);border-color:var(--brass);font-weight:600;cursor:pointer}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px}
.panel{background:var(--surface);border:1px solid var(--rule);padding:14px;display:grid;gap:10px;align-content:start;min-width:0}
.panel h2{margin:0;font-size:16px}
.stats{display:flex;gap:14px;flex-wrap:wrap;font:13px ui-monospace,monospace}
.stats b{font-size:18px}
pre{margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,monospace;background:var(--bg);border:1px solid var(--rule);padding:10px;max-height:420px;overflow:auto}
ul{margin:0;padding-left:18px;font-size:13px;color:var(--muted)}
.err{color:var(--bad);font-family:ui-monospace,monospace;white-space:pre-wrap}
table{border-collapse:collapse;font-size:12px;width:100%}td,th{border-bottom:1px solid var(--rule);padding:4px 6px;text-align:left;vertical-align:top}
.sum{background:var(--surface);border:1px solid var(--rule);padding:12px 14px;font:13px ui-monospace,monospace}
details summary{cursor:pointer;color:var(--muted);font-size:13px}
</style></head><body><div class="wrap">
<div><h1>Preload Sampler</h1><p class="muted">What each context path would inject for a repo, and what it costs. "≈" counts are estimates (chars ÷ 2.4, calibrated); <b>Measure exact</b> asks Claude for real counts (a few thousand tokens per click). Injected text stays in the conversation, so it is re-read as input on every later turn: a once-per-session block costs tokens × turns, and a per-prompt block adds a new copy each turn, so its total grows with the square of the turn count. Most of that re-reading hits the prompt cache, which is billed at about a tenth of the normal input price. Read-only.</p></div>
<form id="f">
<label>Repo<select id="repo"></select></label>
<label>Max todos<input id="mt" type="number" min="0" max="10" value="3"></label>
<label>Max lessons<input id="ml" type="number" min="0" max="10" value="3"></label>
<label>Turns per session<input id="pp" type="number" min="1" value="30"></label>
<button>Sample</button><button type="button" id="measure" disabled>Measure exact</button><span id="status" class="muted"></span>
</form>
<div id="sum" class="sum" hidden></div>
<div class="cols" id="cols"></div>
</div>
<script>
const $=s=>document.querySelector(s)
const NAMES={old:'A · Old per-prompt hook',today:'B · get_context_bundle today',gitAware:'C · Git-aware prototype',hook:'D · Real SessionStart path'}
let last=null, exact={}
fetch('/api/repos').then(r=>r.json()).then(list=>{
  const saved=localStorage.getItem('repo')
  for(const p of list){const o=document.createElement('option');o.value=p;o.textContent=p.split('/').pop();if(p===saved||(!saved&&p.endsWith('/madnessDesktop')))o.selected=true;$('#repo').append(o)}
})
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function render(){
  if(!last)return
  const pp=Number($('#pp').value)||1
  const cols=$('#cols');cols.innerHTML=''
  const sess={}
  for(const [k,p] of Object.entries(last.panels)){
    const d=document.createElement('section');d.className='panel'
    let h='<h2>'+NAMES[k]+'</h2>'
    if(p.error){h+='<div class="err">'+esc(p.error)+'</div>';d.innerHTML=h;cols.append(d);continue}
    const ex=typeof exact[k]==='number'?exact[k]:null
    const t=ex??p.tokens, mark=ex===null?'≈':''
    // once: block re-read on every turn (t*N); per prompt: copy i is re-read N-i+1 times (t*N(N+1)/2)
    const perSession=p.perPrompt?t*pp*(pp+1)/2:t*pp
    sess[k]=mark+Math.round(perSession).toLocaleString()
    h+='<div class="stats"><span><b>'+mark+t.toLocaleString()+'</b> tok/injection'+(ex===null?'':' (measured)')+'</span><span><b>'+mark+Math.round(perSession).toLocaleString()+'</b> input tok/session</span><span>'+p.chars+' chars</span><span>'+p.ms+' ms</span></div>'
    if(exact[k]&&exact[k].error)h+='<div class="err">measure: '+esc(exact[k].error)+'</div>'
    h+='<ul>'+(p.notes||[]).map(n=>'<li>'+esc(n)+'</li>').join('')+'</ul>'
    h+='<pre>'+(p.text?esc(p.text):'<span class="muted">(nothing injected)</span>')+'</pre>'
    if(p.candidates){
      h+='<details><summary>Ranking: top 15 candidates (what got cut)</summary><table><tr><th>score</th><th>todo</th><th>why</th></tr>'+
        p.candidates.map(c=>'<tr><td>'+c.score+'</td><td>'+esc(c.id.slice(0,8)+' '+c.description.slice(0,80))+'</td><td>'+esc(c.why.join('; ')||'-')+'</td></tr>').join('')+'</table></details>'
      h+='<details><summary>Lesson query sent to find_relevant</summary><pre>'+esc(p.lessonQuery)+'</pre></details>'
    }
    d.innerHTML=h;cols.append(d)
  }
  $('#sum').hidden=false
  $('#sum').textContent='Input tokens over a '+pp+'-turn session: '+Object.entries(sess).map(([k,v])=>NAMES[k].split(' · ')[1]+' '+v).join('   |   ')+'   (project "'+last.project+'")'
}
$('#pp').addEventListener('input',render)
$('#f').addEventListener('submit',async e=>{
  e.preventDefault();const repo=$('#repo').value;localStorage.setItem('repo',repo)
  $('#status').textContent='Sampling…'
  const q=new URLSearchParams({repo,maxTodos:$('#mt').value,maxLessons:$('#ml').value})
  const r=await fetch('/api/sample?'+q);if(!r.ok){$('#status').textContent='Error: '+await r.text();return}
  last=await r.json();exact={};$('#status').textContent='';$('#measure').disabled=false;render()
})
$('#measure').addEventListener('click',async()=>{
  $('#measure').disabled=true;$('#status').textContent='Measuring with claude -p (about 10 s per panel)…'
  const r=await fetch('/api/measure');if(!r.ok){$('#status').textContent='Error: '+await r.text();$('#measure').disabled=false;return}
  exact=(await r.json()).exact;$('#status').textContent='';$('#measure').disabled=false;render()
})
</script></body></html>`

server.listen(PORT, '127.0.0.1', () => console.log(`preload sampler: http://127.0.0.1:${PORT}`))
