import * as React from 'react'
import { DialogContent } from '../dialog'
import { TextBox } from '../lib/text-box'
import { Button } from '../lib/button'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import {
  IMqttConfig,
  getTopicPaths,
  writeMosquittoClientConfig,
} from '../../lib/mqtt/mqtt-config'
import { spawn } from 'child_process'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

interface IMqttPreferencesProps {
  readonly config: IMqttConfig
  readonly onConfigChanged: (config: IMqttConfig) => void
}

type TestStatus =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }

interface IMqttPreferencesState {
  readonly testStatus: TestStatus
}

export class MqttPreferences extends React.Component<
  IMqttPreferencesProps,
  IMqttPreferencesState
> {
  public constructor(props: IMqttPreferencesProps) {
    super(props)
    this.state = { testStatus: { kind: 'idle' } }
  }

  private update(partial: Partial<IMqttConfig>) {
    this.props.onConfigChanged({ ...this.props.config, ...partial })
  }

  private onEnabledChanged = (e: React.FormEvent<HTMLInputElement>) => {
    this.update({ enabled: (e.currentTarget as HTMLInputElement).checked })
  }

  private onHostChanged = (host: string) => this.update({ host })
  private onPortChanged = (value: string) => {
    const port = parseInt(value, 10)
    if (!isNaN(port) && port > 0 && port <= 65535) {
      this.update({ port })
    }
  }
  private onDeviceNameChanged = (deviceName: string) =>
    this.update({ deviceName })
  private onTopicPrefixChanged = (topicPrefix: string) =>
    this.update({ topicPrefix })
  private onUsernameChanged = (username: string) => this.update({ username })
  private onPasswordChanged = (password: string) => this.update({ password })

  private onTestConnection = async () => {
    const { config } = this.props
    this.setState({ testStatus: { kind: 'testing' } })

    try {
      const result = await testMqttConnection(config)
      this.setState({ testStatus: result })
    } catch (err) {
      this.setState({
        testStatus: {
          kind: 'error',
          message: err instanceof Error ? err.message : 'Test failed',
        },
      })
    }
  }

  private renderTestStatus() {
    const { testStatus } = this.state
    if (testStatus.kind === 'idle') {
      return null
    }
    if (testStatus.kind === 'testing') {
      return <p className="mqtt-test-status mqtt-test-working">Testing...</p>
    }
    if (testStatus.kind === 'success') {
      return (
        <p className="mqtt-test-status mqtt-test-ok">{testStatus.message}</p>
      )
    }
    return (
      <p className="mqtt-test-status mqtt-test-error">{testStatus.message}</p>
    )
  }

  private renderConnection() {
    const { config } = this.props
    const testing = this.state.testStatus.kind === 'testing'

    return (
      <div className="mqtt-section">
        <h2>Connection</h2>

        <Checkbox
          label="Enable MQTT integration"
          value={config.enabled ? CheckboxValue.On : CheckboxValue.Off}
          onChange={this.onEnabledChanged}
        />

        <div className="mqtt-fields">
          <TextBox
            label="Broker Host"
            value={config.host}
            onValueChanged={this.onHostChanged}
            placeholder="localhost"
            disabled={!config.enabled}
          />
          <TextBox
            label="Port"
            value={String(config.port)}
            onValueChanged={this.onPortChanged}
            placeholder="1883"
            disabled={!config.enabled}
          />
        </div>

        <div className="mqtt-test-row">
          <Button
            onClick={this.onTestConnection}
            disabled={testing || !config.enabled}
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </Button>
          {this.renderTestStatus()}
        </div>
      </div>
    )
  }

  private renderIdentity() {
    const { config } = this.props
    const topics = getTopicPaths(config)

    return (
      <div className="mqtt-section">
        <h2>Device Identity</h2>
        <p className="mqtt-description">
          Each machine in the workshop needs a unique device name. This
          identifies your commits and events on the shared broker.
        </p>

        <TextBox
          label="Device Name"
          value={config.deviceName}
          onValueChanged={this.onDeviceNameChanged}
          placeholder="my-workstation"
          disabled={!config.enabled}
        />
        <TextBox
          label="Topic Prefix"
          value={config.topicPrefix}
          onValueChanged={this.onTopicPrefixChanged}
          placeholder="status"
          disabled={!config.enabled}
        />

        <div className="mqtt-topic-preview">
          <div className="mqtt-topic-label">Topic Paths</div>
          <div className="mqtt-topic-path">
            <span className="mqtt-topic-kind">context</span>
            <code>{topics.context}</code>
          </div>
          <div className="mqtt-topic-path">
            <span className="mqtt-topic-kind">events</span>
            <code>{topics.events}</code>
          </div>
        </div>
      </div>
    )
  }

  private renderAuth() {
    const { config } = this.props

    return (
      <div className="mqtt-section">
        <h2>Authentication</h2>
        <p className="mqtt-description">
          Optional. Leave blank if your broker does not require credentials.
        </p>

        <TextBox
          label="Username"
          value={config.username}
          onValueChanged={this.onUsernameChanged}
          placeholder="(optional)"
          disabled={!config.enabled}
        />
        <TextBox
          label="Password"
          value={config.password}
          onValueChanged={this.onPasswordChanged}
          placeholder="(optional)"
          type="password"
          disabled={!config.enabled}
        />
      </div>
    )
  }

  public render() {
    return (
      <DialogContent>
        <div className="mqtt-preferences">
          {this.renderConnection()}
          {this.renderIdentity()}
          {this.renderAuth()}
        </div>
      </DialogContent>
    )
  }
}

type TestResult =
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }

/**
 * Test the MQTT settings by publishing once with `mosquitto_pub` — with the
 * same credential handling the hook scripts get, so a pass here means the
 * hooks can publish too. Credentials go through a throwaway mosquitto options
 * folder (see `writeMosquittoClientConfig`), never the command line.
 */
async function testMqttConnection(config: IMqttConfig): Promise<TestResult> {
  const configDir = await mkdtemp(join(tmpdir(), 'madness-mqtt-test-'))
  try {
    const hasCredentials = await writeMosquittoClientConfig(
      join(configDir, 'client'),
      config.username,
      config.password
    )
    const env: NodeJS.ProcessEnv = hasCredentials
      ? { ...process.env, XDG_CONFIG_HOME: join(configDir, 'client') }
      : { ...process.env }
    return await publishTestMessage(config, env)
  } finally {
    await rm(configDir, { recursive: true, force: true }).catch(() => {})
  }
}

function publishTestMessage(
  config: IMqttConfig,
  env: NodeJS.ProcessEnv
): Promise<TestResult> {
  return new Promise(resolve => {
    const args = [
      '-h',
      config.host,
      '-p',
      String(config.port),
      '-t',
      `${config.topicPrefix}/${config.deviceName}/madness-desktop/test`,
      '-m',
      JSON.stringify({ test: true, timestamp: new Date().toISOString() }),
    ]

    const proc = spawn('mosquitto_pub', args, { timeout: 5000, env })
    let stderr = ''

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', code => {
      if (code === 0) {
        resolve({
          kind: 'success',
          message: `Connected to ${config.host}:${config.port}`,
        })
      } else {
        resolve({
          kind: 'error',
          message: stderr.trim() || `mosquitto_pub exited with code ${code}`,
        })
      }
    })

    proc.on('error', err => {
      resolve({
        kind: 'error',
        message:
          (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'mosquitto_pub not found — install mosquitto-clients'
            : err.message,
      })
    })
  })
}
