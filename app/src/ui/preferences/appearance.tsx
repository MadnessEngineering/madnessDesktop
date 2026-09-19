import * as React from 'react'
import {
  ApplicationTheme,
  supportsSystemThemeChanges,
  getCurrentlyAppliedTheme,
} from '../lib/application-theme'
import {
  MadnessTheme,
  MadnessPersonality,
  madnessThemes,
  madnessThemeLabels,
  madnessThemeSwatches,
  madnessPersonalities,
  madnessPersonalityLabels,
} from '../lib/madness-theme'
import { Row } from '../lib/row'
import { DialogContent } from '../dialog'
import { RadioGroup } from '../lib/radio-group'
import { Select } from '../lib/select'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { LinkButton } from '../lib/link-button'
import {
  getNotificationSettingsUrl,
  supportsNotifications,
  supportsNotificationsPermissionRequest,
} from 'desktop-notifications'
import {
  getNotificationsPermission,
  requestNotificationsPermission,
} from '../main-process-proxy'
import { encodePathAsUrl } from '../../lib/path'
import { tabSizeDefault } from '../../lib/stores/app-store'
import { enableFormattingPreferences } from '../../lib/feature-flag'
import {
  DateFormat,
  TimeFormat,
  INumberFormat,
  dateFormats,
  timeFormats,
  numberFormats,
  numberFormatToKey,
} from '../../models/formatting-preferences'
import { formatNumber } from '../../lib/format-number'

interface IAppearanceProps {
  readonly selectedTheme: ApplicationTheme
  readonly onSelectedThemeChanged: (theme: ApplicationTheme) => void
  readonly selectedMadnessTheme: MadnessTheme
  readonly onSelectedMadnessThemeChanged: (theme: MadnessTheme) => void
  readonly selectedPersonality: MadnessPersonality
  readonly onSelectedPersonalityChanged: (
    personality: MadnessPersonality
  ) => void
  readonly selectedTabSize: number
  readonly onSelectedTabSizeChanged: (tabSize: number) => void
  /**
   * Whether worktrees are turned on at all. Upstream ships the worktree list
   * behind their own kill switch; this fork gates it on the user preference in
   * Advanced, so the "always show" toggle has nothing to act on when that is
   * off and is hidden rather than shown as dead UI.
   */
  readonly worktreesEnabled: boolean
  readonly alwaysShowWorktreeList: boolean
  readonly onAlwaysShowWorktreeListChanged: (value: boolean) => void
  readonly selectedDateFormat: DateFormat
  readonly onSelectedDateFormatChanged: (format: DateFormat) => void
  readonly selectedTimeFormat: TimeFormat
  readonly onSelectedTimeFormatChanged: (format: TimeFormat) => void
  readonly selectedNumberFormat: INumberFormat
  readonly onSelectedNumberFormatChanged: (format: INumberFormat) => void
  readonly preferAbsoluteDates: boolean
  readonly onPreferAbsoluteDatesChanged: (value: boolean) => void
  // Notifications (merged)
  readonly notificationsEnabled: boolean
  readonly onNotificationsEnabledChanged: (checked: boolean) => void
  // Accessibility (merged)
  readonly underlineLinks: boolean
  readonly onUnderlineLinksChanged: (value: boolean) => void
  readonly showDiffCheckMarks: boolean
  readonly onShowDiffCheckMarksChanged: (value: boolean) => void
  // Changes list
  readonly groupChangesByFolder: boolean
  readonly onGroupChangesByFolderChanged: (value: boolean) => void
}

interface IAppearanceState {
  readonly selectedTheme: ApplicationTheme | null
  readonly selectedTabSize: number
  readonly suggestGrantNotificationPermission: boolean
  readonly warnNotificationsDenied: boolean
  readonly suggestConfigureNotifications: boolean
}

export class Appearance extends React.Component<
  IAppearanceProps,
  IAppearanceState
