import { shell } from 'electron'
import * as crypto from 'crypto'

/**
 * Auth0 Authorization Code + PKCE login for the desktop app.
 *
 * The browser is opened to Auth0's /authorize endpoint and the result is
 * delivered back via the custom protocol the app already registers
 * (`x-madness-desktop-auth://` / dev variant). `main.ts` intercepts that
 * callback URL and hands it to `completeAuth0Login`, which exchanges the
 * authorization code for an access token (a JWT scoped to the Madness API).
 *
 * No Auth0 tokens are persisted — the JWT is transient and only used to mint
 * an Omnispindle API key, which is what we actually store.
 */

// Injected at build time from AUTH0_DOMAIN / AUTH0_AUDIENCE / AUTH0_CLIENT_ID
// (see app/app-info.ts). The clientId must belong to an Auth0 application whose
// Allowed Callback URLs include the custom scheme below, authorized for the
// audience above.
const AUTH0_DOMAIN = __AUTH0_DOMAIN__
const AUTH0_AUDIENCE = __AUTH0_AUDIENCE__
const AUTH0_CLIENT_ID = __AUTH0_CLIENT_ID__

const REDIRECT_PROTOCOL = __DEV_SECRETS__
  ? 'x-madness-desktop-dev-auth'
  : 'x-madness-desktop-auth'
const REDIRECT_URI = `${REDIRECT_PROTOCOL}://callback`

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

interface IPendingLogin {
  readonly resolve: (accessToken: string) => void
  readonly reject: (error: Error) => void
  readonly verifier: string
}

/** In-flight logins keyed by their CSRF `state` value. */
const pendingLogins = new Map<string, IPendingLogin>()

/**
 * Begin an Auth0 login. Opens the system browser and resolves with an access
 * token (JWT) once the user completes the flow and the callback is handled by
 * `completeAuth0Login`. Rejects on error or after a 5 minute timeout.
 */
export function startAuth0Login(): Promise<string> {
  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(
    crypto.createHash('sha256').update(verifier).digest()
  )
  const state = base64url(crypto.randomBytes(16))

  const url = new URL(`https://${AUTH0_DOMAIN}/authorize`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', AUTH0_CLIENT_ID)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('scope', 'openid profile email')
  url.searchParams.set('audience', AUTH0_AUDIENCE)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingLogins.delete(state)) {
        reject(new Error('Auth0 login timed out'))
      }
    }, LOGIN_TIMEOUT_MS)

    pendingLogins.set(state, {
      resolve: token => {
        clearTimeout(timeout)
        resolve(token)
      },
      reject: err => {
        clearTimeout(timeout)
        reject(err)
      },
      verifier,
    })

    shell.openExternal(url.toString()).catch(err => {
      clearTimeout(timeout)
      pendingLogins.delete(state)
      reject(err instanceof Error ? err : new Error(String(err)))
    })
  })
}

/**
 * True if the given protocol URL is an Auth0 login callback we should handle.
 *
 * Only the `callback` host belongs to Auth0. GitHub's OAuth sign-in comes back
 * on the same scheme as `<scheme>://oauth?code=…` and must fall through to the
 * renderer, so matching the bare scheme would swallow it.
 */
export function isAuth0CallbackURL(url: string): boolean {
  return /^x-madness-desktop(-dev)?-auth:\/\/callback(?:[/?#]|$)/i.test(url)
}

/**
 * Handle the Auth0 callback URL: validate the `state`, exchange the
 * authorization code for an access token, and resolve the pending login.
 */
export async function completeAuth0Login(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    log.warn('[auth0] received an unparseable callback URL')
    return
  }

  const state = parsed.searchParams.get('state')
  if (!state) {
    log.warn('[auth0] callback missing state')
    return
  }

  const pending = pendingLogins.get(state)
  if (!pending) {
    log.warn('[auth0] callback with unknown or expired state')
    return
  }
  pendingLogins.delete(state)

  const error = parsed.searchParams.get('error')
  if (error) {
    const description = parsed.searchParams.get('error_description') || error
    pending.reject(new Error(description))
    return
  }

  const code = parsed.searchParams.get('code')
  if (!code) {
    pending.reject(new Error('Auth0 callback missing authorization code'))
    return
  }

  try {
    const response = await fetch(`https://${AUTH0_DOMAIN}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: AUTH0_CLIENT_ID,
        code,
        code_verifier: pending.verifier,
        redirect_uri: REDIRECT_URI,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      pending.reject(
        new Error(
          `Token exchange failed: HTTP ${response.status} ${body.slice(0, 160)}`
        )
      )
      return
    }

    const json = await response.json()
    const accessToken = json?.access_token
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      pending.reject(new Error('Token exchange returned no access_token'))
      return
    }

    pending.resolve(accessToken)
  } catch (err) {
    pending.reject(err instanceof Error ? err : new Error(String(err)))
  }
}
