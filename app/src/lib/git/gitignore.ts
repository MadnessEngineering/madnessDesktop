import * as Path from 'path'
import * as FS from 'fs'
import { Repository } from '../../models/repository'
import { getConfigValue } from './config'
import { lstat, open, type FileHandle } from 'fs/promises'
import { isErrnoException } from '../errno-exception'
import { removeFromIndex } from './rm'
import { git } from './core'

const symbolicLinkErrorMessage =
  'Cannot use a symbolic link as the root .gitignore file'

function createSymbolicLinkError(): Error {
  return new Error(symbolicLinkErrorMessage)
}

async function ensureGitIgnoreIsNotSymbolicLink(
  ignorePath: string
): Promise<void> {
  try {
    const stats = await lstat(ignorePath)
    if (stats.isSymbolicLink()) {
      throw createSymbolicLinkError()
    }
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') {
      throw error
    }
  }
}

async function openExistingGitIgnore(
  ignorePath: string,
  flags: number
): Promise<FileHandle | null> {
  let file: FileHandle

  try {
    file = await open(ignorePath, flags | FS.constants.O_NOFOLLOW)
  } catch (error) {
    if (isErrnoException(error)) {
      if (error.code === 'ENOENT') {
        await ensureGitIgnoreIsNotSymbolicLink(ignorePath)
        return null
      }

      if (error.code === 'ELOOP') {
        throw createSymbolicLinkError()
      }
    }

    throw error
  }

  try {
    const [fileStats, pathStats] = await Promise.all([
      file.stat(),
      lstat(ignorePath),
    ])

    if (
      pathStats.isSymbolicLink() ||
      fileStats.dev !== pathStats.dev ||
      fileStats.ino !== pathStats.ino
    ) {
      throw createSymbolicLinkError()
    }

    return file
  } catch (error) {
    await file.close()
    throw error
  }
}

/**
 * Read the contents of the repository .gitignore.
 *
 * Returns a promise which will either be rejected or resolved
 * with the contents of the file. If there's no .gitignore file
 * in the repository root the promise will resolve with null.
 */
export async function readGitIgnoreAtRoot(
  repository: Repository
): Promise<string | null> {
  return readGitIgnore(Path.join(repository.path, '.gitignore'))
}

async function readGitIgnore(ignorePath: string): Promise<string | null> {
  const file = await openExistingGitIgnore(ignorePath, FS.constants.O_RDONLY)

  if (file === null) {
    return null
  }

  try {
    return await file.readFile('utf8')
  } finally {
    await file.close()
  }
}

/**
 * Persist the given content to the repository root .gitignore.
 *
 * If the repository root doesn't contain a .gitignore file one
 * will be created, otherwise the current file will be overwritten.
 */
export async function saveGitIgnore(
  repository: Repository,
  text: string
): Promise<void> {
  const ignorePath = Path.join(repository.path, '.gitignore')

  if (text === '') {
    await ensureGitIgnoreIsNotSymbolicLink(ignorePath)

    return new Promise<void>((resolve, reject) => {
      FS.unlink(ignorePath, err => (err === null ? resolve() : reject(err)))
    })
  }

  const fileContents = await formatGitIgnoreContents(text, repository)
  await writeGitIgnore(ignorePath, fileContents)
}

async function writeGitIgnore(
  ignorePath: string,
  fileContents: string
): Promise<void> {
  const file =
    (await openExistingGitIgnore(ignorePath, FS.constants.O_WRONLY)) ??
    (await open(
      ignorePath,
      FS.constants.O_CREAT |
        FS.constants.O_EXCL |
        FS.constants.O_WRONLY |
        FS.constants.O_NOFOLLOW
    ))

  try {
    await file.truncate(0)
    await file.writeFile(fileContents)
  } finally {
    await file.close()
  }
}

/** Add the given pattern or patterns to the root gitignore file */
export async function appendIgnoreRule(
  repository: Repository,
  patterns: string | string[]
): Promise<void> {
  await appendRulesToGitIgnore(repository, '.gitignore', patterns)
}

