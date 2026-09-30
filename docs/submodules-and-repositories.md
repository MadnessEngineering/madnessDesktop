# Submodules, Repositories, and Remotes

Madness Desktop is built for monorepos full of submodules and machines with a
lot of repositories on them. This page covers the tools for both.

## Submodules

### Managing them

There are three ways into the submodule manager:

- the **Submodules** button in the toolbar — **Pull All Submodules**, **Push
  All Submodules**, **Init Uninitialized**, or **Manage Submodules…**;
- the submodules tab on the right edge of the window, which slides the manager
  in over the diff;
- **Show Submodules** on the "No local changes" page.

The manager lists every submodule with its status (`ok`, `uninit`,
`modified`, `conflict`) and per-row **Init**, **Sync**, **Pull**, **Push**, and
**Rollback** (for a modified one). Its **Foreach** tab runs a shell command in
every submodule, optionally recursively, and shows the combined output.

### Push and pull go through the submodules

Pushing or pulling the parent repository first pushes or pulls each submodule
on its own, with progress per submodule, and then the parent.

### Submodule changes in the parent

When a submodule's pointer or contents change, selecting it in the parent's
changes list shows:

- the commits the new pointer brings in;
- the submodule's own uncommitted files, with a commit box so you can commit
  them without switching repositories — labelled with the branch the commit
  will land on, and warning you first if the submodule's HEAD is detached;
- **Sync**, **Rollback** (put the pointer back), and **Open Repository**.

![A submodule pointer change in the parent repository, listing the commits it brings in, with Sync and Rollback](assets/submodule-changes.png)

### From the terminal

The `madhub` CLI has `madhub sub <init|pull|push|sync|rollback> [path]
[submodule]` and `madhub foreach <command> [-r] [path]` — see the
[README](../README.md#the-madhub-cli).

## The repository list

### Monorepos nest

A repository that sits inside another repository you've added — a submodule,
say — is listed underneath it, and the parent row can be folded.

Submodules you haven't added yet appear as **ghost** rows under their
parent, with an **Add** button that adds them in one click. Added submodules
join whatever custom groups their parent is in.

### Favorites and groups

Right-click a repository for:

- **Add to Favorites** / **Remove from Favorites** — favorites get their own
  section at the top;
- **New Group…** and **Add to Group** — your own named sections;
- **Create Alias** (or **Change Alias**), **Copy Repo Name**, **Copy Repo Path**.

Group headers fold, and you can drag repositories to reorder them within
favorites and groups. When you add a repository, you can choose which group
it goes in. `madhub add`, `madhub group`, and `madhub fav` do the same from
the terminal.

### Back and forward

The ← and → buttons at the left of the toolbar step back and forward through
the repositories you've visited — **Cmd+Option+←** / **Cmd+Option+→** by
default (rebindable, see [Keybindings](./interface.md#keybindings)).

### Worktrees

**Settings → Advanced → Enable worktrees** turns on worktree support: a
worktree list, **Show Worktrees** and **New Worktree…** on a repository's
right-click menu. **Settings → Appearance → Always show worktree list** keeps
the list visible.

## Remotes

### The remotes manager

**Repository Settings → Remote → Manage all remotes…**, or the remotes tab on
the right edge of the window, opens the remotes manager. Its **Remotes** tab
lists, adds, and edits remotes; its **Sync** tab is a grid of every local
branch against every remote, marking each cell synced, ahead, behind,
diverged, absent, or locked.

### Branch locks

You can restrict where a branch may be pushed: to all remotes, to specific
ones, or nowhere (**Local only**).

- The **first time you push a branch**, Madness Desktop asks *"Where can this
  branch be pushed?"* and remembers the answer, so it only asks once.
- Change it later from the branch's right-click menu (**Remote Policy…**) or a
  locked cell in the Sync grid.
- The app refuses a push that breaks the lock and says why.

Locks are stored in the repository's git config as
`branch.<name>.madnessRemotes`. The app enforces them itself; to enforce them
for `git push` in a terminal too, install a [hook loadout](./hook-loadouts.md)
— they all include the `remote-guard` pre-push hook.
