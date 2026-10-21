import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { basename, join, resolve } from 'path'

/** Read-only repo snapshot for `madhub snapshot`. Runs as plain Node. */

export interface ISnapshotCommit {
  readonly sha: string
  readonly when: string
  readonly subject: string
  readonly files: ReadonlyArray<string>
}

export interface ISnapshotStatus {
  readonly branch: string
  readonly upstream: string | null
  readonly ahead: number
  readonly behind: number
  readonly changed: ReadonlyArray<string>
}

export interface ISubmoduleDrift {
  readonly path: string
  readonly sha: string
}

export interface IRepoSnapshot extends ISnapshotStatus {
  readonly path: string
  readonly project: string
  readonly commits: ReadonlyArray<ISnapshotCommit>
  readonly stash: number
  readonly worktrees: number
  readonly inProgress: 'merge' | 'rebase' | null
  readonly submoduleDrift: ReadonlyArray<ISubmoduleDrift>
}

export interface ISnapshotError {
  readonly path: string
  readonly error: string
}

/** Omnispindle project name: toplevel dir name, lowercased, '-' -> '_'. */
export const projectFor = (toplevel: string) =>
  basename(toplevel).toLowerCase().replace(/-/g, '_')

// Fixed field counts before the path in porcelain v2 entries.
const ORDINARY_FIELDS = 8 // "1 XY sub mH mI mW hH hI path"
const RENAME_FIELDS = 9 // "2 XY sub mH mI mW hH hI Xscore path\torig"
const UNMERGED_FIELDS = 10 // "u XY sub m1 m2 m3 mW h1 h2 h3 path"

const pathAfter = (line: string, fields: number): string => {
  let idx = 0
  for (let i = 0; i < fields; i++) {
    idx = line.indexOf(' ', idx) + 1
    if (idx === 0) {
      return ''
    }
  }
  return line.slice(idx)
}

/** Parse `git status --porcelain=v2 --branch` output. */
export function parseStatus(out: string): ISnapshotStatus {
  let branch = '?'
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  const changed = new Array<string>()

  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      branch = line.slice('# branch.head '.length)
    } else if (line.startsWith('# branch.upstream ')) {
      upstream = line.slice('# branch.upstream '.length)
    } else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) {
        ahead = parseInt(m[1], 10)
        behind = parseInt(m[2], 10)
      }
    } else if (line.startsWith('1 ')) {
      changed.push(pathAfter(line, ORDINARY_FIELDS))
    } else if (line.startsWith('2 ')) {
      changed.push(pathAfter(line, RENAME_FIELDS).split('\t')[0])
    } else if (line.startsWith('u ')) {
      changed.push(pathAfter(line, UNMERGED_FIELDS))
    } else if (line.startsWith('? ')) {
      changed.push(line.slice(2))
    }
  }
  return { branch, upstream, ahead, behind, changed }
}

/** Format string that `parseLog` understands. */
export const LOG_FORMAT = '--format=@@%h%x09%cr%x09%s'

/** Parse `git log --name-only --format=@@%h%x09%cr%x09%s` output. */
export function parseLog(out: string): ReadonlyArray<ISnapshotCommit> {
  const commits = new Array<{
    sha: string
    when: string
    subject: string
    files: string[]
  }>()
  let cur: typeof commits[number] | null = null
  for (const line of out.split('\n')) {
    if (line.startsWith('@@')) {
      const [sha, when, ...rest] = line.slice(2).split('\t')
      cur = { sha, when, subject: rest.join('\t'), files: [] }
      commits.push(cur)
    } else if (line.trim() && cur) {
      cur.files.push(line.trim())
    }
  }
  return commits
}

/** Count non-empty lines (stash list, worktree list entries). */
export const countLines = (out: string) =>
  out.split('\n').filter(l => l.length > 0).length

/** Count worktrees in `git worktree list --porcelain` output. */
export const countWorktrees = (out: string) =>
  out.split('\n').filter(l => l.startsWith('worktree ')).length

/** Submodules whose checked-out commit differs from the recorded one. */
export function parseSubmoduleDrift(
  out: string
): ReadonlyArray<ISubmoduleDrift> {
  const drift = new Array<ISubmoduleDrift>()
  for (const line of out.split('\n')) {
    if (!line.startsWith('+')) {
      continue
    }
    // "+<sha> <path> (<describe>)"
    const m = /^\+(\S+) (.+?)(?: \(.*\))?$/.exec(line)
    if (m) {
      drift.push({ sha: m[1].slice(0, 10), path: m[2] })
    }
  }
  return drift
}

