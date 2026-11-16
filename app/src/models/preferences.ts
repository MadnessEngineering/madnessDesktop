export enum PreferencesTab {
  Accounts,
  Integrations,
  Copilot,
  Git,
  Appearance,
  Prompts,
  AIServices,
  Mqtt,
  AutomationHooks,
  Keybindings,
  Advanced,
  ClaudeCode,
  // Was AutoIgnore: same value, so a remembered last tab still lands here.
  // Auto-Ignore, the Chat History Archive and auto-switch (todo a8c1b611).
  Automation,
  // Appended, never inserted: these values are stored as the last open tab.
  Terminal,
}