/**
 * Append patterns to the .gitignore at `relativeIgnorePath` (relative to the
 * repository root), creating it if needed.
 */
async function appendRulesToGitIgnore(
  repository: Repository,
  relativeIgnorePath: string,
  patterns: string | ReadonlyArray<string>
): Promise<void> {
  const ignorePath = Path.join(repository.path, relativeIgnorePath)
  const text = (await readGitIgnore(ignorePath)) || ''

  const currentContents = await formatGitIgnoreContents(text, repository)

  const newPatternText =
    typeof patterns === 'string' ? patterns : patterns.join('\n')
  const newText = await formatGitIgnoreContents(
    `${currentContents}${newPatternText}`,
    repository
  )

  await writeGitIgnore(ignorePath, newText)
}

/**
 * Convenience method to add the given file path(s) to the repository's gitignore.
 *
 * The file path will be escaped before adding.
 */
export async function appendIgnoreFile(
  repository: Repository,
  filePath: string | string[]
): Promise<void> {
  const filePaths = filePath instanceof Array ? filePath : [filePath]
  await appendIgnoreRule(
    repository,
    filePaths.map(path => escapeGitSpecialCharacters(path))
  )

  await ensureIgnored(
    repository,
    filePaths.map(path => path.replace(/^\//, '').replace(/\/$/, ''))
  )
}

/** The rule `git check-ignore -v` reports as deciding a path's fate. */
interface IDecidingIgnoreRule {
  /** The file the rule is in, relative to the repository root when inside it */
  readonly source: string
  readonly line: string
  readonly pattern: string
}

/**
 * For each path, the rule that decides whether it's ignored, or null when no
 * rule matches. Checks against the rules alone (--no-index), so tracked files
 * are judged the same as untracked ones.
 */
async function getDecidingIgnoreRules(
  repository: Repository,
  paths: ReadonlyArray<string>
): Promise<Map<string, IDecidingIgnoreRule | null>> {
  const result = await git(
    // check-ignore takes plain paths, not pathspecs, so foo[1].txt is literal
    [
      'check-ignore',
      '--verbose',
      '--non-matching',
      '--no-index',
      '--stdin',
      '-z',
    ],
    repository.path,
    'getDecidingIgnoreRules',
    {
      stdin: paths.join('\0'),
      // 1 means none of the paths are ignored: an answer, not a failure
      successExitCodes: new Set([0, 1]),
    }
  )

  const fields = result.stdout.split('\0')
  const rules = new Map<string, IDecidingIgnoreRule | null>()
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const [source, line, pattern, path] = fields.slice(i, i + 4)
    rules.set(path, source === '' ? null : { source, line, pattern })
  }
  return rules
}

/**
 * A rule written to the root .gitignore loses to a re-including rule (`!foo`)
 * in a deeper .gitignore, because git gives the deepest .gitignore the final
 * say. So check what git actually decides, and where a deeper .gitignore
 * re-includes a path, ignore it again at the end of that file, where it
 * outranks the re-include. Throws, naming the winning rule, if a path still
 * isn't ignored.
 */
async function ensureIgnored(
  repository: Repository,
  paths: ReadonlyArray<string>
): Promise<void> {
  // Each pass moves a path one .gitignore deeper, so this only runs out on
  // absurdly nested re-includes.
  const maxPasses = 8
  let pending = paths

  for (let pass = 0; pending.length > 0; pass++) {
    const rules = await getDecidingIgnoreRules(repository, pending)
    const stillIncluded = pending.filter(path => {
      const rule = rules.get(path)
      return rule == null || rule.pattern.startsWith('!')
    })

    if (stillIncluded.length === 0) {
      return
    }

    const rulesByIgnoreFile = new Map<string, Array<string>>()
    for (const path of stillIncluded) {
      const rule = rules.get(path) ?? null
      if (
        pass >= maxPasses ||
        rule === null ||
        !isDeeperGitIgnoreFor(rule.source, path)
      ) {
        throw new Error(
          rule === null
            ? `Couldn't ignore ${path}: git doesn't treat it as ignored.`
            : `Couldn't ignore ${path}: "${rule.pattern}" at ${rule.source}:${rule.line} includes it again.`
        )
      }

      const dir = Path.posix.dirname(rule.source)
      const rulesForFile = rulesByIgnoreFile.get(rule.source) ?? []
      rulesForFile.push(
        `/${escapeGitSpecialCharacters(Path.posix.relative(dir, path))}`
      )
      rulesByIgnoreFile.set(rule.source, rulesForFile)
    }

    for (const [ignoreFile, newRules] of rulesByIgnoreFile) {
      await appendRulesToGitIgnore(repository, ignoreFile, newRules)
    }

    pending = stillIncluded
  }
}

/**
 * Whether `source` (as check-ignore reports it) is a .gitignore in a folder
 * that contains `path`, below the repository root. Only those can be
 * outranked by appending to them; a re-include anywhere else (the root
 * .gitignore, .git/info/exclude, a global excludes file) is left to the user.
 */
function isDeeperGitIgnoreFor(source: string, path: string): boolean {
  if (Path.posix.basename(source) !== '.gitignore') {
    return false
  }
  const dir = Path.posix.dirname(source)
  return (
    dir !== '.' &&
    !Path.isAbsolute(source) &&
    !dir.split('/').includes('..') &&
    path.startsWith(`${dir}/`)
  )
}

/**
 * Add the given file or folder path(s) to the repository's gitignore and stop
 * tracking them, leaving them on disk. Once committed, the path is ignored
 * even though it used to be tracked.
 *
 * Folder paths may be anchored to the root with a leading '/', as the ignore
 * menus do.
 */
export async function ignoreAndUntrack(
  repository: Repository,
  filePath: string | string[]
): Promise<void> {
  // Ignore first: if the path is untracked before it's ignored, status shows
  // it as untracked instead of deleted.
  await appendIgnoreFile(repository, filePath)

  const paths = filePath instanceof Array ? filePath : [filePath]
  await removeFromIndex(
    repository,
    paths.map(path => path.replace(/^\//, ''))
  )
}

/** Escapes a string from special characters used in a gitignore file */
export function escapeGitSpecialCharacters(pattern: string): string {
  const specialCharacters = /[\[\]!\*\#\?]/g

  return pattern.replaceAll(specialCharacters, match => {
    return '\\' + match
  })
}

/**
 * Format the gitignore text based on the current config settings.
 *
 * This setting looks at core.autocrlf to decide which line endings to use
 * when updating the .gitignore file.
 *
 * If core.safecrlf is also set, adding this file to the index may cause
 * Git to return a non-zero exit code, leaving the working directory in a
 * confusing state for the user. So we should reformat the file in that
 * case.
 *
 * @param text The text to format.
 * @param repository The repository associated with the gitignore file.
 */
async function formatGitIgnoreContents(
  text: string,
  repository: Repository
): Promise<string> {
  const autocrlf = await getConfigValue(repository, 'core.autocrlf')
  const safecrlf = await getConfigValue(repository, 'core.safecrlf')

  return new Promise<string>((resolve, reject) => {
    if (autocrlf === 'true' && safecrlf === 'true') {
      // based off https://stackoverflow.com/a/141069/1363815
      const normalizedText = text.replace(/\r\n|\n\r|\n|\r/g, '\r\n')
      resolve(normalizedText + '\r\n')
      return
    }

    if (text === '' || text.endsWith('\n')) {
      resolve(text)
      return
    }

    if (autocrlf == null) {
      // fallback to Git default behaviour
      resolve(`${text}\n`)
    } else {
      const linesEndInCRLF = autocrlf === 'true'
      if (linesEndInCRLF) {
        resolve(`${text}\n`)
      } else {
        resolve(`${text}\r\n`)
      }
    }
  })
}
