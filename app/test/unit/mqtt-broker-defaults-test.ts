import assert from 'node:assert'
import { describe, it } from 'node:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import * as Os from 'os'
import * as Path from 'path'
import { defaultBroker, readMadMqttEnv } from '../../src/lib/mqtt/mqtt-config'

describe('defaultBroker', () => {
  const shared = { MADNESS_MQTT_HOST: 'broker.example', MADNESS_MQTT_PORT: '4140' }

  it('falls back to localhost:1883', () => {
    assert.deepStrictEqual(defaultBroker({}, {}), { host: 'localhost', port: 1883 })
  })

  it('uses ~/.mad/mqtt.env when the environment is unset', () => {
    assert.deepStrictEqual(defaultBroker({}, shared), { host: 'broker.example', port: 4140 })
  })

  it('lets the environment win', () => {
    assert.deepStrictEqual(defaultBroker({ MADNESS_MQTT_HOST: 'env.example' }, shared), {
      host: 'env.example',
      port: 4140,
    })
  })
})

describe('readMadMqttEnv', () => {
  it('reads KEY=VALUE lines and skips comments', async () => {
    const dir = await mkdtemp(Path.join(Os.tmpdir(), 'mad-mqtt-env-'))
    try {
      const file = Path.join(dir, 'mqtt.env')
      await writeFile(file, "# eaws\nMADNESS_MQTT_HOST='b.example'\nMADNESS_MQTT_PORT=4140\n")
      assert.deepStrictEqual(readMadMqttEnv(file), {
        MADNESS_MQTT_HOST: 'b.example',
        MADNESS_MQTT_PORT: '4140',
      })
      assert.deepStrictEqual(readMadMqttEnv(Path.join(dir, 'missing')), {})
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