/** Detect an in-progress operation from the entries present in the git dir. */
export function detectInProgress(
  has: (name: string) => boolean
): 'merge' | 'rebase' | null {
  if (has('rebase-merge') || has('rebase-apply')) {
    return 'rebase'
  }
  return has('MERGE_HEAD') ? 'merge' : null
}

const git = (cwd: string, ...args: string[]): Promise<string> =>
  new Promise((res, rej) => {
    execFile(
      'git',
      ['--no-optional-locks', ...args],
      {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, LC_ALL: 'C' },
      },
      (e, stdout, stderr) =>
        e ? rej(new Error(stderr.trim() || e.message)) : res(stdout)
    )
  })

const optional = (p: Promise<string>) => p.catch(() => '')

export async function snapshotRepo(
  input: string
): Promise<IRepoSnapshot | ISnapshotError> {
  const start = resolve(input)
  let top: string
  try {
    top = (await git(start, 'rev-parse', '--show-toplevel')).trim()
  } catch (e) {
    return {
      path: start,
      error: `not a git repository (${(e as Error).message})`,
    }
  }
  try {
    const [st, lg, sl, wt, gd, sm] = await Promise.all([
      git(top, 'status', '--porcelain=v2', '--branch'),
      optional(git(top, 'log', '-5', '--name-only', LOG_FORMAT)), // empty repo has no log
      optional(git(top, 'stash', 'list')),
      optional(git(top, 'worktree', 'list', '--porcelain')),
      git(top, 'rev-parse', '--git-dir'),
      optional(git(top, 'submodule', 'status')),
    ])
    const gitDir = resolve(top, gd.trim())
    return {
      path: top,
      project: projectFor(top),
      ...parseStatus(st),
      commits: parseLog(lg),
      stash: countLines(sl),
      worktrees: countWorktrees(wt),
      inProgress: detectInProgress(n => existsSync(join(gitDir, n))),
      submoduleDrift: parseSubmoduleDrift(sm),
    }
  } catch (e) {
    return { path: top, error: (e as Error).message }
  }
}

export const isSnapshotError = (
  s: IRepoSnapshot | ISnapshotError
): s is ISnapshotError => 'error' in s

export function formatHuman(s: IRepoSnapshot | ISnapshotError): string {
  if (isSnapshotError(s)) {
    return `${s.path}\n  error: ${s.error}`
  }
  const ab = s.upstream
    ? ` ${s.upstream} +${s.ahead}/-${s.behind}`
    : ' (no upstream)'
  const lines = [
    `${s.path} [${s.project}]`,
    `  ${s.branch}${ab}${
      s.inProgress ? `  ${s.inProgress.toUpperCase()} IN PROGRESS` : ''
    }`,
    `  ${s.changed.length} changed, stash ${s.stash}, worktrees ${s.worktrees}`,
  ]
  if (s.changed.length) {
    const more = s.changed.length > 6 ? ` +${s.changed.length - 6}` : ''
    lines.push(`  changed: ${s.changed.slice(0, 6).join(', ')}${more}`)
  }
  for (const c of s.commits.slice(0, 3)) {
    lines.push(`  ${c.sha} ${c.subject} (${c.when})`)
  }
  if (s.submoduleDrift.length) {
    lines.push(
      `  submodule drift: ${s.submoduleDrift.map(d => d.path).join(', ')}`
    )
  }
  return lines.join('\n')
}

/** Entry point for the CLI: prints to stdout, returns the exit code. */
export async function runSnapshot(
  paths: ReadonlyArray<string>,
  json: boolean
): Promise<number> {
  const targets = paths.length ? paths : ['.']
  const results = await Promise.all(targets.map(snapshotRepo))
  const repos = results.filter((r): r is IRepoSnapshot => !isSnapshotError(r))
  if (json) {
    // Non-repos are reported as entries with an `error` field.
    process.stdout.write(JSON.stringify({ version: 1, repos: results }) + '\n')
  } else {
    process.stdout.write(results.map(formatHuman).join('\n') + '\n')
  }
  return repos.length === 0 ? 1 : 0
}
