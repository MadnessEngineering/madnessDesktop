/**
 * "Paint" for the exploded view: which parts of the assembly have work on
 * them, tallied per part so the drawing can put an amber face on each block
 * in proportion.
 *
 * Every tally rolls up — a change deep inside `app/src/ui` counts for `app`,
 * `app/src` and `app/src/ui` alike — so whatever level you're looking at,
 * the parts housing the work light up.
 */

export type PaintMode = 'off' | 'local' | 'history' | 'drift'

export const PaintModes: ReadonlyArray<PaintMode> = [
  'off',
  'local',
  'history',
  'drift',
]

export function isPaintMode(value: unknown): value is PaintMode {
  return PaintModes.includes(value as PaintMode)
}

/**
 * Add each entry's weight to its own path and every enclosing folder path.
 * The repository root ('') is not tallied — it's never drawn as a part.
 */
export function tallyByPart(
  entries: Iterable<readonly [string, number]>
): ReadonlyMap<string, number> {
  const tally = new Map<string, number>()
  for (const [path, weight] of entries) {
    const segments = path.split('/')
    for (let i = 1; i <= segments.length; i++) {
      const prefix = segments.slice(0, i).join('/')
      tally.set(prefix, (tally.get(prefix) ?? 0) + weight)
    }
  }
  return tally
}

/**
 * How strongly to paint a part: nothing for no work, then a floor so a
 * single change is still visible, rising with the square root of its share
 * of the busiest visible part.
 */
export function paintIntensity(count: number, max: number): number {
  if (count <= 0 || max <= 0) {
    return 0
  }
  return 0.35 + 0.65 * Math.sqrt(Math.min(count, max) / max)
}

/**
 * Count how many commits touched each path, from
 * `git log --name-only --format=` output (one path per line, blank lines
 * between commits).
 */
export function parseNameOnlyLog(stdout: string): ReadonlyMap<string, number> {
  const touches = new Map<string, number>()
  for (const line of stdout.split('\n')) {
    const path = line.trim()
    if (path.length > 0) {
      touches.set(path, (touches.get(path) ?? 0) + 1)
    }
  }
  return touches
}

/**
 * The slice of a working-directory file the paint modes read — shaped like
 * `WorkingDirectoryFileChange`, whose submodule details hang off `status`.
 */
export interface IPaintableFile {
  readonly path: string
  readonly status: {
    readonly submoduleStatus?: {
      readonly commitChanged: boolean
      readonly modifiedChanges: boolean
      readonly untrackedChanges: boolean
    }
  }
}

/** The slice of `git submodule status` the drift mode reads. */
export interface IPaintableSubmodule {
  readonly path: string
  readonly status: 'initialized' | 'uninitialized' | 'modified' | 'conflict'
}

/**
 * Why each submodule has drifted from what the parent repository pins, as
 * short human reasons. Submodules that match their pin are left out.
 */
export function driftReasons(
  submodules: ReadonlyArray<IPaintableSubmodule>,
  files: ReadonlyArray<IPaintableFile>
): ReadonlyMap<string, ReadonlyArray<string>> {
  const byPath = new Map(files.map(f => [f.path, f]))
  const reasons = new Map<string, ReadonlyArray<string>>()

  for (const sub of submodules) {
    const found = new Set<string>()
    const status = byPath.get(sub.path)?.status.submoduleStatus

    if (sub.status === 'modified' || status?.commitChanged) {
      found.add('moved off its pin')
    }
    if (sub.status === 'conflict') {
      found.add('conflicted')
    }
    if (status?.modifiedChanges) {
      found.add('uncommitted work')
    }
    if (status?.untrackedChanges) {
      found.add('untracked files')
    }
    if (found.size > 0) {
      reasons.set(sub.path, [...found])
    }
  }

  return reasons
}
