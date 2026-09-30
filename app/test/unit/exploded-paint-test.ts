import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  driftReasons,
  isPaintMode,
  paintIntensity,
  parseNameOnlyLog,
  tallyByPart,
} from '../../src/lib/exploded-paint'

describe('exploded paint', () => {
  describe('tallyByPart', () => {
    it('rolls each entry up into every enclosing folder', () => {
      const tally = tallyByPart([
        ['app/src/ui/a.tsx', 1],
        ['app/src/lib/b.ts', 2],
        ['README.md', 1],
      ])
      assert.strictEqual(tally.get('app'), 3)
      assert.strictEqual(tally.get('app/src'), 3)
      assert.strictEqual(tally.get('app/src/ui'), 1)
      assert.strictEqual(tally.get('app/src/ui/a.tsx'), 1)
      assert.strictEqual(tally.get('README.md'), 1)
      assert.strictEqual(tally.get(''), undefined)
    })
  })

  describe('paintIntensity', () => {
    it('is zero without work and floored above zero with any', () => {
      assert.strictEqual(paintIntensity(0, 10), 0)
      assert.strictEqual(paintIntensity(3, 0), 0)
      assert.ok(paintIntensity(1, 1000) >= 0.35)
      assert.strictEqual(paintIntensity(10, 10), 1)
    })

    it('rises with the share of the busiest part, never past full', () => {
      assert.ok(paintIntensity(5, 10) > paintIntensity(1, 10))
      assert.strictEqual(paintIntensity(20, 10), 1)
    })
  })

  describe('parseNameOnlyLog', () => {
    it('counts the commits that touched each path', () => {
      const touches = parseNameOnlyLog(
        ['app/a.ts', 'docs/b.md', '', 'app/a.ts', '', 'vendor/engine', ''].join(
          '\n'
        )
      )
      assert.strictEqual(touches.get('app/a.ts'), 2)
      assert.strictEqual(touches.get('docs/b.md'), 1)
      assert.strictEqual(touches.get('vendor/engine'), 1)
      assert.strictEqual(touches.size, 3)
    })
  })

  describe('driftReasons', () => {
    it('leaves submodules that match their pin out', () => {
      const reasons = driftReasons(
        [{ path: 'vendor/ok', status: 'initialized' }],
        []
      )
      assert.strictEqual(reasons.size, 0)
    })

    it('names each way a submodule has drifted, once', () => {
      const reasons = driftReasons(
        [
          { path: 'vendor/moved', status: 'modified' },
          { path: 'vendor/dirty', status: 'initialized' },
          { path: 'vendor/clash', status: 'conflict' },
        ],
        [
          {
            path: 'vendor/moved',
            status: {
              submoduleStatus: {
                commitChanged: true,
                modifiedChanges: false,
                untrackedChanges: false,
              },
            },
          },
          {
            path: 'vendor/dirty',
            status: {
              submoduleStatus: {
                commitChanged: false,
                modifiedChanges: true,
                untrackedChanges: true,
              },
            },
          },
        ]
      )
      assert.deepStrictEqual(reasons.get('vendor/moved'), ['moved off its pin'])
      assert.deepStrictEqual(reasons.get('vendor/dirty'), [
        'uncommitted work',
        'untracked files',
      ])
      assert.deepStrictEqual(reasons.get('vendor/clash'), ['conflicted'])
    })
  })

  it('recognises paint modes', () => {
    assert.ok(isPaintMode('history'))
    assert.ok(!isPaintMode('sparkles'))
    assert.ok(!isPaintMode(undefined))
  })
})
