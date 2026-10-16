import * as React from 'react'
import {
  Account,
  isDotComAccount,
  isEnterpriseAccount,
} from '../../models/account'
import { IAvatarUser } from '../../models/avatar'
import { lookupPreferredEmail } from '../../lib/email'
import { assertNever } from '../../lib/fatal-error'
import { Button } from '../lib/button'
import { Row } from '../lib/row'
import { DialogContent, DialogPreferredFocusClassName } from '../dialog'
import { Avatar } from '../lib/avatar'
import { CallToAction } from '../lib/call-to-action'
import { getHTMLURL } from '../../lib/api'
import type {
  MadnessSignInResult,
  MadnessSignInStep,
} from '../../models/omnispindle'

interface IAccountsProps {
  readonly accounts: ReadonlyArray<Account>

  readonly onDotComSignIn: () => void
  readonly onEnterpriseSignIn: () => void
  readonly onLogout: (account: Account) => void

  /** Whether an Omnispindle API key is already saved. */
  readonly hasOmnispindleKey: boolean
  /** Sign in to GitHub.com and Madness Interactive, skipping what's done. */
  readonly onMadnessSignIn: (
    onProgress: (step: MadnessSignInStep) => void
  ) => Promise<MadnessSignInResult>
  /** Abandon a GitHub browser sign-in that's still waiting. */
  readonly onCancelMadnessSignIn: () => void
}

type MadnessSignInStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working'; readonly step: MadnessSignInStep }
  | { readonly kind: 'error'; readonly message: string }

interface IAccountsState {
  readonly madnessSignIn: MadnessSignInStatus
}

enum SignInType {
  DotCom,
  Enterprise,
}

export class Accounts extends React.Component<IAccountsProps, IAccountsState> {
  private unmounted = false

  public constructor(props: IAccountsProps) {
    super(props)
    this.state = { madnessSignIn: { kind: 'idle' } }
  }

  public componentWillUnmount() {
    this.unmounted = true
  }

  public render() {
    const { accounts } = this.props
    const dotComAccount = accounts.find(isDotComAccount)

    return (
      <DialogContent className="accounts-tab">
        {this.renderMadnessSignIn(dotComAccount)}

        <h2>GitHub.com</h2>
        {dotComAccount
          ? this.renderAccount(dotComAccount, SignInType.DotCom)
          : this.renderSignIn(SignInType.DotCom)}

        <h2>GitHub Enterprise</h2>
        {this.renderMultipleEnterpriseAccounts()}
      </DialogContent>
    )
  }

  private renderMultipleEnterpriseAccounts() {
    const enterpriseAccounts = this.props.accounts.filter(isEnterpriseAccount)

    return (
      <>
        {enterpriseAccounts.map(account => {
          return this.renderAccount(account, SignInType.Enterprise)
        })}
        {enterpriseAccounts.length === 0 ? (
          this.renderSignIn(SignInType.Enterprise)
        ) : (
          <Button onClick={this.props.onEnterpriseSignIn}>
            Add GitHub Enterprise account
          </Button>
        )}
      </>
    )
  }

  private renderAccount(account: Account, type: SignInType) {
    const avatarUser: IAvatarUser = {
      name: account.name,
      email: lookupPreferredEmail(account),
      avatarURL: account.avatarURL,
      endpoint: account.endpoint,
    }

    // The DotCom account is shown first, so its sign in/out button should be
    // focused initially when the dialog is opened.
    const className =
      type === SignInType.DotCom ? DialogPreferredFocusClassName : undefined

    return (
      <Row className="account-info">
        <div className="user-info-container">
          <Avatar accounts={this.props.accounts} user={avatarUser} />
          <div className="user-info">
            {isEnterpriseAccount(account) ? (
              <>
                <div className="account-title">
                  {account.name === account.login
                    ? `@${account.login}`
                    : `@${account.login} (${account.name})`}
                </div>
                <div className="endpoint">{getHTMLURL(account.endpoint)}</div>
              </>
            ) : (
              <>
                <div className="name">{account.name}</div>
                <div className="login">@{account.login}</div>
              </>
            )}
          </div>
        </div>
        <Button onClick={this.logout(account)} className={className}>
          {__DARWIN__ ? 'Sign Out' : 'Sign out'}
        </Button>
      </Row>
    )
  }

