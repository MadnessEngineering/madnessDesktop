# Syncing with upstream GitHub Desktop

Madness Desktop is a fork of [desktop/desktop](https://github.com/desktop/desktop).
We merge upstream periodically, mostly for security upkeep: upstream's security
work is overwhelmingly dependabot bumps plus Electron upgrades, and those land in
files we rarely touch. The features are a bonus; the dependency hygiene is the
reason.

Upstream is already configured as a remote:

```
upstream  https://github.com/desktop/desktop.git
```

Their default branch is `development`.

## Cadence

Merge after each upstream release tag (they ship roughly monthly). At that
interval the conflict set stays around ten files. Divergence compounds in
exactly the wrong place — `app-store.ts`, `app.tsx`, `dispatcher.ts` are both
our most-modified files and upstream's hottest — so waiting is not free.

For reference, two months of drift (2026-05-29 → 2026-07-27) cost 16 conflicted
files and about 31 hunks, roughly an afternoon including verification.

## Probe first

Measure before committing to the work. A trial merge in a throwaway worktree
tells you the real cost without touching your branch:

```sh
git fetch upstream
git worktree add --detach /tmp/merge-probe HEAD
git -C /tmp/merge-probe merge upstream/development
git -C /tmp/merge-probe diff --name-only --diff-filter=U     # conflicted files
git -C /tmp/merge-probe merge --abort
git worktree remove --force /tmp/merge-probe
```

Useful sizing numbers, where `$MB` is `git merge-base HEAD upstream/development`:

```sh
git diff --shortstat $MB..HEAD                    # our divergence
git diff --shortstat $MB..upstream/development    # theirs
git log --oneline $MB..upstream/development --grep=bump -i   # dependency work
```

Also diff the security-relevant dependency versions directly — that is usually
the whole argument for merging now rather than later:

```sh
git show upstream/development:app/package.json | grep -E '"dompurify"|"electron"'
```

## Merging

Work on a branch, never on the default branch:

```sh
git checkout -b madness/merge-upstream-YYYY-MM
git merge upstream/development
```

Then resolve, using the standing policy below.

### Standing resolution policy

**Ours wins** — these encode deliberate fork decisions:

- App identity in `app/package.json`: `name`, `productName`, `bundleID`,
  `companyName`, `version`.
- Worktree gating. We ship worktrees behind the `worktreesEnabled` user
  preference, which is stricter than upstream's `enableWorktreeSupport` kill
  switch. Keep their flag defined so their call sites compile; keep our
  preference doing the gating.
- Our subsystems: Omnispindle, MQTT, local AI commit messages, chat-history
  archiving, hotkey bindings, the integrated terminal, theme strings.
- Our build gates, such as skipping the Copilot copy for production releases.

**Theirs wins** — taking upstream wholesale is usually right, and cheaper than
it looks:

- Copilot integration. Upstream iterates on it hard, and our edits there have
  been one-to-three-line rebrands or SDK type workarounds. Check whether our
  change even still applies: an SDK-drift workaround is obsolete after they
  upgrade the SDK, and a rebranded button is moot once their rewrite deletes it.
- Structural refactors of shared code. Adopt the new shape and re-apply our
  additions on top — for example their `buildDefaultMenu` /
  `buildDefaultMenuTemplate` split, which we took while keeping our
  hotkey-binding accelerators.
- Renames that unify state. We adopted their account-scoped
  `selectedCopilotModelsByAccount` and dropped our flat `selectedCopilotModels`
  rather than carrying both — two sources of truth for one user setting is worse
  than a port.
- File deletions. If upstream deletes a component we had only rebranded, accept
  the deletion and rebrand its replacement.

**Both** — most conflicts are additive on each side (a prop, a dispatcher
method, an import block). Concatenate and move on.

**Watch for upstream *moving* code you also changed.** A relocation conflicts at
the origin and merges cleanly at the destination, so the conflict markers show
you half of it and the other half is already in the file. Concatenating both
sides then duplicates the moved code. In the 2026-09 sync upstream moved
`push`'s remote name, refspec and tags to the end of the function behind a `--`
terminator (their leading-dash hardening); our side of the conflict still
carried the tags block from the top, and taking both would have pushed every tag
twice. Before resolving a conflict, read the whole function in the merged file,
not just the marked region.

**Re-gate upstream's new options.** Where we gate a feature more strictly than
upstream, each sync can bring fresh UI for it that arrives ungated. 2026-09
brought an "Always show worktree list" checkbox straight into Appearance, which
is dead UI when our `worktreesEnabled` preference is off; it now renders behind
that preference. Grep new preference UI for the features we gate.

**Lockfiles** — never hand-merge. Take one side, then regenerate:

```sh
git checkout --theirs app/yarn.lock && git add app/yarn.lock
cd app && yarn install
```

Afterwards confirm both their bumps and our extra dependencies survived
(`@lydell/node-pty`, the `@xterm/*` addons).

## Audit for silently dropped lines

A merge can eat one of our added lines without ever reporting a conflict, when
that line sits inside a region upstream rewrote. This is the failure mode most
likely to reach a release, because nothing flags it. After resolving, diff the
merge against the commit you started from and read every removal:

```sh
git diff <pre-merge-sha> HEAD -- script/ app/src | grep '^-' |
  grep -iE 'madness|omnispindle|mqtt|localai|hotkey|terminal'
```

In the 2026-07 sync this caught exactly one casualty —
`const isNonProductionRelease = ...` in `script/build.ts` — which broke the
build and which `tsc -p tsconfig.json` does not cover, because the build scripts
compile under `script/tsconfig.json`.

The grep depends on the dropped line mentioning one of our keywords, and plenty
of our lines don't. The exhaustive form takes every line we added since the
merge base and checks it is still somewhere in the merged tree, across just the
files both sides touched — a few dozen, so it is quick:

```sh
git diff --name-only $MB..$PRE_MERGE > /tmp/ours
git diff --name-only $MB..upstream/development > /tmp/theirs
for f in $(comm -12 <(sort /tmp/ours) <(sort /tmp/theirs) | grep -E '\.(ts|tsx|scss|mts)$'); do
  git diff -U0 $MB..$PRE_MERGE -- "$f" | grep '^+' | grep -v '^+++' |
    cut -c2- | grep -v '^[[:space:]]*$' |
    while IFS= read -r line; do
      grep -qF "$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')" "$f" ||
        echo "$f: $line"
    done
done
```

Read the hits rather than trusting the count: lines you rewrote on purpose
during resolution show up here too, and in the 2026-09 sync those three were the
only output.

## Verification ladder

Run all of it. Each rung catches something the others don't:

```sh
npx tsc --noEmit -p tsconfig.json   # app sources
yarn compile:dev                    # webpack resolves everything
yarn build:dev                      # the build scripts themselves typecheck
yarn start                          # it actually boots
node script/test.mjs                # full unit suite
```

Requires the Node version in `.nvmrc`.

Expect a handful of upstream test failures asserting brand strings we changed —
those tests are ours to update, and they are the rebrand's ongoing cost. Update
the assertion to the fork's wording rather than reverting the string.

## Fork-specific gotchas

**Brand strings that are actually GitHub's.** Rebrand text about *our* app, but
leave text that names a GitHub product or setting. `"Copilot in GitHub Desktop"`
is the literal name of a toggle in GitHub's Copilot feature settings; renaming
it sends users looking for a setting that does not exist.

**IPC in tests goes through the preload bridge.** Our renderer runs with
contextIsolation and sends IPC through `window.electronBridge`, not the
`electron` module. `app/test/globals.mts` stubs the bridge; a test that wants to
observe IPC must patch `window.electronBridge.send`. Mocking
`electron.ipcRenderer` silently observes nothing.

This has more reach than it appears: renderer singletons subscribe to IPC
channels while being constructed at import time, and the `lib/git` barrel
reaches `UpdateStore` through `stats-store` → the `lib/stores` barrel →
`app-store`. Without the stub, importing anything from `lib/git` crashes a test
file before its first assertion.

**Webpack config order.** We insert `preloadConfig` at index 1 of
`app/webpack.development.ts`, where upstream's renderer config used to sit.
Anything selecting a config by position is a bug waiting to happen — select by a
property instead, as `script/start.ts` now does with `publicPath`.

**Upstream's GitHub Actions workflows.** Merges can bring workflows that will
run on our repository, including agentic ones that comment on issues. Actions
are enabled on this fork. Workflows triggered by `issues` events only fire from
the default branch, so a merge branch is inert — but decide about them before
merging to the default branch, not after.

Not every one of these fires on its own. `draft-release.yml` is
`workflow_dispatch` only, but as of the 2026-09 sync it asks for
`copilot-requests: write` and passes the repository's own `github.token` as
`COPILOT_GITHUB_TOKEN`, where it previously needed a secret upstream held. It is
inert until somebody triggers it, and worth knowing before somebody does.

We deleted upstream's gh-aw agentic issue triage in the 2026-07 sync
(`.github/workflows/issue-triage.{md,lock.yml}` and
`.github/aw/actions-lock.json`): it dispatches Copilot at issues opened here,
and its tool allowlist points at upstream's own repositories. Expect it back on
the next merge as a re-add, along with any new agentic workflows they land. The
default answer is delete. Grep for `engine: copilot` and `gh-aw` after
resolving, and check what any new workflow triggers on.

## Sync log

| Date | Upstream point | Conflicts | Notes |
| --- | --- | --- | --- |
| 2026-05-31 | — | not recorded | |
| 2026-07-27 | 3.6.4-beta1 era | 16 files, ~31 hunks | dompurify 3.4.0 → 3.4.11, copilot-sdk beta.1 → 1.0.5; Electron already matched at 42.0.1. Suite went 755 pass / 76 fail → 1556 pass / 0 fail after fixing the test harness the merge unblocked. |
| 2026-09-19 | 3.6.7-beta2 | 14 files | Electron 42.0.1 → 44.1.1, Node 24.15.0 → 24.19.0, copilot-sdk 1.0.5 → 1.0.13, dompurify 3.4.11 → 3.4.13. 231 upstream commits over two months; 44 of our 382 changed files overlapped their 150. Three breakages appeared that no conflict marker mentioned, all of them upstream reaching for something this fork routes elsewhere: our folder context-menu items still calling the `clipboard` import upstream deleted (tsc), and two test files patching `electron`'s `ipcRenderer` where this fork goes through `lib/ipc-renderer` → `window.electronBridge` (only the suite). |