> {
  public constructor(props: IAppearanceProps) {
    super(props)

    const usePropTheme =
      props.selectedTheme !== ApplicationTheme.System ||
      supportsSystemThemeChanges()

    this.state = {
      selectedTheme: usePropTheme ? props.selectedTheme : null,
      selectedTabSize: props.selectedTabSize,
      suggestGrantNotificationPermission: false,
      warnNotificationsDenied: false,
      suggestConfigureNotifications: false,
    }

    if (!usePropTheme) {
      this.initializeSelectedTheme()
    }
  }

  public componentDidMount() {
    this.updateNotificationsState()
  }

  public async componentDidUpdate(prevProps: IAppearanceProps) {
    if (prevProps === this.props) {
      return
    }

    const usePropTheme =
      this.props.selectedTheme !== ApplicationTheme.System ||
      supportsSystemThemeChanges()

    const selectedTheme = usePropTheme
      ? this.props.selectedTheme
      : await getCurrentlyAppliedTheme()

    const selectedTabSize = this.props.selectedTabSize

    this.setState({ selectedTheme, selectedTabSize })
  }

  private initializeSelectedTheme = async () => {
    const selectedTheme = await getCurrentlyAppliedTheme()
    const selectedTabSize = this.props.selectedTabSize
    this.setState({ selectedTheme, selectedTabSize })
  }

  private onSelectedThemeChanged = (theme: ApplicationTheme) => {
    this.props.onSelectedThemeChanged(theme)
  }

  private onSelectedTabSizeChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    this.props.onSelectedTabSizeChanged(parseInt(event.currentTarget.value))
  }

  private onDateFormatChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    const value = event.currentTarget.value
    const match = dateFormats.find(f => f.pattern === value)
    if (match !== undefined) {
      this.props.onSelectedDateFormatChanged(match.pattern)
    }
  }

  private onTimeFormatChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    const value = event.currentTarget.value
    const match = timeFormats.find(f => f.pattern === value)
    if (match !== undefined) {
      this.props.onSelectedTimeFormatChanged(match.pattern)
    }
  }

  private onNumberFormatChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    const match = numberFormats.find(
      n => numberFormatToKey(n) === event.currentTarget.value
    )
    if (match) {
      this.props.onSelectedNumberFormatChanged(match)
    }
  }

  private onPreferAbsoluteDatesChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onPreferAbsoluteDatesChanged(event.currentTarget.checked)
  }

  private onAlwaysShowWorktreeListChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onAlwaysShowWorktreeListChanged(event.currentTarget.checked)
  }

  public renderThemeSwatch = (theme: ApplicationTheme) => {
    const darkThemeImage = encodePathAsUrl(__dirname, 'static/ghd_dark.svg')
    const lightThemeImage = encodePathAsUrl(__dirname, 'static/ghd_light.svg')

    switch (theme) {
      case ApplicationTheme.Light:
        return (
          <span>
            <img src={lightThemeImage} alt="" />
            <span className="theme-value-label">Light</span>
          </span>
        )
      case ApplicationTheme.Dark:
        return (
          <span>
            <img src={darkThemeImage} alt="" />
            <span className="theme-value-label">Dark</span>
          </span>
        )
      case ApplicationTheme.System:
        /** Why three images? The system theme swatch uses the first image
         * positioned relatively to get the label container size and uses the
         * second and third positioned absolutely over first and third one
         * clipped in half to render a split dark and light theme swatch. */
        return (
          <span>
            <span className="system-theme-swatch">
              <img src={lightThemeImage} alt="" />
              <img src={lightThemeImage} alt="" />
              <img src={darkThemeImage} alt="" />
            </span>
            <span className="theme-value-label">System</span>
          </span>
        )
    }
  }

  private renderSelectedTheme() {
    const selectedTheme = this.state.selectedTheme

    if (selectedTheme == null) {
      return <Row>Loading system theme</Row>
    }

    const themes = [
      ApplicationTheme.Light,
      ApplicationTheme.Dark,
      ...(supportsSystemThemeChanges() ? [ApplicationTheme.System] : []),
    ]

    return (
      <div className="appearance-section">
        <h2 id="theme-heading">Theme</h2>

        <RadioGroup<ApplicationTheme>
          ariaLabelledBy="theme-heading"
          className="theme-selector"
          selectedKey={selectedTheme}
          radioButtonKeys={themes}
          onSelectionChanged={this.onSelectedThemeChanged}
          renderRadioButtonLabelContents={this.renderThemeSwatch}
        />
      </div>
    )
  }

  private renderFormatting() {
    if (!enableFormattingPreferences()) {
      return null
    }

    return (
      <div className="appearance-section formatting-section">
        <h2 id="formatting-heading">Formatting</h2>

        <Row>
          <Select
            label={__DARWIN__ ? 'Date Format' : 'Date format'}
            value={this.props.selectedDateFormat}
            onChange={this.onDateFormatChanged}
          >
            {dateFormats.map(({ pattern, example }) => (
              <option key={pattern} value={pattern}>
                {example} ({pattern})
              </option>
            ))}
          </Select>

          <Select
            label={__DARWIN__ ? 'Time Format' : 'Time format'}
            value={this.props.selectedTimeFormat}
            onChange={this.onTimeFormatChanged}
          >
            {timeFormats.map(({ pattern, example }) => (
              <option key={pattern} value={pattern}>
                {example} ({pattern})
              </option>
            ))}
          </Select>
        </Row>

        <Select
          label={__DARWIN__ ? 'Number Format' : 'Number format'}
          value={numberFormatToKey(this.props.selectedNumberFormat)}
          onChange={this.onNumberFormatChanged}
        >
          {numberFormats.map(format => (
            <option
              key={numberFormatToKey(format)}
              value={numberFormatToKey(format)}
            >
              {formatNumber(1234567.89, format)}
            </option>
          ))}
        </Select>

        <Checkbox
          className="prefer-absolute-dates"
          label="Prefer absolute dates over relative"
          value={
            this.props.preferAbsoluteDates
              ? CheckboxValue.On
              : CheckboxValue.Off
          }
          onChange={this.onPreferAbsoluteDatesChanged}
        />
      </div>
    )
  }

  private onGroupChangesByFolderChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onGroupChangesByFolderChanged(event.currentTarget.checked)
  }

  private renderChangesList() {
    return (
      <div className="appearance-section">
        <h2>{__DARWIN__ ? 'Changes List' : 'Changes list'}</h2>

        <Checkbox
          label={
            __DARWIN__ ? 'Group Files Into Folders' : 'Group files into folders'
          }
          value={
            this.props.groupChangesByFolder
              ? CheckboxValue.On
              : CheckboxValue.Off
          }
          onChange={this.onGroupChangesByFolderChanged}
          ariaDescribedBy="group-changes-by-folder-description"
        />
        <p
          id="group-changes-by-folder-description"
          className="git-settings-description"
        >
          When enabled, the changed files are grouped under folder headers that
          fold their contents away. When disabled, the list stays a flat set of
          full paths.
        </p>
      </div>
    )
  }

  private renderMiscellaneous() {
    const availableTabSizes: number[] = [1, 2, 3, 4, 5, 6, 8, 10, 12]

    return (
      <div className="appearance-section">
        <h2 id="miscellaneous-heading">Miscellaneous</h2>

        <Select
          value={this.state.selectedTabSize.toString()}
          label={__DARWIN__ ? 'Diff Tab Size' : 'Diff tab size'}
          onChange={this.onSelectedTabSizeChanged}
        >
          {availableTabSizes.map(n => (
            <option key={n} value={n}>
              {n === tabSizeDefault ? `${n} (default)` : n}
            </option>
          ))}
        </Select>

        {this.props.worktreesEnabled && (
          <Checkbox
            className="always-show-worktree-list"
            label="Always show worktree list"
            value={
              this.props.alwaysShowWorktreeList
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onAlwaysShowWorktreeListChanged}
          />
        )}
      </div>
    )
  }

  private renderMadnessThemes() {
    const { selectedMadnessTheme, onSelectedMadnessThemeChanged } = this.props

    return (
      <div className="appearance-section madness-theme-section">
        <h2 id="madness-theme-heading">Color Theme</h2>
        <div
          className="madness-theme-grid"
          role="group"
          aria-labelledby="madness-theme-heading"
        >
          <button
            type="button"
            className={`madness-swatch${
              !selectedMadnessTheme ? ' selected' : ''
            }`}
            onClick={() => onSelectedMadnessThemeChanged('')}
            aria-pressed={!selectedMadnessTheme}
            title="No color theme"
          >
            <span className="swatch-preview swatch-none" />
            <span className="swatch-label">None</span>
          </button>
          {madnessThemes.map(t => {
            const s = madnessThemeSwatches[t]
            const previewStyle = {
              background: `linear-gradient(135deg, ${s.bg} 0%, ${s.bg} 40%, ${s.primary} 40%, ${s.primary} 70%, ${s.secondary} 70%)`,
            }
            return (
              <button
                type="button"
                key={t}
                className={`madness-swatch${
                  selectedMadnessTheme === t ? ' selected' : ''
                }`}
                onClick={() => onSelectedMadnessThemeChanged(t)}
                aria-pressed={selectedMadnessTheme === t}
                title={madnessThemeLabels[t]}
              >
                <span className="swatch-preview" style={previewStyle} />
                <span className="swatch-label">{madnessThemeLabels[t]}</span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  private onPersonalityChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    this.props.onSelectedPersonalityChanged(
      event.currentTarget.value as MadnessPersonality
    )
  }

  private renderPersonalitySelector() {
    return (
      <div className="appearance-section">
        <h2 id="personality-heading">Personality</h2>
        <Select
          label="UI voice"
          value={this.props.selectedPersonality}
          onChange={this.onPersonalityChanged}
        >
          <option value="">None (standard English)</option>
          {madnessPersonalities.map(p => (
            <option key={p} value={p}>
              {madnessPersonalityLabels[p]}
            </option>
          ))}
        </Select>
      </div>
    )
  }

  // ─── Notifications ──────────────────────────────────────────────────────────

  private onNotificationsEnabledChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onNotificationsEnabledChanged(event.currentTarget.checked)
  }

  private onGrantNotificationPermission = async () => {
    await requestNotificationsPermission()
    this.updateNotificationsState()
  }

  private async updateNotificationsState() {
    const notificationsPermission = await getNotificationsPermission()
    this.setState({
      suggestGrantNotificationPermission:
        supportsNotificationsPermissionRequest() &&
        notificationsPermission === 'default',
      warnNotificationsDenied: notificationsPermission === 'denied',
      suggestConfigureNotifications: notificationsPermission === 'granted',
    })
  }

  private renderNotificationHint() {
    if (!supportsNotifications() || !this.props.notificationsEnabled) {
      return null
    }

    const {
      suggestGrantNotificationPermission,
      warnNotificationsDenied,
      suggestConfigureNotifications,
    } = this.state

    if (suggestGrantNotificationPermission) {
      return (
        <>
          {' '}
          You need to{' '}
          <LinkButton onClick={this.onGrantNotificationPermission}>
            grant permission
          </LinkButton>{' '}
          to display these notifications from Madness Desktop.
        </>
      )
    }

    const notificationSettingsURL = getNotificationSettingsUrl()
    if (notificationSettingsURL === null) {
      return null
    }

    if (warnNotificationsDenied) {
      return (
        <div className="setting-hint-warning">
          <span className="warning-icon">⚠️</span> Madness Desktop has no
          permission to display notifications. Please, enable them in the{' '}
          <LinkButton uri={notificationSettingsURL}>
            Notifications Settings
          </LinkButton>
          .
        </div>
      )
    }

    const verb = suggestConfigureNotifications
      ? 'properly configured'
      : 'enabled'

    return (
      <>
        {' '}
        Make sure notifications are {verb} for Madness Desktop in the{' '}
        <LinkButton uri={notificationSettingsURL}>
          Notifications Settings
        </LinkButton>
        .
      </>
    )
  }

  private renderNotifications() {
    return (
      <div className="appearance-section">
        <h2>Notifications</h2>
        <Checkbox
          label="Enable notifications"
          value={
            this.props.notificationsEnabled
              ? CheckboxValue.On
              : CheckboxValue.Off
          }
          onChange={this.onNotificationsEnabledChanged}
        />
        <p className="git-settings-description">
          Allows the display of notifications when high-signal events take place
          in the current repository.{this.renderNotificationHint()}
        </p>
      </div>
    )
  }

  // ─── Accessibility ─────────────────────────────────────────────────────────

  private onUnderlineLinksChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onUnderlineLinksChanged(event.currentTarget.checked)
  }

  private onShowDiffCheckMarksChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onShowDiffCheckMarksChanged(event.currentTarget.checked)
  }

  private renderExampleLink() {
    const style = {
      textDecoration: this.props.underlineLinks ? 'underline' : 'none',
    }
    return (
      <span className="link-button-component" style={style}>
        This is an example link
      </span>
    )
  }

  private renderAccessibility() {
    return (
      <div className="appearance-section">
        <h2>Accessibility</h2>
        <Checkbox
          label="Underline links"
          value={
            this.props.underlineLinks ? CheckboxValue.On : CheckboxValue.Off
          }
          onChange={this.onUnderlineLinksChanged}
          ariaDescribedBy="underline-setting-description"
        />
        <p
          id="underline-setting-description"
          className="git-settings-description"
        >
          When enabled, Madness Desktop will underline links in commit messages,
          comments, and other text fields. {this.renderExampleLink()}
        </p>

        <Checkbox
          label="Show check marks in the diff"
          value={
            this.props.showDiffCheckMarks ? CheckboxValue.On : CheckboxValue.Off
          }
          onChange={this.onShowDiffCheckMarksChanged}
          ariaDescribedBy="diff-checkmarks-setting-description"
        />
        <p
          id="diff-checkmarks-setting-description"
          className="git-settings-description"
        >
          When enabled, check marks will be displayed along side the line
          numbers in the diff when committing.
        </p>
      </div>
    )
  }

  // ─── Main render ───────────────────────────────────────────────────────────

  public render() {
    return (
      <DialogContent>
        {this.renderSelectedTheme()}
        {this.renderMadnessThemes()}
        {this.renderPersonalitySelector()}
        {this.renderFormatting()}
        {this.renderMiscellaneous()}
        {this.renderChangesList()}
        {this.renderNotifications()}
        {this.renderAccessibility()}
      </DialogContent>
    )
  }
}
