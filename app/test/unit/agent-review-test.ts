import { describe, it } from 'node:test'
import assert from 'node:assert'
import { execFileSync } from 'child_process'

import {
  buildSubmoduleReviewPrompt,
  claudeCommand,
  defaultReviewAsk,
  maxAskLength,
  sanitizeAsk,
} from '../../src/lib/agent-review'
import { isTypeable } from '../../src/ui/terminal-command'
import {
  parseShellomancyErrorCode,
  pickShellomancyWindow,
} from '../../src/lib/shellomancy'

const oldSHA = 'd63b13c0123456789abcdef0123456789abcdef0'
const newSHA = '14a5aec0123456789abcdef0123456789abcdef0'

function prompt(ask: string, commitCount = 2) {
  return buildSubmoduleReviewPrompt({
    submodulePath: 'projects/common/Omnispindle',
    parentName: 'Madness_Interactive',
    oldSHA,
    newSHA,
    commitCount,
    ask,
  })
}

describe('agent-review', () => {
  describe('buildSubmoduleReviewPrompt', () => {
    it('names the submodule, the parent and the full range', () => {
      const p = prompt('what broke?')
      assert.ok(p.includes('projects/common/Omnispindle'))
      assert.ok(p.includes('Madness_Interactive'))
      assert.ok(p.includes(`git log --stat ${oldSHA}..${newSHA}`))
      assert.ok(p.includes('d63b13c..14a5aec (2 commits)'))
      assert.ok(p.endsWith('Ask: what broke?'))
    })

    it('says "commit" for a single commit', () => {
      assert.ok(prompt('x', 1).includes('(1 commit)'))
    })

    it('falls back to the default ask when the ask is blank', () => {
      assert.ok(prompt('   \n\t ').endsWith(`Ask: ${defaultReviewAsk}`))
    })

    it('flattens control characters out of the ask', () => {
      const p = prompt('line one\nline two\r\u001b[31m\u0007')
      assert.ok(isTypeable(p))
      assert.ok(p.endsWith('Ask: line one line two [31m'))
    })
  })

  describe('sanitizeAsk', () => {
    it('caps the ask', () => {
      assert.equal(
        sanitizeAsk('a'.repeat(maxAskLength * 2)).length,
        maxAskLength
      )
      // never splits a surrogate pair
      const emoji = sanitizeAsk('😈'.repeat(maxAskLength * 2))
      assert.equal(Array.from(emoji).length, maxAskLength)
      assert.ok(!/[\ud800-\udbff]$/.test(emoji))
    })
  })

  describe('claudeCommand', () => {
    it('stays under the 4096-byte Shellomancy limit with a max-length ask', () => {
      for (const unit of ["'", '😈', '✦']) {
        const command = claudeCommand(prompt(unit.repeat(maxAskLength * 2)))
        assert.notEqual(command, null)
        assert.ok(Buffer.byteLength(command!, 'utf8') < 4096, unit)
      }
    })

    it('round-trips the prompt through a POSIX shell as one word', () => {
      const nasty = `it's $(touch pwned) \`id\` ; rm -rf / # "q" \\ ✦`
      const p = prompt(nasty)
      const command = claudeCommand(p)!
      assert.ok(command.startsWith('claude '))
      const echoed = execFileSync(
        '/bin/sh',
        ['-c', `printf %s ${command.slice('claude '.length)}`],
        { encoding: 'utf8' }
      )
      assert.equal(echoed, p)
    })
  })

  describe('parseShellomancyErrorCode', () => {
    it('reads the code from the CLI error line', () => {
      assert.equal(
        parseShellomancyErrorCode(
          'error: no_instance: no local Warp control instances were discovered\n'
        ),
        'no_instance'
      )
    })

    it('says unknown when there is no code', () => {
      assert.equal(parseShellomancyErrorCode('boom'), 'unknown')
    })
  })
  describe('pickShellomancyWindow', () => {
    const quake = { window_id: '0', is_active: false, is_quake: true }
    const plain = { window_id: '1', is_active: false, is_quake: false }
    it('prefers the active window', () => {
      assert.equal(
        pickShellomancyWindow([plain, { ...quake, is_active: true }]),
        '0'
      )
    })
    it('skips the quake window when none is active', () => {
      assert.equal(pickShellomancyWindow([quake, plain]), '1')
    })
    it('takes the quake window when it is the only one', () => {
      assert.equal(pickShellomancyWindow([quake]), '0')
    })
    it('has nothing to pick from no windows', () => {
      assert.equal(pickShellomancyWindow([]), null)
    })
  })
})