  private renderMadnessSignIn(dotComAccount: Account | undefined) {
    const { hasOmnispindleKey } = this.props
    const status = this.state.madnessSignIn
    const working = status.kind === 'working'
    const allDone = dotComAccount !== undefined && hasOmnispindleKey

    return (
      <div className="madness-sign-in">
        <h2>Madness Interactive</h2>
        <p className="madness-sign-in-description">
          One sign-in for GitHub (repositories and git) and Omnispindle (todos
          and AI tools). Your browser opens for each one that isn't connected
          yet.
        </p>
        <ul className="madness-sign-in-checklist">
          <li className={dotComAccount ? 'done' : 'pending'}>
            {dotComAccount ? '✓' : '○'} GitHub.com
            {dotComAccount ? ` — @${dotComAccount.login}` : ' — not signed in'}
          </li>
          <li className={hasOmnispindleKey ? 'done' : 'pending'}>
            {hasOmnispindleKey ? '✓' : '○'} Omnispindle
            {hasOmnispindleKey ? ' — API key saved' : ' — not connected'}
          </li>
        </ul>
        <div className="madness-sign-in-row">
          <Button onClick={this.onMadnessSignIn} disabled={working || allDone}>
            {this.madnessSignInLabel(status, allDone)}
          </Button>
          {working && status.step === 'github' && (
            <Button onClick={this.onCancelMadnessSignIn}>Cancel</Button>
          )}
        </div>
        {working && (
          <p className="madness-sign-in-status">
            {status.step === 'github'
              ? 'Finish signing in to GitHub in your browser…'
              : 'Finish signing in to Madness Interactive in your browser…'}
          </p>
        )}
        {status.kind === 'error' && (
          <p className="madness-sign-in-status madness-sign-in-error">
            ✗ {status.message}
          </p>
        )}
      </div>
    )
  }

  private madnessSignInLabel(status: MadnessSignInStatus, allDone: boolean) {
    if (status.kind === 'working') {
      return 'Signing in…'
    }
    if (allDone) {
      return 'Signed in'
    }
    return 'Sign in with Madness Interactive'
  }

  private onMadnessSignIn = async () => {
    this.setState({ madnessSignIn: { kind: 'working', step: 'github' } })
    const result = await this.props.onMadnessSignIn(step => {
      if (!this.unmounted) {
        this.setState({ madnessSignIn: { kind: 'working', step } })
      }
    })
    if (this.unmounted) {
      return
    }
    this.setState({
      madnessSignIn:
        result.kind === 'error'
          ? { kind: 'error', message: result.message }
          : { kind: 'idle' },
    })
  }

  private onCancelMadnessSignIn = () => {
    this.props.onCancelMadnessSignIn()
  }

  private onDotComSignIn = () => {
    this.props.onDotComSignIn()
  }

  private onEnterpriseSignIn = () => {
    this.props.onEnterpriseSignIn()
  }

  private renderSignIn(type: SignInType) {
    const signInTitle = __DARWIN__ ? 'Sign Into' : 'Sign into'
    switch (type) {
      case SignInType.DotCom: {
        return (
          <CallToAction
            actionTitle={signInTitle + ' GitHub.com'}
            onAction={this.onDotComSignIn}
            // The DotCom account is shown first, so its sign in/out button should be
            // focused initially when the dialog is opened.
            buttonClassName={DialogPreferredFocusClassName}
          >
            <div>
              Sign in to your GitHub.com account to access your repositories.
            </div>
          </CallToAction>
        )
      }
      case SignInType.Enterprise:
        return (
          <CallToAction
            actionTitle={signInTitle + ' GitHub Enterprise'}
            onAction={this.onEnterpriseSignIn}
          >
            <div>
              If you are using GitHub Enterprise at work, sign in to it to get
              access to your repositories.
            </div>
          </CallToAction>
        )
      default:
        return assertNever(type, `Unknown sign in type: ${type}`)
    }
  }

  private logout = (account: Account) => {
    return () => {
      this.props.onLogout(account)
    }
  }
}
