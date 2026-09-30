# Authentication in Madness Desktop

Madness Desktop is a fork of GitHub Desktop, and GitHub's browser sign-in
(OAuth) is registered to GitHub's own app, so it won't redirect back to
Madness Desktop. Sign in with a personal access token instead — or, to run
your own OAuth app, see [OAuth app setup](./oauth-app-setup.md).

## Personal access token

This gives you the full account integration: your avatar, pull request status,
issue links, and repository lists.

1. On GitHub, go to **Settings → Developer settings → Personal access tokens**
   and create one. For a classic token, enable `repo` (and `read:org` if you
   work in organisation repositories).
2. In Madness Desktop, open the sign-in screen (on first launch, or
   **Settings → Accounts**), click **Use a token instead**, paste the token,
   and submit.

The token is stored in the system keychain, like any other Desktop account.

## Git Credential Manager

For pushing and pulling without signing in to an account, **Settings →
Advanced → Use Git Credential Manager** hands credentials to [Git Credential
Manager](https://gh.io/gcm). Upstream GitHub Desktop describes this as
experimental and meant for private repositories on hosts other than
GitHub.com. Account features — avatar, pull requests, issues — need a signed-in
account.
