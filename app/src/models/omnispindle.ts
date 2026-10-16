export interface IOmnispindleTodo {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly project?: string
  readonly priority?: string
  readonly notes?: string
  readonly createdAt?: number
}

export type OmnispindleConnectionStatus = 'connected' | 'error' | 'unconfigured'

export interface OmnispindleTestResult {
  readonly status: OmnispindleConnectionStatus
  readonly message?: string
}

/** Result of an Auth0 login that mints and persists an Omnispindle API key. */
export type Auth0LoginResult =
  | { readonly ok: true; readonly apiKey: string; readonly keyPrefix: string }
  | { readonly ok: false; readonly error: string }

/** The step a combined Madness Interactive sign-in is waiting on. */
export type MadnessSignInStep = 'github' | 'omnispindle'

/**
 * Result of signing in to GitHub.com and Madness Interactive in one go.
 * `apiKey` is null on success when an Omnispindle key already existed and that
 * step was skipped.
 */
export type MadnessSignInResult =
  | { readonly kind: 'success'; readonly apiKey: string | null }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'error'; readonly message: string }
