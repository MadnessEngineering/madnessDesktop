import { git } from './core'
import { Repository } from '../../models/repository'
import {
  IRepositoryPart,
  buildPartsTree,
  parseLsTree,
} from '../repository-parts'

/**
 * Read the committed tree at HEAD as an exploded-view parts model.
 *
 * HEAD rather than the working directory: the exploded view only stands in
 * for the "No local changes" page, where the two agree, and `ls-tree` is one
 * cheap process instead of a filesystem walk that would also wander into
 * ignored build output.
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
