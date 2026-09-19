import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  AppFileStatus,
  AppFileStatusKind,
  CommittedFileChange,
  WorkingDirectoryFileChange,
} from '../../src/models/status'
import { DiffSelection, DiffSelectionType } from '../../src/models/diff'
import {
  getPreviewSource,
  isMarkdownFile,
} from '../../src/ui/diff/markdown-preview'

const committed = (
  path: string,
  status: AppFileStatus = { kind: AppFileStatusKind.Modified }
) => new CommittedFileChange(path, status, 'feedface', 'deadbeef')

const working = (
  path: string,
  status: AppFileStatus = { kind: AppFileStatusKind.Modified }
) =>
  new WorkingDirectoryFileChange(
    path,
    status,
    DiffSelection.fromInitialSelection(DiffSelectionType.All)
  )

describe('isMarkdownFile', () => {
  it('recognizes the markdown extensions', () => {
    assert.ok(isMarkdownFile('README.md'))
    assert.ok(isMarkdownFile('docs/guide.markdown'))
    assert.ok(isMarkdownFile('notes.mdx'))
  })

  it('ignores the case of the extension', () => {
    assert.ok(isMarkdownFile('CHANGELOG.MD'))
  })

  it('leaves everything else to the diff', () => {
    assert.strictEqual(isMarkdownFile('app/index.ts'), false)
    assert.strictEqual(isMarkdownFile('mdfile'), false)
    assert.strictEqual(isMarkdownFile('not.md.ts'), false)
  })
})

describe('getPreviewSource', () => {
  it('reads a committed file out of its own commit', () => {
    assert.deepStrictEqual(getPreviewSource(committed('docs/readme.md')), {
      kind: 'blob',
      commitish: 'feedface',
      path: 'docs/readme.md',
    })
  })

  it('reads a file the commit deleted out of the parent commit', () => {
    const file = committed('docs/gone.md', {
      kind: AppFileStatusKind.Deleted,
    })

    assert.deepStrictEqual(getPreviewSource(file), {
      kind: 'blob',
      commitish: 'deadbeef',
      path: 'docs/gone.md',
    })
  })

  it('reads a working directory file off disk', () => {
    assert.deepStrictEqual(getPreviewSource(working('docs/readme.md')), {
      kind: 'working-tree',
      path: 'docs/readme.md',
    })
  })

  it('falls back to HEAD for a file deleted in the working directory', () => {
    const file = working('docs/gone.md', { kind: AppFileStatusKind.Deleted })

    assert.deepStrictEqual(getPreviewSource(file), {
      kind: 'blob',
      commitish: 'HEAD',
      path: 'docs/gone.md',
    })
  })

  it('follows a rename back to the path the old contents live under', () => {
    const file = committed('docs/new-name.md', {
      kind: AppFileStatusKind.Renamed,
      oldPath: 'docs/old-name.md',
      renameIncludesModifications: false,
    })

    // A rename still has contents at the new path in its own commit.
    assert.deepStrictEqual(getPreviewSource(file), {
      kind: 'blob',
      commitish: 'feedface',
      path: 'docs/new-name.md',
    })
  })
})
