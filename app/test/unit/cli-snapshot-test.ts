import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  parseStatus,
  parseLog,
  parseSubmoduleDrift,
  countLines,
  countWorktrees,
  detectInProgress,
  projectFor,
} from '../../src/cli/snapshot'

describe('cli snapshot parsers', () => {
  it('parses porcelain v2 status', () => {
    const out = [
      '# branch.oid abc',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 aaa bbb app/my file.ts',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\told.ts',
      'u UU N... 1 2 3 4 aaa bbb bbb conflict.ts',
      '? untracked.txt',
      '',
    ].join('\n')
    const s = parseStatus(out)
    assert.equal(s.branch, 'main')
    assert.equal(s.upstream, 'origin/main')
    assert.equal(s.ahead, 2)
    assert.equal(s.behind, 1)
    assert.deepEqual(s.changed, [
      'app/my file.ts',
      'new.ts',
      'conflict.ts',
      'untracked.txt',
    ])
  })

  it('handles no upstream', () => {
    const s = parseStatus('# branch.head feat\n')
    assert.equal(s.upstream, null)
    assert.equal(s.ahead, 0)
  })

  it('parses log with files', () => {
    const c = parseLog(
      '@@abc123\t2 hours ago\tfeat: x\n\na.ts\nb.ts\n@@def456\t1 day ago\tfix\n'
    )
    assert.equal(c.length, 2)
    assert.deepEqual(c[0], {
      sha: 'abc123',
      when: '2 hours ago',
      subject: 'feat: x',
      files: ['a.ts', 'b.ts'],
    })
    assert.deepEqual(c[1].files, [])
  })

  it('counts stash, worktrees and drift', () => {
    assert.equal(countLines('stash@{0}: a\nstash@{1}: b\n'), 2)
    assert.equal(countLines(''), 0)
    assert.equal(
      countWorktrees('worktree /a\nHEAD x\n\nworktree /b\nHEAD y\n'),
      2
    )
    const d = parseSubmoduleDrift(
      ' 1111111111111111111111111111111111111111 ok (heads/main)\n+2222222222222222222222222222222222222222 sub/dir (v1-3-gabc)\n-3333 uninit\n'
    )
    assert.deepEqual(d, [{ sha: '2222222222', path: 'sub/dir' }])
  })

  it('detects in-progress operations', () => {
    assert.equal(
      detectInProgress(n => n === 'MERGE_HEAD'),
      'merge'
    )
    assert.equal(
      detectInProgress(n => n === 'rebase-merge'),
      'rebase'
    )
    assert.equal(
      detectInProgress(() => false),
      null
    )
  })

  it('derives omnispindle project names', () => {
    assert.equal(projectFor('/x/Madness-Desktop'), 'madness_desktop')
  })
})
