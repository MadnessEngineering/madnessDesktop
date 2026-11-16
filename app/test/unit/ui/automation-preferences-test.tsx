import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { render, screen, fireEvent } from '../../helpers/ui/render'
import { AutomationPreferences } from '../../../src/ui/preferences/automation'
import { TerminalPreferences } from '../../../src/ui/preferences/terminal'
import { GitIgnore } from '../../../src/ui/repository-settings/git-ignore'
import {
  DefaultAutoIgnoreConfig,
  AutoIgnoreRepoSetting,
} from '../../../src/models/auto-ignore'
import {
  DefaultChatHistoryArchiveConfig,
  IChatHistoryArchiveConfig,
} from '../../../src/models/chat-history-archive'

// The Settings split from todo a8c1b611: Auto-Ignore, the Chat History Archive
// and auto-switch share an Automation tab, the terminal has its own, and a
// repository can say on or off to auto-ignore.

describe('Automation preferences', () => {
  function renderAutomation() {
    const archiveChanges: IChatHistoryArchiveConfig[] = []
    let hooksOpened = 0
    render(
      <AutomationPreferences
        autoIgnoreConfig={DefaultAutoIgnoreConfig}
        onAutoIgnoreConfigChanged={() => {}}
        chatHistoryArchiveConfig={{
          ...DefaultChatHistoryArchiveConfig,
          enabled: false,
        }}
        onChatHistoryArchiveConfigChanged={c => archiveChanges.push(c)}
        autoSwitchOnChangesEnabled={false}
        onAutoSwitchOnChangesEnabledChanged={() => {}}
        onOpenHooks={() => hooksOpened++}
      />
    )
    return { archiveChanges, hooksOpened: () => hooksOpened }
  }

  it('holds Auto-Ignore, the Chat History Archive and the way to Hooks', () => {
    renderAutomation()
    assert.ok(screen.getByRole('heading', { name: 'Standard Ignore Patterns' }))
    assert.ok(screen.getByRole('heading', { name: 'Chat History Archive' }))
    assert.ok(screen.getByRole('heading', { name: 'Hooks' }))
  })

  it('switches the archive on through its own checkbox', () => {
    const { archiveChanges } = renderAutomation()
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Enable background chat history archiving',
      })
    )
    assert.equal(archiveChanges.length, 1)
    assert.equal(archiveChanges[0].enabled, true)
  })

  it('Open Hooks asks the dialog for the Hooks tab', () => {
    const { hooksOpened } = renderAutomation()
    fireEvent.click(screen.getByRole('button', { name: 'Open Hooks' }))
    assert.equal(hooksOpened(), 1)
  })
})

describe('Terminal preferences', () => {
  it('passes a font size in range and drops one out of it', () => {
    const sizes: number[] = []
    render(
      <TerminalPreferences
        terminalOpenOnStartup={false}
        terminalFontSize={13}
        terminalCursorBlink={true}
        terminalScrollback={1000}
        onTerminalOpenOnStartupChanged={() => {}}
        onTerminalFontSizeChanged={n => sizes.push(n)}
        onTerminalCursorBlinkChanged={() => {}}
        onTerminalScrollbackChanged={() => {}}
      />
    )
    const fontSize = screen.getByRole('textbox', { name: /Font size/ })
    fireEvent.change(fontSize, { target: { value: '16' } })
    fireEvent.change(fontSize, { target: { value: '99' } })
    assert.deepEqual(sizes, [16])
  })
})

describe('Repository Settings: auto-ignore in this repository', () => {
  function renderGitIgnore(
    setting: AutoIgnoreRepoSetting,
    globalEnabled: boolean
  ) {
    const picked: AutoIgnoreRepoSetting[] = []
    render(
      <GitIgnore
        text=""
        onIgnoreTextChanged={() => {}}
        onShowExamples={() => {}}
        autoIgnoreSetting={setting}
        autoIgnoreGlobalEnabled={globalEnabled}
        onAutoIgnoreSettingChanged={s => picked.push(s)}
      />
    )
    return picked
  }

  it('shows the repository setting and what following Settings means now', () => {
    renderGitIgnore('inherit', true)
    const select = screen.getByRole('combobox', {
      name: 'Auto-ignore in this repository',
    }) as HTMLSelectElement
    assert.equal(select.value, 'inherit')
    assert.ok(screen.getByRole('option', { name: 'Follow Settings (now on)' }))
  })

  it('reports the pick', () => {
    const picked = renderGitIgnore('inherit', false)
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Auto-ignore in this repository' }),
      { target: { value: 'off' } }
    )
    assert.deepEqual(picked, ['off'])
  })
})
