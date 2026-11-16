import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  applySettings,
  collectSettings,
  parseSettingsFile,
  PortableSettingKeys,
  SettingsFileFormat,
  SettingsFileVersion,
} from '../../src/lib/settings-transfer'

/** A localStorage stand-in. */
function memoryStorage(initial: { [key: string]: string } = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

describe('settings transfer', () => {
  describe('collectSettings', () => {
    it('takes the portable keys this machine has, and nothing else', () => {
      const storage = memoryStorage({
        'auto-ignore-config': '{"enabled":true,"patterns":[".claude_temp/"]}',
        'terminal-font-size': '15',
        'omnispindle-api-key': 'omni_secret',
        'stats-guid': 'abc',
        'custom-editor': '{"path":"/Applications/Code.app"}',
      })
      const file = collectSettings(storage, new Date('2026-11-15T12:00:00Z'))
      assert.equal(file.format, SettingsFileFormat)
      assert.equal(file.version, SettingsFileVersion)
      assert.equal(file.exportedAt, '2026-11-15T12:00:00.000Z')
      assert.deepEqual(Object.keys(file.settings).sort(), [
        'auto-ignore-config',
        'terminal-font-size',
      ])
    })

    it('never writes the MQTT password, even a legacy plaintext one', () => {
      const storage = memoryStorage({
        'madness-mqtt-config': '{"host":"eaws","password":"hunter2"}',
      })
      const { settings } = collectSettings(storage)
      assert.deepEqual(JSON.parse(settings['madness-mqtt-config']), {
        host: 'eaws',
      })
    })

    it('carries no secret, telemetry or machine-only key by design', () => {
      for (const key of [
        'omnispindle-api-key',
        'copilot-byok-providers',
        'stats-guid',
        'custom-editor',
        'custom-shell',
        'zoom-factor',
        'last-clone-location',
      ]) {
        assert.ok(!PortableSettingKeys.includes(key), key)
      }
    })
  })

  describe('parseSettingsFile', () => {
    const valid = {
      format: SettingsFileFormat,
      version: SettingsFileVersion,
      exportedAt: '2026-11-15T12:00:00.000Z',
      settings: { 'terminal-font-size': '15' },
    }

    it('reads a file it wrote', () => {
      const file = collectSettings(memoryStorage({ 'show-reflog-tab': '1' }))
      assert.deepEqual(parseSettingsFile(JSON.stringify(file)), file)
    })

    it('says what is wrong with a bad file', () => {
      assert.throws(() => parseSettingsFile('not json'), /not JSON/)
      assert.throws(
        () => parseSettingsFile('{"format":"something-else"}'),
        /not a Madness Desktop settings file/
      )
      assert.throws(
        () => parseSettingsFile(JSON.stringify({ ...valid, version: 99 })),
        /newer Madness Desktop/
      )
      assert.throws(
        () => parseSettingsFile(JSON.stringify({ ...valid, settings: [] })),
        /no settings/
      )
    })
  })

  describe('applySettings', () => {
    it('writes portable keys and skips the rest, secrets stripped again', () => {
      const storage = memoryStorage()
      const result = applySettings(storage, {
        format: SettingsFileFormat,
        version: SettingsFileVersion,
        exportedAt: '2026-11-15T12:00:00.000Z',
        settings: {
          'terminal-font-size': '15',
          'madness-mqtt-config': '{"host":"eaws","password":"hand-edited"}',
          'omnispindle-api-key': 'omni_smuggled',
          'auto-ignore-config': 42 as unknown as string,
        },
      })
      assert.deepEqual([...result.applied].sort(), [
        'madness-mqtt-config',
        'terminal-font-size',
      ])
      assert.deepEqual([...result.skipped].sort(), [
        'auto-ignore-config',
        'omnispindle-api-key',
      ])
      assert.equal(storage.data.get('terminal-font-size'), '15')
      assert.equal(storage.data.get('omnispindle-api-key'), undefined)
      assert.deepEqual(JSON.parse(storage.data.get('madness-mqtt-config')!), {
        host: 'eaws',
      })
    })
  })
})
