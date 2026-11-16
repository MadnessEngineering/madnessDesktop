import { AppFileStatusKind } from '../models/status'
import {
  AutoIgnoreRepoOverride,
  AutoIgnoreRepoSetting,
  IAutoIgnoreConfig,
} from '../models/auto-ignore'

/**
 * Standard-practice ignore patterns are deliberately a small subset of
 * gitignore syntax: a single path segment, optionally ending in `/` to mean
 * "directory only", with `*` and `?` wildcards inside the segment. Without a
 * slash, git matches such a pattern at any depth, which is the point: one
 * rule covers every `.claude_temp/` the tooling leaves lying around.
 */
export function isValidStandardPattern(pattern: string): boolean {
  const body = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern
  return (
    body.length > 0 &&
    !body.includes('/') &&
    !body.includes('\\') &&
    !body.startsWith('!') &&
    !body.startsWith('#') &&
    body.trim() === body
  )
}

function segmentRegExp(segment: string): RegExp {
  const source = segment
    .split('')
    .map(c =>
      c === '*'
        ? '[^/]*'
        : c === '?'
        ? '[^/]'
        : c.replace(/[.+^${}()|[\]]/g, '\\$&')
    )
    .join('')
  return new RegExp(`^${source}$`)
}

/**
 * Does `pattern` ignore the repository-relative `path`?
 *
 * A directory pattern (`name/`) matches when any parent directory of the
 * path matches; a plain pattern also matches the file name itself.
 */
export function matchStandardPattern(path: string, pattern: string): boolean {
  if (!isValidStandardPattern(pattern)) {
    return false
  }

  const directoryOnly = pattern.endsWith('/')
  const re = segmentRegExp(directoryOnly ? pattern.slice(0, -1) : pattern)

  // Untracked directories can come through with a trailing slash.
  const segments = path.replace(/\/+$/, '').split('/')
  const candidates =
    directoryOnly && !path.endsWith('/') ? segments.slice(0, -1) : segments

  return candidates.some(s => re.test(s))
}

interface IAutoIgnoreCandidate {
  readonly path: string
  readonly status: { readonly kind: AppFileStatusKind }
}

/**
 * When every change is an untracked file covered by a standard pattern,
 * return the patterns that cover them (in config order). Otherwise null:
 * a repository with any real work in it is never touched.
 */
export function findLoneAutoIgnoreMatch(
  files: ReadonlyArray<IAutoIgnoreCandidate>,
  patterns: ReadonlyArray<string>
): ReadonlyArray<string> | null {
  if (files.length === 0 || patterns.length === 0) {
    return null
  }

  const used = new Set<string>()
  for (const file of files) {
    if (file.status.kind !== AppFileStatusKind.Untracked) {
      return null
    }
    const pattern = patterns.find(p => matchStandardPattern(file.path, p))
    if (pattern === undefined) {
      return null
    }
    used.add(pattern)
  }

  return patterns.filter(p => used.has(p))
}

/** Patterns from `patterns` that aren't already a line in `gitIgnoreText`. */
export function patternsMissingFrom(
  gitIgnoreText: string,
  patterns: ReadonlyArray<string>
): ReadonlyArray<string> {
  const lines = new Set(gitIgnoreText.split(/\r?\n/).map(l => l.trim()))
  return patterns.filter(p => !lines.has(p))
}

/**
 * Patterns offered by the "Always ignore (standard practice)" menu for a
 * path: nearest parent directories first (max 3), then the file name, then
 * its extension glob.
 */
export function suggestStandardPatterns(path: string): ReadonlyArray<string> {
  const segments = path.replace(/\/+$/, '').split('/')
  const fileName = segments[segments.length - 1]
  const dirs = segments.slice(0, -1).reverse().slice(0, 3)

  const suggestions = dirs.map(d => `${d}/`)
  if (path.endsWith('/')) {
    suggestions.unshift(`${fileName}/`)
  } else {
    suggestions.push(fileName)
    const dot = fileName.lastIndexOf('.')
    if (dot > 0) {
      suggestions.push(`*${fileName.slice(dot)}`)
    }
  }

  return [...new Set(suggestions)].filter(isValidStandardPattern)
}

/** Fill the `{patterns}` slot of a commit message template. */
export function formatAutoIgnoreCommitMessage(
  template: string,
  patterns: ReadonlyArray<string>
): string {
  const message = template.split('{patterns}').join(patterns.join(', ')).trim()
  return message.length > 0
    ? message
    : `chore(gitignore): auto-ignore ${patterns.join(', ')}`
}

/** The setting a repository's select shows: its override, or 'inherit'. */
export function autoIgnoreRepoSetting(
  config: IAutoIgnoreConfig,
  repositoryPath: string
): AutoIgnoreRepoSetting {
  return config.repoOverrides?.[repositoryPath] ?? 'inherit'
}

/** Does auto-ignore run in this repository? Its override, else `enabled`. */
export function isAutoIgnoreEnabledFor(
  config: IAutoIgnoreConfig,
  repositoryPath: string
): boolean {
  const setting = autoIgnoreRepoSetting(config, repositoryPath)
  return setting === 'inherit' ? config.enabled : setting === 'on'
}

/** The config with this repository's override set, or dropped for 'inherit'. */
export function withAutoIgnoreRepoSetting(
  config: IAutoIgnoreConfig,
  repositoryPath: string,
  setting: AutoIgnoreRepoSetting
): IAutoIgnoreConfig {
  const repoOverrides: { [path: string]: AutoIgnoreRepoOverride } = {
    ...config.repoOverrides,
  }
  delete repoOverrides[repositoryPath]
  if (setting !== 'inherit') {
    repoOverrides[repositoryPath] = setting
  }
  return { ...config, repoOverrides }
}
