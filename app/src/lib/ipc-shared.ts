import { IMenuItemState } from './menu-update'
import { MenuIDs } from '../models/menu-ids'
import { ISerializableMenuItem } from './menu-item'
import { MenuLabelsEvent } from '../models/menu-labels'
import { MenuEvent } from '../main-process/menu'
import { LogLevel } from './logging/log-level'
import { ICrashDetails } from '../crash/shared'
import { WindowState } from './window-state'
import { IMenu } from '../models/app-menu'
import { ILaunchStats } from './stats'
import { URLActionType } from './parse-app-url'
import { Architecture } from './get-architecture'
import { EndpointToken } from './endpoint-token'
import { PathType } from '../ui/lib/app-proxy'
import { ThemeSource } from '../ui/lib/theme-source'
import { DesktopNotificationPermission } from 'desktop-notifications'
import { NotificationCallback } from 'desktop-notifications'
import { DesktopAliveEvent } from './stores/alive-store'
import { CLIAction } from './cli-action'
import { IDotfileDescriptor } from './dotfiles'
import {
  IOmnispindleTodo,
  OmnispindleConnectionStatus,
  OmnispindleTestResult,
  Auth0LoginResult,
} from '../models/omnispindle'
import type {
  HooksFetchResult,
  HookPushResult,
  HookDeleteResult,
  HookValidateResult,
  HookExecuteResult,
  RemoteHook,
} from '../main-process/automation-hooks-sync'
import type {
  ClaudeLoadoutResult,
  ClaudeLoadoutStatus,
  ClaudeLoadoutTier,
  ClaudeDepStatus,
} from './claude-hooks/types'

export interface ITerminalSpawnOptions {
  readonly cwd: string
  readonly shell?: string
  readonly cols: number
  readonly rows: number
}

/**
 * Defines the simplex IPC channel names we use from the renderer
 * process along with their signatures. This type is used from both
 * the renderer and the main process to ensure a common contract between
 * the two over the untyped IPC framework.
 */
export type RequestChannels = {
  'select-all-window-contents': () => void
  'dialog-did-open': () => void
  'update-menu-state': (
    state: Array<{ id: MenuIDs; state: IMenuItemState }>
  ) => void
  'renderer-ready': (time: number) => void
  'execute-menu-item-by-id': (id: string) => void
  'show-certificate-trust-dialog': (
    certificate: Electron.Certificate,
    message: string
  ) => void
  'get-app-menu': () => void
  'update-preferred-app-menu-item-labels': (labels: MenuLabelsEvent) => void
  'uncaught-exception': (error: Error) => void
  'send-error-report': (
    error: Error,
    extra: Record<string, string>,
    nonFatal: boolean
  ) => void
  'unsafe-open-directory': (path: string) => void
  'menu-event': (name: MenuEvent) => void
  log: (level: LogLevel, message: string) => void
  'will-quit': () => void
  'will-quit-even-if-updating': () => void
  'cancel-quitting': () => void
  'crash-ready': () => void
  'crash-quit': () => void
  'window-state-changed': (windowState: WindowState) => void
  error: (crashDetails: ICrashDetails) => void
  'zoom-factor-changed': (zoomFactor: number) => void
  'app-menu': (menu: IMenu) => void
  'launch-timing-stats': (stats: ILaunchStats) => void
  'url-action': (action: URLActionType) => void
  'cli-action': (action: CLIAction) => void
  'certificate-error': (
    certificate: Electron.Certificate,
    error: string,
    url: string
  ) => void
  focus: () => void
  blur: () => void
  'update-accounts': (accounts: ReadonlyArray<EndpointToken>) => void
  'quit-and-install-updates': () => void
  'quit-app': () => void
  'minimize-window': () => void
  'maximize-window': () => void
  'unmaximize-window': () => void
  'close-window': () => void
  'auto-updater-error': (error: Error) => void
  'auto-updater-checking-for-update': () => void
  'auto-updater-update-available': () => void
  'auto-updater-update-not-available': () => void
  'auto-updater-update-downloaded': () => void
  'native-theme-updated': () => void
  'set-native-theme-source': (themeName: ThemeSource) => void
  'update-window-background-color': (color: string) => void
  'focus-window': () => void
  'notification-event': NotificationCallback<DesktopAliveEvent>
  'set-window-zoom-factor': (zoomFactor: number) => void
  'show-installing-update': () => void
  'install-windows-cli': () => void
  'uninstall-windows-cli': () => void
  'omnispindle-todos-updated': (
    todos: ReadonlyArray<IOmnispindleTodo>,
    status: OmnispindleConnectionStatus
  ) => void
  'omnispindle-configure': (apiKey: string) => void
  'omnispindle-api-key-set': (apiKey: string) => void
  'omnispindle-refresh': (project?: string) => void
  'omnispindle-fire-event': (
    trigger: string,
    data: Record<string, unknown>,
    meta: Record<string, unknown>
  ) => void
  'update-hotkey-bindings': (bindings: Record<string, string | null>) => void
  'terminal-input': (id: string, data: string) => void
  'terminal-resize': (id: string, cols: number, rows: number) => void
  'terminal-kill': (id: string) => void
  'terminal-data': (id: string, data: string) => void
  'terminal-exit': (id: string, code: number) => void
}

