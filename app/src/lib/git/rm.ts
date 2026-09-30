import { git } from './core'
import { Repository } from '../../models/repository'
import { WorkingDirectoryFileChange } from '../../models/status'

/**
 * Remove all files from the index
 *
 * @param repository the repository to update
 */
export async function unstageAllFiles(repository: Repository): Promise<void> {
  await git(
    // these flags are important:
    // --cached to only remove files from the index
    // -r       to recursively remove files, in case files are in folders
    // -f       to ignore differences between working directory and index
    //          which will block this
    ['rm', '--cached', '-r', '-f', '.'],
    repository.path,
    'unstageAllFiles'
  )
}

/**
 * Stop tracking the given paths: remove them from the index but leave them on
 * disk. Folders are removed recursively.
 *
 * @param repository the repository to update
 * @param paths      repository-relative paths to untrack
 */
export async function removeFromIndex(
  repository: Repository,
  paths: ReadonlyArray<string>
): Promise<void> {
  if (paths.length === 0) {
    return
  }

  await git(
    // these flags are important:
    // --literal-pathspecs so a path like foo[1].txt doesn't also match foo1.txt
    // --cached            to only remove files from the index
    // -r                  to recursively remove files, in case paths are folders
    // --ignore-unmatch    so untracked paths in the list aren't an error
    [
      '--literal-pathspecs',
      'rm',
      '--cached',
      '-r',
      '-q',
      '--ignore-unmatch',
      '--',
      ...paths,
    ],
    repository.path,
    'removeFromIndex'
  )
}

/**
 * Remove conflicted file from  working tree and index
 */
export async function removeConflictedFile(
  repository: Repository,
  file: WorkingDirectoryFileChange
) {
  await git(['rm', '--', file.path], repository.path, 'removeConflictedFile')
}
