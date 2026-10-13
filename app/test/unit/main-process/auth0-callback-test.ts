import { describe, it } from 'node:test'
import assert from 'node:assert'
import { isAuth0CallbackURL } from '../../../src/main-process/auth0'

describe('isAuth0CallbackURL', () => {
  it('claims the Auth0 callback on both schemes', () => {
    assert.ok(
      isAuth0CallbackURL('x-madness-desktop-auth://callback?code=a&state=b')
    )
    assert.ok(
      isAuth0CallbackURL('x-madness-desktop-dev-auth://callback?code=a&state=b')
    )
    assert.ok(isAuth0CallbackURL('x-madness-desktop-auth://callback'))
  })

  it('leaves the GitHub OAuth callback for the renderer', () => {
    assert.ok(
      !isAuth0CallbackURL('x-madness-desktop-auth://oauth?code=a&state=b')
    )
    assert.ok(
      !isAuth0CallbackURL('x-madness-desktop-dev-auth://oauth?code=a&state=b')
    )
  })

  it('ignores other schemes and lookalike hosts', () => {
    assert.ok(!isAuth0CallbackURL('x-github-client://oauth?code=a&state=b'))
    assert.ok(
      !isAuth0CallbackURL('x-madness-desktop-auth://callbackevil?code=a')
    )
  })
})
