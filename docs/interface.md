# Interface: Keybindings, Themes, Reflog, and the Changes List

## Keybindings

Every shortcut in the app can be rebound in **Settings → Keybindings** (also
**Help → Keyboard Shortcuts…**). Search for an action, click its binding,
press the new keys — **Escape** cancels, the clear button unbinds it — or
**Reset All** to go back to the defaults. Menu items show whatever you've
bound, so the menus always match.

If the keys you pick are already taken, the new binding is saved anyway and a
banner names the action it now shares them with; rebind one of the two.

A few defaults worth knowing:

| Action | Default |
| --- | --- |
| Toggle integrated terminal | **Ctrl+\`** |
| Toggle dotfiles panel | **Cmd+Option+\`** |
| Back / forward through visited repositories | **Cmd+Option+←** / **Cmd+Option+→** |
| Next / previous Madness theme | **Cmd+}** / **Cmd+{** |

## Themes and voice

**Settings → Appearance** adds thirteen Madness themes to the usual light and
dark: Standard Laboratory, Mad Laboratory, Corporate Clean, Gunmetal Arsenal,
Debug Mode, Cyan Laboratory, LabOps, Templar Light, Lab Neon, Alchemist, Deep
Space, Terminal, and Hazmat. **Cmd+}** and **Cmd+{** cycle through them
without opening Settings.

**Personality → UI voice** rewrites the app's wording to match a character —
buttons, headings, and messages across the git client. **None (standard
English)** keeps the normal text.

## Reflog

The **Reflog** tab, next to History, lists everything `HEAD` has pointed at
recently — the safety net after a bad reset or rebase. Select an entry to see
that commit's diff. Right-click an entry to **Checkout Commit**, **Create
Branch Here…**, **Reset to Commit…** (the same reset as in History, with its
confirmation), or **Copy SHA**.

Below the list, an activity log records the app's local AI commit-message
generations; it can be hidden or cleared.

## The changes list

### Folders

Changed files can be grouped into folders: **Settings → Appearance → Changes
List → Group files into folders**, or **Group into folders** in the filter
options menu next to the changes filter.

- Click a folder header — or press **←** / **→** on it — to fold and unfold
  it. **←** on a file folds the folder it's in.
- Folds are remembered per repository.
- With more than 100 changed files, a repository starts with every folder
  folded, until you fold or unfold something yourself.
- A folder's header stays pinned at the top while its files scroll past, and
  filtering keeps the folders.
- Right-click a folder header for **Include All in Folder**, **Exclude All in
  Folder**, discarding the folder's changes, **Collapse** / **Expand**, and
  copying its full or relative path.

### Markdown preview

For a Markdown file, the book button in the diff header shows the file
rendered instead of as a diff, in both the Changes and History tabs. Click
it again to go back to the diff; the choice is remembered.
