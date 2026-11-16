// Not rendered anywhere: these settings show in another Settings tab now.
// Kept on purpose (Dan, 2026-11-15, todo a8c1b611), not dead code: don't delete
// it in a cleanup. The why is Dan's to add here.

import * as React from 'react'
import { DialogContent } from '../dialog'
import { TextBox } from '../lib/text-box'
import { Button } from '../lib/button'
import { invokeProxy } from '../main-process-proxy'
import type { OmnispindleTestResult } from '../../models/omnispindle'

interface IOmnispindlePreferencesProps {
  readonly apiKey: string
  readonly onApiKeyChanged: (value: string) => void
}

type TestStatus =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }

interface IOmnispindlePreferencesState {
  readonly testStatus: TestStatus
}

const testConnectionIpc = invokeProxy('omnispindle-test', 1)

export class OmnispindlePreferences extends React.Component<
  IOmnispindlePreferencesProps,
  IOmnispindlePreferencesState
> {
  public constructor(props: IOmnispindlePreferencesProps) {
    super(props)
    this.state = { testStatus: { kind: 'idle' } }
  }

  public componentDidUpdate(prev: IOmnispindlePreferencesProps) {
    // Clear status when user edits the key
    if (
      prev.apiKey !== this.props.apiKey &&
      this.state.testStatus.kind !== 'idle'
    ) {
      this.setState({ testStatus: { kind: 'idle' } })
    }
  }

  private onApiKeyChanged = (value: string) => {
    this.props.onApiKeyChanged(value)
  }

  private onTestConnection = async () => {
    const { apiKey } = this.props
    if (!apiKey.trim()) {
      this.setState({
        testStatus: { kind: 'error', message: 'Enter an API key first' },
      })
      return
    }
    this.setState({ testStatus: { kind: 'testing' } })
    try {
      const result: OmnispindleTestResult = await testConnectionIpc(apiKey)
      if (result.status === 'connected') {
        this.setState({
          testStatus: {
            kind: 'success',
            message: result.message ?? 'Connected successfully',
          },
        })
      } else {
        this.setState({
          testStatus: {
            kind: 'error',
            message: result.message ?? 'Connection failed',
          },
        })
      }
    } catch (err) {
      this.setState({
        testStatus: {
          kind: 'error',
          message: err instanceof Error ? err.message : 'Connection failed',
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
      return (
        <p className="omnispindle-test-status omnispindle-test-working">
          Testing connection…
        </p>
      )
    }
    if (testStatus.kind === 'success') {
      return (
        <p className="omnispindle-test-status omnispindle-test-ok">
          ✓ {testStatus.message}
        </p>
      )
    }
    return (
      <p className="omnispindle-test-status omnispindle-test-error">
        ✗ {testStatus.message}
      </p>
    )
  }

  public render() {
    const { apiKey } = this.props
    const { testStatus } = this.state
    const testing = testStatus.kind === 'testing'

    return (
      <DialogContent>
        <div className="omnispindle-preferences-section">
          <h2>Omnispindle</h2>
          <p className="git-settings-description">
            Connect to your Omnispindle MCP server to display active todos in
            the Changes sidebar. Use the refresh button in the sidebar to fetch
            the latest todos.
          </p>

          <TextBox
            label="API Key"
            value={apiKey}
            onValueChanged={this.onApiKeyChanged}
            placeholder="omni_..."
            type="password"
          />

          <div className="omnispindle-test-row">
            <Button
              onClick={this.onTestConnection}
              disabled={testing || !apiKey.trim()}
            >
              {testing ? 'Testing…' : 'Test Connection'}
            </Button>
            {this.renderTestStatus()}
          </div>

          <p className="git-settings-description">
            The bearer token used to authenticate with the Omnispindle HTTP MCP
            endpoint. API keys start with <code>omni_</code>.
          </p>
        </div>
      </DialogContent>
    )
  }
}
