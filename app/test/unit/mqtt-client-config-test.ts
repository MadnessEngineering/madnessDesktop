import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { mkdtemp, readFile, readdir, rm, stat } from 'fs/promises'
import * as Os from 'os'
import * as Path from 'path'
import { writeMosquittoClientConfig } from '../../src/lib/mqtt/mqtt-config'

describe('writeMosquittoClientConfig', () => {
  let root: string
  let dir: string

  beforeEach(async () => {
    root = await mkdtemp(Path.join(Os.tmpdir(), 'mqtt-client-config-test-'))
    dir = Path.join(root, 'client')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('writes -u and -P options for both clients', async () => {
    const wrote = await writeMosquittoClientConfig(
      dir,
      'hookuser',
      'open sesame #1'
    )

    assert.strictEqual(wrote, true)
    for (const client of ['mosquitto_pub', 'mosquitto_sub']) {
      assert.strictEqual(
        await readFile(Path.join(dir, client), 'utf8'),
        '-u hookuser\n-P open sesame #1\n'
      )
    }
  })

  it('keeps the folder and files private to the owner', async () => {
    await writeMosquittoClientConfig(dir, 'u', 'p')

    assert.strictEqual((await stat(dir)).mode & 0o777, 0o700)
    assert.strictEqual(
      (await stat(Path.join(dir, 'mosquitto_pub'))).mode & 0o777,
      0o600
    )
  })

  it('writes only the options it has', async () => {
    await writeMosquittoClientConfig(dir, 'justuser', '')

    assert.strictEqual(
      await readFile(Path.join(dir, 'mosquitto_pub'), 'utf8'),
      '-u justuser\n'
    )
  })

  it('writes nothing without credentials', async () => {
    assert.strictEqual(await writeMosquittoClientConfig(dir, '', ''), false)
    await assert.rejects(readdir(dir))
  })

  it('refuses a value that would smuggle in another option', async () => {
    const wrote = await writeMosquittoClientConfig(
      dir,
      'u',
      'secret\n-h attacker.example'
    )

    assert.strictEqual(wrote, false)
    await assert.rejects(readdir(dir))
  })
})
