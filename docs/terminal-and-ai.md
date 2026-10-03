# Terminal, Local AI, and Claude Code

## Integrated terminal

A terminal panel at the bottom of the window, opened in the current
repository.

- **Toggle it:** **Ctrl+\`**, or **Repository → Toggle Integrated Terminal**.
- **Tabs:** **+** opens another shell; **claude ✦** opens a tab running
  `claude`. Each tab starts in the repository's folder.
- **From the exploded view:** right-click a loose file and choose **Open in
  Terminal (vim)** to open the panel with a new tab, named after the file,
  running `command vim` on it. `command` skips any `vim` alias or function in
  your dotfiles. The item is greyed out for a file whose name contains
  control characters, since the command is typed into the shell.
- **It keeps going:** each repository gets its own set of terminals, and they
  survive switching to another repository and back, or hiding the panel.
  Removing a repository from the app closes its terminals.

Settings live in **Settings → Advanced → Integrated terminal**: show the
terminal on startup, cursor blink, font size, and scrollback lines.

### Dotfiles panel

Next to the terminal, **Cmd+Option+\`** (or **Repository → Toggle Dotfiles
Panel**) opens an editor with a tab each for `~/.zshrc`, `~/.gitconfig`, your aliases
file (the first of `~/.aliases`, `~/.zsh_aliases`, or `~/.bash_aliases` that
exists), and the current repository's `.git/config`. Unsaved edits survive
switching tabs; a file that doesn't exist yet is created when you save.

## Local AI

Commit messages and diff explanations from a model running on your own
machine, through [LM Studio](https://lmstudio.ai) or
[Ollama](https://ollama.com). Off until you turn it on.

**Set it up** in **Settings → AI Services → Local AI**: enable it, pick LM
Studio or Ollama (the base URL defaults to `http://localhost:1234` or
`http://localhost:11434`), and choose a model — the list is read from the
server. You can also swap the system prompt for your own.

**Use it:**

- **Generate a commit message:** the robot button in the commit box, or just
  press **Commit** with an empty summary. The message streams in as the model
  writes it.
- **Explain a diff:** the **Explain changes** button in the diff header opens
  an explanation of the file you're looking at.

**What's sent:** the diff of the selected files, plus your branch name and
recent commit subjects (cleaned up first unless you turn **Sanitize git
context in prompts** off). It goes to the base URL's OpenAI-compatible
`/v1/chat/completions` endpoint. Plain `http://` to anything other than this
machine is refused unless you allow it — but an `https://` address on another
machine is accepted, so the base URL decides where your code goes.

The sanitizing and non-local settings are only shown when beta features are
enabled.

## Claude Code hooks

**Settings → Claude Code** installs the workshop's
[Claude Code](https://claude.com/claude-code) hooks for you:

1. It clones [`MadnessEngineering/crochetomancy`](https://github.com/MadnessEngineering/crochetomancy)
   into `~/.claude/hooks` (or `git pull --ff-only`s it if it's already there).
2. You pick a tier — **Minimal**, **Standard**, or **Full** — and it checks
   the tier's dependencies.
3. **Install** adds that tier's hook commands to `~/.claude/settings.json`.

It only ever appends to `settings.json`, and it records what it added, so
**Uninstall** removes exactly those entries and leaves your own hooks alone.
