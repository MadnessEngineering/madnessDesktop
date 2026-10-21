// Git Archaeology shared helpers. Local-only; outputs go to OUT_DIR (outside every repo on purpose).
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const LAB = '/Users/d.edens/lab';
export const OUT_DIR = '/Users/d.edens/.cache/madness-archaeology';
export const SINCE = '2026-01-01';
export function ensureOut() { mkdirSync(OUT_DIR, { recursive: true }); }

export function findRepos(root = LAB, maxDepth = 7) {
  const out = [];
  const walk = (dir, depth) => {
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (ents.some(e => e.name === '.git')) out.push(dir); // dir OR file (worktree/submodule)
    if (depth >= maxDepth) return;
    for (const e of ents) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walk(join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

export function repoKind(p) {
  const s = p + '/';
  if (/\/alloy\/|\/elemental-machines\/|\/regressiontestkit\/|\/DVT/i.test(s)) return 'work';
  if (s.includes('/madness_interactive/')) return 'madness';
  return 'other';
}
export const isWorktreeCopy = p => p.includes('/.claude/worktrees/');

export function git(repo, args, opts = {}) {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], ...opts,
    });
  } catch { return null; }
}
