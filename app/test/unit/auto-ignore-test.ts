import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  autoIgnoreRepoSetting,
  findLoneAutoIgnoreMatch,
  formatAutoIgnoreCommitMessage,
  isValidStandardPattern,
  matchStandardPattern,
  patternsMissingFrom,
  isAutoIgnoreEnabledFor,
  suggestStandardPatterns,
  withAutoIgnoreRepoSetting,
} from '../../src/lib/auto-ignore'
import { DefaultAutoIgnoreConfig } from '../../src/models/auto-ignore'
import { AppFileStatusKind } from '../../src/models/status'

const untracked = (path: string) => ({
  path,
  status: { kind: AppFileStatusKind.Untracked },
})
const modified = (path: string) => ({
  path,
  status: { kind: AppFileStatusKind.Modified },
})
const submodule = (path: string, commitChanged: boolean) => ({
  path,
  status: {
    kind: AppFileStatusKind.Modified,
    submoduleStatus: {
      commitChanged,
      modifiedChanges: !commitChanged,
      untrackedChanges: !commitChanged,
    },
  },
})

describe('auto-ignore', () => {
  describe('isValidStandardPattern', () => {
    it('accepts single-segment patterns', () => {
      assert(isValidStandardPattern('.claude_temp/'))
      assert(isValidStandardPattern('.claude_temp'))
      assert(isValidStandardPattern('*.log'))
    })

    it('rejects anchored, nested, negated, comment and empty patterns', () => {
      for (const p of ['/x', 'a/b', 'a/b/', '!x', '#x', '', '/', ' x']) {
        assert(!isValidStandardPattern(p), p)
      }
    })
  })

  describe('matchStandardPattern', () => {
    it('matches a directory pattern at any depth', () => {
      const p = '.claude_temp/'
      assert(matchStandardPattern('.claude_temp/last_tool_use_id.txt', p))
      assert(
        matchStandardPattern(
          'app/src/ui/lib/.claude_temp/last_tool_use_id.txt',
          p
        )
      )
    })

    it('does not match a directory pattern against a same-named file', () => {
      assert(!matchStandardPattern('app/.claude_temp', '.claude_temp/'))
      assert(matchStandardPattern('app/.claude_temp', '.claude_temp'))
    })

    it('treats a trailing slash path as a directory', () => {
      assert(matchStandardPattern('app/.claude_temp/', '.claude_temp/'))
    })

    it('handles wildcards within a segment only', () => {
      assert(matchStandardPattern('logs/debug.log', '*.log'))
      assert(!matchStandardPattern('logs/debug.log.txt', '*.log'))
      assert(matchStandardPattern('a/tmp1/x', 'tmp?/'))
      assert(!matchStandardPattern('a/tmpxx/x', 'tmp?/'))
    })

    it('treats regex characters literally', () => {
      assert(!matchStandardPattern('a/xclaudeXtemp/f', '.claude.temp/'))
      assert(matchStandardPattern('a/(x)+/f', '(x)+/'))
    })
  })

  describe('findLoneAutoIgnoreMatch', () => {
    const patterns = ['.claude_temp/', '*.log']

    it('returns the covering patterns when every change is ignorable', () => {
      assert.deepStrictEqual(
        findLoneAutoIgnoreMatch(
          [untracked('app/src/ui/lib/.claude_temp/last_tool_use_id.txt')],
          patterns
        ),
        ['.claude_temp/']
      )
      assert.deepStrictEqual(
        findLoneAutoIgnoreMatch(
          [untracked('x.log'), untracked('a/.claude_temp/b')],
          patterns
        ),
        ['.claude_temp/', '*.log']
      )
    })

    it('returns null when anything else is in the working directory', () => {
      assert.strictEqual(
        findLoneAutoIgnoreMatch(
          [untracked('a/.claude_temp/b'), untracked('src/new.ts')],
          patterns
        ),
        null
      )
      assert.strictEqual(
        findLoneAutoIgnoreMatch(
          [untracked('a/.claude_temp/b'), modified('README.md')],
          patterns
        ),
        null
      )
    })

    it('looks past submodule bumps and dirty submodules', () => {
      assert.deepStrictEqual(
        findLoneAutoIgnoreMatch(
          [
            submodule('Anathesmelt', false),
            submodule('projects/tasker', true),
            untracked('projects/mobile/.claude_temp/last_tool_use_id.txt'),
          ],
          patterns
        ),
        ['.claude_temp/']
      )
    })

    it('returns null when submodules are the only changes', () => {
      assert.strictEqual(
        findLoneAutoIgnoreMatch(
          [submodule('Anathesmelt', false), submodule('projects/tasker', true)],
          patterns
        ),
        null
      )
    })

    it('ignores tracked files even when they match', () => {
      assert.strictEqual(
        findLoneAutoIgnoreMatch([modified('a/.claude_temp/b')], patterns),
        null
      )
    })

    it('returns null for no changes or no patterns', () => {
      assert.strictEqual(findLoneAutoIgnoreMatch([], patterns), null)
      assert.strictEqual(
        findLoneAutoIgnoreMatch([untracked('a/.claude_temp/b')], []),
        null
      )
    })
  })

  describe('patternsMissingFrom', () => {
    it('skips patterns already present as a line', () => {
      assert.deepStrictEqual(
        patternsMissingFrom('node_modules/\r\n.claude_temp/\n', [
          '.claude_temp/',
          '*.log',
        ]),
        ['*.log']
      )
    })

    it('does not count a path-specific rule as the generic one', () => {
      assert.deepStrictEqual(
        patternsMissingFrom('/app/src/.claude_temp\n', ['.claude_temp/']),
        ['.claude_temp/']
      )
    })
  })

  describe('suggestStandardPatterns', () => {
    it('offers nearest parents, then the file name and extension', () => {
      assert.deepStrictEqual(
        suggestStandardPatterns(
          'app/src/ui/lib/.claude_temp/last_tool_use_id.txt'
        ),
        ['.claude_temp/', 'lib/', 'ui/', 'last_tool_use_id.txt', '*.txt']
      )
    })

    it('skips the extension glob for dotfiles', () => {
      assert.deepStrictEqual(suggestStandardPatterns('.envrc'), ['.envrc'])
    })
  })

  describe('formatAutoIgnoreCommitMessage', () => {
    it('fills every {patterns} slot', () => {
      assert.strictEqual(
        formatAutoIgnoreCommitMessage('ignore {patterns} ({patterns})', [
          'a/',
          '*.log',
        ]),
        'ignore a/, *.log (a/, *.log)'
      )
    })

    it('falls back to the default when the template is blank', () => {
      assert.strictEqual(
        formatAutoIgnoreCommitMessage('  ', ['.claude_temp/']),
        'chore(gitignore): auto-ignore .claude_temp/'
      )
    })
  })

  describe('per-repository override', () => {
    const work = '/Users/dan/work/alloy'
    const lab = '/Users/dan/lab/inventorium'

    it('follows the global switch when a repository has no say', () => {
      const off = { ...DefaultAutoIgnoreConfig, enabled: false }
      const on = { ...DefaultAutoIgnoreConfig, enabled: true }
      assert.equal(autoIgnoreRepoSetting(on, lab), 'inherit')
      assert.equal(isAutoIgnoreEnabledFor(off, lab), false)
      assert.equal(isAutoIgnoreEnabledFor(on, lab), true)
    })

    it("a repository's override beats the global switch both ways", () => {
      const on = withAutoIgnoreRepoSetting(
        { ...DefaultAutoIgnoreConfig, enabled: true },
        work,
        'off'
      )
      assert.equal(isAutoIgnoreEnabledFor(on, work), false)
      assert.equal(isAutoIgnoreEnabledFor(on, lab), true)

      const off = withAutoIgnoreRepoSetting(
        { ...DefaultAutoIgnoreConfig, enabled: false },
        lab,
        'on'
      )
      assert.equal(isAutoIgnoreEnabledFor(off, lab), true)
      assert.equal(isAutoIgnoreEnabledFor(off, work), false)
    })

    it("'inherit' drops the override and leaves the others", () => {
      let config = withAutoIgnoreRepoSetting(
        DefaultAutoIgnoreConfig,
        work,
        'off'
      )
      config = withAutoIgnoreRepoSetting(config, lab, 'on')
      config = withAutoIgnoreRepoSetting(config, work, 'inherit')
      assert.deepEqual(config.repoOverrides, { [lab]: 'on' })
      assert.equal(autoIgnoreRepoSetting(config, work), 'inherit')
    })

    it('does not change the config it was given', () => {
      const before = withAutoIgnoreRepoSetting(
        DefaultAutoIgnoreConfig,
        work,
        'off'
      )
      withAutoIgnoreRepoSetting(before, work, 'on')
      assert.deepEqual(before.repoOverrides, { [work]: 'off' })
    })
  })
})
