import * as React from 'react'
import { DialogContent } from '../dialog'
import { TextBox } from '../lib/text-box'
import { Checkbox, CheckboxValue } from '../lib/checkbox'

// The integrated terminal's settings, a tab of their own since they left
// Advanced (todo a8c1b611).
interface ITerminalPreferencesProps {
  readonly terminalOpenOnStartup: boolean
  readonly terminalFontSize: number
  readonly terminalCursorBlink: boolean
  readonly terminalScrollback: number
  readonly onTerminalOpenOnStartupChanged: (value: boolean) => void
  readonly onTerminalFontSizeChanged: (value: number) => void
  readonly onTerminalCursorBlinkChanged: (value: boolean) => void
  readonly onTerminalScrollbackChanged: (value: number) => void
}

export class TerminalPreferences extends React.Component<ITerminalPreferencesProps> {
  private onTerminalOpenOnStartupChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onTerminalOpenOnStartupChanged(event.currentTarget.checked)
  }

  private onTerminalCursorBlinkChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onTerminalCursorBlinkChanged(event.currentTarget.checked)
  }

  private onTerminalFontSizeChanged = (value: string) => {
    const n = parseInt(value, 10)
    if (!isNaN(n) && n >= 8 && n <= 32) {
      this.props.onTerminalFontSizeChanged(n)
    }
  }

  private onTerminalScrollbackChanged = (value: string) => {
    const n = parseInt(value, 10)
    if (!isNaN(n) && n >= 100 && n <= 100000) {
      this.props.onTerminalScrollbackChanged(n)
    }
  }

  public render() {
    return (
      <DialogContent>
        <div className="advanced-section">
          <h2>Integrated terminal</h2>
          <Checkbox
            label="Show terminal on startup"
            value={
              this.props.terminalOpenOnStartup
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onTerminalOpenOnStartupChanged}
          />
          <Checkbox
            label="Cursor blink"
            value={
              this.props.terminalCursorBlink
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onTerminalCursorBlinkChanged}
          />
          <TextBox
            label="Font size (8–32)"
            value={String(this.props.terminalFontSize)}
            onValueChanged={this.onTerminalFontSizeChanged}
          />
          <TextBox
            label="Scrollback lines (100–100000)"
            value={String(this.props.terminalScrollback)}
            onValueChanged={this.onTerminalScrollbackChanged}
          />
        </div>
      </DialogContent>
    )
  }
}
