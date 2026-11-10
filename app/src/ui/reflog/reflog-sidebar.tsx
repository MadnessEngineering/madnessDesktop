import * as React from 'react'
import { writeClipboardText } from '../main-process-proxy'
import { IReflogEntry } from '../../models/reflog-entry'
import { IActivityLogEntry } from '../../models/activity-log'
import { loadActivityLog, clearActivityLog } from '../../lib/activity-log'
import { IMenuItem, showContextualMenu } from '../../lib/menu-item'
import { RelativeTime } from '../relative-time'
import { Button } from '../lib/button'

interface IReflogSidebarProps {
  readonly entries: ReadonlyArray<IReflogEntry>
  readonly selectedSha: string | null
  readonly onEntrySelected: (sha: string) => void
  readonly onCheckoutEntry: (entry: IReflogEntry) => void
  readonly onCreateBranchFromEntry: (entry: IReflogEntry) => void
  readonly onResetToEntry: (entry: IReflogEntry) => void
}

interface IReflogSidebarState {
  readonly activityLog: ReadonlyArray<IActivityLogEntry>
  readonly showActivityLog: boolean
}

const actionLabels: Record<string, string> = {
  'ai-generate': 'AI',
  'ai-generate-empty': 'AI',
  'archive-chat': 'archive',
  'archive-fail': 'archive',
  'security-setting': 'security',
  'config-change': 'config',
}

export class ReflogSidebar extends React.Component<
  IReflogSidebarProps,
  IReflogSidebarState
> {
  public constructor(props: IReflogSidebarProps) {
    super(props)
    this.state = { activityLog: [], showActivityLog: true }
  }

  public componentDidMount() {
    this.setState({ activityLog: loadActivityLog() })
  }

  private onToggleActivityLog = () => {
    this.setState(prev => ({ showActivityLog: !prev.showActivityLog }))
  }

  private onClearActivityLog = () => {
    clearActivityLog()
    this.setState({ activityLog: [] })
  }

  private renderActivityLog() {
    const { activityLog, showActivityLog } = this.state

    return (
      <div className="activity-log-section">
        <div
          className="activity-log-header"
          onClick={this.onToggleActivityLog}
        >
          <span className="activity-log-toggle">
            {showActivityLog ? '▾' : '▸'}
          </span>
          <strong>Activity Log</strong>
          <span className="activity-log-count">({activityLog.length})</span>
        </div>

        {showActivityLog && (
          <>
            <div
              className="activity-log-list"
              style={{ maxHeight: '300px', overflow: 'auto' }}
            >
              {activityLog.length === 0 ? (
                <p className="activity-log-empty">No activity recorded yet.</p>
              ) : (
                [...activityLog].reverse().map((entry, i) => (
                  <div key={i} className="reflog-entry activity-log-entry">
                    <div className="reflog-entry-info">
                      <div className="reflog-summary">{entry.summary}</div>
                      <div className="reflog-byline">
                        <span
                          className={`reflog-action reflog-action--${entry.action}`}
                        >
                          {actionLabels[entry.action] ?? entry.action}
                        </span>
                        {entry.detail && (
                          <span className="reflog-author">{entry.detail}</span>
                        )}
                        <RelativeTime
                          date={new Date(entry.timestamp)}
                          className="reflog-date"
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            {activityLog.length > 0 && (
              <Button
                className="activity-log-clear"
                onClick={this.onClearActivityLog}
              >
                Clear Activity Log
              </Button>
            )}
          </>
        )}
      </div>
    )
  }

  private onEntryClick = (sha: string) => () => {
    this.props.onEntrySelected(sha)
  }

  private onEntryContextMenu =
    (entry: IReflogEntry) => (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      const items: ReadonlyArray<IMenuItem> = [
        {
          label: 'Checkout Commit',
          action: () => this.props.onCheckoutEntry(entry),
        },
        {
          label: 'Create Branch Here…',
          action: () => this.props.onCreateBranchFromEntry(entry),
        },
        {
          label: 'Reset to Commit…',
          action: () => this.props.onResetToEntry(entry),
        },
        { type: 'separator' },
        {
          label: 'Copy SHA',
          action: () => writeClipboardText(entry.sha),
        },
      ]
      showContextualMenu(items)
    }

  public render() {
    const { entries, selectedSha } = this.props

    return (
      <div className="reflog-sidebar">
        {entries.length === 0 ? (
          <p className="reflog-empty">No reflog entries found.</p>
        ) : (
          entries.map(entry => {
            const isSelected = entry.sha === selectedSha
            return (
              <div
                key={entry.selector}
                className={`reflog-entry${isSelected ? ' selected' : ''}`}
                onClick={this.onEntryClick(entry.sha)}
                onContextMenu={this.onEntryContextMenu(entry)}
              >
                <div className="reflog-entry-info">
                  <div className="reflog-summary">{entry.description}</div>
                  <div className="reflog-byline">
                    <span
                      className={`reflog-action reflog-action--${entry.action}`}
                      title={entry.action}
                    >
                      {entry.action}
                    </span>
                    {entry.author && (
                      <span className="reflog-author">{entry.author}</span>
                    )}
                    <RelativeTime date={entry.date} className="reflog-date" />
                  </div>
                </div>
              </div>
            )
          })
        )}
        {this.renderActivityLog()}
      </div>
    )
  }
}
