import { describe, it } from 'node:test'
import assert from 'node:assert'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  isTypeable,
  shellQuote,
  vimCommand,
} from '../../src/ui/terminal-command'

/** File names that break naive quoting. */
const nasty = [
  'plain.md',
  'with space.txt',
  "it's.md",
  "''",
  'a\'b"c',
  '$(touch pwned)',
  '`touch pwned`',
  '; touch pwned #',
  '$HOME',
  '\\back\\slash',
  '-n',
  '*.json',
  'ünïcødé ✦.md',
]

/** What the shell hands to a command after parsing the quoted word. */
function roundTrip(shell: string, text: string) {
  return execFileSync(shell, ['-c', `printf '%s' ${shellQuote(text)}`], {
    encoding: 'utf8',
  })
}

describe('ui/terminal-command', () => {
  describe('shellQuote', () => {
    for (const shell of ['/bin/sh', '/bin/bash', '/bin/zsh']) {
      if (!existsSync(shell)) {
        continue
      }

      it(`round-trips every awkward name through ${shell}`, () => {
        for (const text of nasty) {
          assert.equal(roundTrip(shell, text), text)
        }
      })
    }
  })

  describe('isTypeable', () => {
    it('accepts ordinary and awkward printable names', () => {
      for (const text of nasty) {
        assert(isTypeable(text), text)
      }
    })

    it('rejects names containing control characters', () => {
      for (const text of [
        'a\nb',
        'a\rtouch pwned\r',
        'a\u0015b',
        'a\u001b[201~b',
        'tab\there',
        'del\u007f',
        'c1\u009bcsi',
      ]) {
        assert(!isTypeable(text), JSON.stringify(text))
      }
    })
  })

  describe('vimCommand', () => {
    it('quotes the path', () => {
      assert.equal(
        vimCommand("/repo/it's.md"),
        `command vim '/repo/it'\\''s.md'`
      )
    })

    it('runs vim itself even when an alias or function shadows it', () => {
      const command = vimCommand('/repo/notes.md')
      assert(command !== null)

      // A stand-in vim on PATH that prints what it was given.
      const bin = mkdtempSync(join(tmpdir(), 'vim-'))
      writeFileSync(join(bin, 'vim'), '#!/bin/sh\nprintf "vim:%s" "$1"\n', {
        mode: 0o755,
      })
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` }

      const shadows = {
        alias: "alias vim='printf SHADOWED'",
        function: 'vim() { printf SHADOWED; }',
      }

      for (const shell of ['/bin/bash', '/bin/zsh'].filter(existsSync)) {
        for (const [kind, shadow] of Object.entries(shadows)) {
          // An interactive shell parses each line after the one before has
          // run; `eval` does the same here, so the alias is live by then
          // (zsh parses a whole -c script up front, before it runs).
          const run = (line: string) =>
            execFileSync(
              shell,
              [
                '-c',
                [
                  'shopt -s expand_aliases 2>/dev/null || :',
                  shadow,
                  `eval ${shellQuote(line)}`,
                ].join('\n'),
              ],
              { encoding: 'utf8', env }
            )

          // The shadow is in effect for a plain `vim`...
          assert.equal(
            run("vim '/repo/notes.md'"),
            'SHADOWED',
            `${shell} ${kind}`
          )
          // ...and the command we type gets past it.
          assert.equal(run(command), 'vim:/repo/notes.md', `${shell} ${kind}`)
        }
      }
    })

    it('refuses a path it could not type safely', () => {
      assert.equal(vimCommand('/repo/evil\rtouch pwned\r'), null)
    })
  })
})
