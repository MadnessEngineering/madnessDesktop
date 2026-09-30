import { git } from './core'
import { Repository } from '../../models/repository'
import {
  IRepositoryPart,
  buildPartsTree,
  parseLsTree,
} from '../repository-parts'
import { parseNameOnlyLog } from '../exploded-paint'

/**
 * Read the committed tree at HEAD as an exploded-view parts model.
 *
 * HEAD rather than the working directory: `ls-tree` is one cheap process
 * instead of a filesystem walk that would also wander into ignored build
 * output. With local changes the committed shape still frames them — only a
 * brand-new folder has no part to paint until it's committed.
 *
 * Returns null when there's no HEAD to read (an unborn branch).
 */
export async function getRepositoryParts(
  repository: Repository
): Promise<IRepositoryPart | null> {
  const { stdout, exitCode } = await git(
    ['ls-tree', '-r', '-l', '-z', 'HEAD'],
    repository.path,
    'getRepositoryParts',
    { successExitCodes: new Set([0, 128]) }
  )

  if (exitCode === 128) {
    return null
  }

  return buildPartsTree(parseLsTree(stdout))
}

/** How far back the exploded view's history paint looks. */
export const RecentTouchCommitLimit = 100

/**
 * How many of the last `RecentTouchCommitLimit` non-merge commits touched
 * each path — the exploded view's "sawdust" paint. Empty on an unborn
 * branch.
 */
export async function getRecentTouches(
  repository: Repository
): Promise<ReadonlyMap<string, number>> {
  const { stdout, exitCode } = await git(
    [
      '-c',
      'core.quotepath=false',
      'log',
      '-n',
      String(RecentTouchCommitLimit),
      '--no-merges',
      '--name-only',
      '--format=',
    ],
    repository.path,
    'getRecentTouches',
    { successExitCodes: new Set([0, 128]) }
  )

  return exitCode === 128 ? new Map() : parseNameOnlyLog(stdout)
}
