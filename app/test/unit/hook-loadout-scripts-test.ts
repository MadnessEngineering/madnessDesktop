import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import * as Os from 'os'
import * as Path from 'path'
import {
  classifyScript,
  hashScript,
  readInstalledScript,
  writeInstalledScript,
} from '../../src/lib/hooks/loadout-manager'
import { HookScript } from '../../src/lib/hooks/loadout-types'

const script: HookScript = {
  id: 'demo',
  name: 'Demo',
  description: '',
  hookType: 'post-commit',
  script: '#!/usr/bin/env bash\necho v2\n',
}

describe('hook loadout scripts', () => {
  describe('classifyScript', () => {
    const builtin = hashScript('v2')
    const installed = hashScript('v1')

    it('is current when the file matches the built-in', () => {
      assert.strictEqual(classifyScript(builtin, installed, builtin), 'current')
    })

    it('is outdated when the file is untouched since an older install', () => {
      assert.strictEqual(
        classifyScript(installed, installed, builtin),
        'outdated'
      )
    })

    it('is customized when the file was edited after install', () => {
      assert.strictEqual(
        classifyScript(hashScript('my edit'), installed, builtin),
        'customized'
      )
    })

    it('treats any difference as outdated without an install record', () => {
      assert.strictEqual(
        classifyScript(hashScript('anything'), undefined, builtin),
        'outdated'
      )
    })
  })

  describe('reading and writing the installed copy', () => {
    let repo: string
    let dDir: string

    beforeEach(async () => {
      repo = await mkdtemp(Path.join(Os.tmpdir(), 'hook-loadout-test-'))
      dDir = Path.join(repo, '.githooks', 'post-commit.d')
      await mkdir(dDir, { recursive: true })
    })

    afterEach(async () => {
      await rm(repo, { recursive: true, force: true })
    })

    it('returns null when the script is not installed', async () => {
      assert.strictEqual(await readInstalledScript(repo, script), null)
    })

    it('reads and rewrites an enabled script in place', async () => {
      await writeFile(Path.join(dDir, 'demo.sh'), 'old', { mode: 0o755 })

      const hash = await writeInstalledScript(repo, script, 'new text')

      assert.strictEqual(await readInstalledScript(repo, script), 'new text')
      assert.strictEqual(hash, hashScript('new text'))
      const mode = (await stat(Path.join(dDir, 'demo.sh'))).mode & 0o777
      assert.strictEqual(mode, 0o755)
    })

    it('keeps a disabled script disabled when rewriting it', async () => {
      await writeFile(Path.join(dDir, 'demo.sh.disabled'), 'old')

      await writeInstalledScript(repo, script, 'new text')

      assert.strictEqual(
        await readFile(Path.join(dDir, 'demo.sh.disabled'), 'utf8'),
        'new text'
      )
      await assert.rejects(stat(Path.join(dDir, 'demo.sh')))
    })
  })
})