/**
 * Defines the duplex IPC channel names we use from the renderer
 * process along with their signatures. This type is used from both
 * the renderer and the main process to ensure a common contract between
 * the two over the untyped IPC framework.
 *
 * Return signatures must be promises
 */
export type RequestResponseChannels = {
  'get-path': (path: PathType) => Promise<string>
  'get-app-architecture': () => Promise<Architecture>
  'get-app-path': () => Promise<string>
  'get-exec-path': () => Promise<string>
  'is-running-under-arm64-translation': () => Promise<boolean>
  'move-to-trash': (path: string) => Promise<void>
  'show-item-in-folder': (path: string) => Promise<void>
  'write-clipboard-text': (text: string) => Promise<void>
  'confirm-reveal-directory': () => Promise<boolean>
  'show-contextual-menu': (
    items: ReadonlyArray<ISerializableMenuItem>,
    addSpellCheckMenu: boolean
  ) => Promise<ReadonlyArray<number> | null>
  'is-window-focused': () => Promise<boolean>
  'open-external': (path: string) => Promise<boolean>
  'is-in-application-folder': () => Promise<boolean | null>
  'move-to-applications-folder': () => Promise<void>
  'check-for-updates': (url: string) => Promise<Error | undefined>
  'get-current-window-state': () => Promise<WindowState | undefined>
  'get-current-window-zoom-factor': () => Promise<number | undefined>
  'resolve-proxy': (url: string) => Promise<string>
  'show-save-dialog': (
    options: Electron.SaveDialogOptions
  ) => Promise<string | null>
  'show-open-dialog': (
    options: Electron.OpenDialogOptions
  ) => Promise<string | null>
  'is-window-maximized': () => Promise<boolean>
  'get-apple-action-on-double-click': () => Promise<Electron.AppleActionOnDoubleClickPref>
  'should-use-dark-colors': () => Promise<boolean>
  'save-guid': (guid: string) => Promise<void>
  'get-guid': () => Promise<string>
  /**
   * Write the textual result of a CLI command to a file so the (detached)
   * madhub CLI process can poll for it and print it to the terminal. Written
   * atomically (temp file + rename) so the CLI never reads a partial payload.
   */
  'cli-write-result': (path: string, content: string) => Promise<void>
  'show-notification': (
    title: string,
    body: string,
    userInfo?: DesktopAliveEvent
  ) => Promise<string | null>
  'get-notifications-permission': () => Promise<DesktopNotificationPermission>
  'request-notifications-permission': () => Promise<boolean>
  'omnispindle-test': (apiKey: string) => Promise<OmnispindleTestResult>
  'auth0-login': () => Promise<Auth0LoginResult>
  'automation-hooks-fetch': (apiKey: string) => Promise<HooksFetchResult>
  'automation-hooks-push': (
    apiKey: string,
    hook: Omit<RemoteHook, 'createdAt'>
  ) => Promise<HookPushResult>
  'automation-hooks-delete': (
    apiKey: string,
    id: string
  ) => Promise<HookDeleteResult>
  'automation-hooks-validate': (script: string) => Promise<HookValidateResult>
  'automation-hooks-execute': (
    script: string,
    env?: Record<string, string>
  ) => Promise<HookExecuteResult>
  'terminal-spawn': (options: ITerminalSpawnOptions) => Promise<string>
  'dotfile-list': (
    repoPath: string
  ) => Promise<ReadonlyArray<IDotfileDescriptor>>
  'dotfile-read': (repoPath: string, id: string) => Promise<string>
  'dotfile-write': (
    repoPath: string,
    id: string,
    contents: string
  ) => Promise<void>
  'claude-loadout-status': () => Promise<ClaudeLoadoutStatus>
  'claude-loadout-install': (
    tier: ClaudeLoadoutTier
  ) => Promise<ClaudeLoadoutResult>
  'claude-loadout-uninstall': () => Promise<ClaudeLoadoutResult>
  'claude-loadout-check-deps': (
    tier: ClaudeLoadoutTier
  ) => Promise<ReadonlyArray<ClaudeDepStatus>>
}
