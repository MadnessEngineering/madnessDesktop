import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  mapStatus,
  isConflictedFile,
  hasConflictedFiles,
  getBulkResolutionTargets,
} from '../../src/lib/status'
import { ManualConflictResolution } from '../../src/models/manual-conflict-resolution'
import {
  AppFileStatusKind,
  WorkingDirectoryStatus,
  WorkingDirectoryFileChange,
  GitStatusEntry,
} from '../../src/models/status'
import { DiffSelection, DiffSelectionType } from '../../src/models/diff'

function makeFile(
  path: string,
  kind: AppFileStatusKind
): WorkingDirectoryFileChange {
  const status =
    kind === AppFileStatusKind.Conflicted
      ? {
          kind: kind as AppFileStatusKind.Conflicted,
          entry: {
            kind: 'conflicted' as const,
            action: 'both-modified' as any,
            us: GitStatusEntry.UpdatedButUnmerged,
            them: GitStatusEntry.UpdatedButUnmerged,
          },
          conflictMarkerCount: 1,
        }
      : { kind }

  return new WorkingDirectoryFileChange(
    path,
    status as any,
    DiffSelection.fromInitialSelection(DiffSelectionType.All)
  )
}

describe('lib/status', () => {
  describe('mapStatus', () => {
    it('returns "New" for new files', () => {
      assert.equal(mapStatus({ kind: AppFileStatusKind.New }), 'New')
    })

    it('returns "New" for untracked files', () => {
      assert.equal(mapStatus({ kind: AppFileStatusKind.Untracked }), 'New')
    })

    it('returns "Modified" for modified files', () => {
      assert.equal(mapStatus({ kind: AppFileStatusKind.Modified }), 'Modified')
    })

    it('returns "Deleted" for deleted files', () => {
      assert.equal(mapStatus({ kind: AppFileStatusKind.Deleted }), 'Deleted')
    })

    it('returns "Renamed" for renamed files', () => {
      assert.equal(
        mapStatus({
          kind: AppFileStatusKind.Renamed,
          oldPath: 'old.txt',
          renameIncludesModifications: false,
        }),
        'Renamed'
      )
    })

    it('returns "Copied" for copied files', () => {
      assert.equal(
        mapStatus({
          kind: AppFileStatusKind.Copied,
          oldPath: 'orig.txt',
          renameIncludesModifications: false,
        }),
        'Copied'
      )
    })
  })

  describe('isConflictedFile', () => {
    it('returns true for conflicted files', () => {
      const status = {
        kind: AppFileStatusKind.Conflicted,
        entry: {
          kind: 'conflicted' as const,
          action: 'both-modified' as any,
          us: GitStatusEntry.UpdatedButUnmerged,
          them: GitStatusEntry.UpdatedButUnmerged,
        },
        conflictMarkerCount: 1,
      }
      assert.equal(isConflictedFile(status as any), true)
    })

    it('returns false for non-conflicted files', () => {
      assert.equal(
        isConflictedFile({ kind: AppFileStatusKind.Modified }),
        false
      )
      assert.equal(isConflictedFile({ kind: AppFileStatusKind.New }), false)
      assert.equal(isConflictedFile({ kind: AppFileStatusKind.Deleted }), false)
    })
  })

  describe('hasConflictedFiles', () => {
    it('returns false for an empty working directory', () => {
      const wd = WorkingDirectoryStatus.fromFiles([])
      assert.equal(hasConflictedFiles(wd), false)
    })

    it('returns false when no files are conflicted', () => {
      const files = [
        makeFile('a.txt', AppFileStatusKind.Modified),
        makeFile('b.txt', AppFileStatusKind.New),
      ]
      const wd = WorkingDirectoryStatus.fromFiles(files)
      assert.equal(hasConflictedFiles(wd), false)
    })

    it('returns true when a file is conflicted', () => {
      const files = [
        makeFile('a.txt', AppFileStatusKind.Modified),
        makeFile('b.txt', AppFileStatusKind.Conflicted),
      ]
      const wd = WorkingDirectoryStatus.fromFiles(files)
      assert.equal(hasConflictedFiles(wd), true)
    })
  })

  describe('getBulkResolutionTargets', () => {
    function makeConflict(
      path: string,
      us: GitStatusEntry,
      them: GitStatusEntry,
      conflictMarkerCount?: number
    ): WorkingDirectoryFileChange {
      const entry = {
        kind: 'conflicted' as const,
        action: 'x' as any,
        us,
        them,
      }
      const status =
        conflictMarkerCount === undefined
          ? { kind: AppFileStatusKind.Conflicted, entry }
          : { kind: AppFileStatusKind.Conflicted, entry, conflictMarkerCount }
      return new WorkingDirectoryFileChange(
        path,
        status as any,
        DiffSelection.fromInitialSelection(DiffSelectionType.All)
      )
    }

    const A = GitStatusEntry.Added
    const U = GitStatusEntry.UpdatedButUnmerged
    const D = GitStatusEntry.Deleted

    it('targets only files that are still conflicted', () => {
      const wd = WorkingDirectoryStatus.fromFiles([
        makeConflict('markers.md', U, U, 3),
        makeConflict('fixed-by-hand.md', U, U, 0),
        makeConflict('added.md', A, A),
        makeConflict('already-picked.md', A, A),
        makeFile('clean.txt', AppFileStatusKind.Modified),
      ])
      const picked = new Map([
        ['already-picked.md', ManualConflictResolution.theirs],
      ])

      const { paths } = getBulkResolutionTargets(
        wd,
        picked,
        ManualConflictResolution.ours
      )
      assert.deepStrictEqual(paths, ['markers.md', 'added.md'])
    })

    it('counts the files that side would drop', () => {
      const wd = WorkingDirectoryStatus.fromFiles([
        makeConflict('gone-on-theirs.md', U, D),
        makeConflict('gone-on-ours.md', D, U),
        makeConflict('both.md', A, A),
      ])
      const none = new Map<string, ManualConflictResolution>()

      assert.equal(
        getBulkResolutionTargets(wd, none, ManualConflictResolution.ours)
          .deletionCount,
        1
      )
      const theirs = getBulkResolutionTargets(
        wd,
        none,
        ManualConflictResolution.theirs
      )
      assert.equal(theirs.deletionCount, 1)
      assert.equal(theirs.paths.length, 3)
    })
  })
})
