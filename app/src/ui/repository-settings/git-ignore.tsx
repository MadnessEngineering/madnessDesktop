import * as React from 'react'
import { DialogContent } from '../dialog'
import { TextArea } from '../lib/text-area'
import { LinkButton } from '../lib/link-button'
import { Ref } from '../lib/ref'
import { Select } from '../lib/select'
import { AutoIgnoreRepoSetting } from '../../models/auto-ignore'

interface IGitIgnoreProps {
  readonly text: string | null
  readonly onIgnoreTextChanged: (text: string) => void
  readonly onShowExamples: () => void
  /** This repository's say on auto-ignore (todo a8c1b611). */
  readonly autoIgnoreSetting: AutoIgnoreRepoSetting
  /** The global Auto-Ignore switch, for the 'inherit' option's label. */
  readonly autoIgnoreGlobalEnabled: boolean
  readonly onAutoIgnoreSettingChanged: (setting: AutoIgnoreRepoSetting) => void
}

/** A view for creating or modifying the repository's gitignore file */
export class GitIgnore extends React.Component<IGitIgnoreProps, {}> {
  private onAutoIgnoreSettingChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    const value = event.currentTarget.value
    if (value === 'inherit' || value === 'on' || value === 'off') {
      this.props.onAutoIgnoreSettingChanged(value)
    }
  }

  public render() {
    const globalState = this.props.autoIgnoreGlobalEnabled ? 'on' : 'off'
    return (
      <DialogContent>
        <p id="ignored-files-description">
          Editing <Ref>.gitignore</Ref>. This file specifies intentionally
          untracked files that Git should ignore. Files already tracked by Git
          are not affected.{' '}
          <LinkButton onClick={this.props.onShowExamples}>
            Learn more about gitignore files
          </LinkButton>
        </p>

        <TextArea
          ariaLabel="Ignored files"
          ariaDescribedBy="ignored-files-description"
          placeholder="Ignored files"
          value={this.props.text || ''}
          onValueChanged={this.props.onIgnoreTextChanged}
          textareaClassName="gitignore"
        />

        <Select
          label="Auto-ignore in this repository"
          value={this.props.autoIgnoreSetting}
          onChange={this.onAutoIgnoreSettingChanged}
        >
          <option value="inherit">Follow Settings (now {globalState})</option>
          <option value="on">On here</option>
          <option value="off">Off here</option>
        </Select>
        <p className="git-settings-description">
          Off keeps auto-ignore from committing .gitignore changes in this
          repository, for one where that commit isn't yours to make.
        </p>
      </DialogContent>
    )
  }
}
