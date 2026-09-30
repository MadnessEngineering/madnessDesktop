import { HookLoadout, LoadoutInstallation } from './loadout-types'

const INSTALLATIONS_KEY = 'madness-hook-loadout-installations'
const CUSTOM_LOADOUTS_KEY = 'madness-custom-loadouts'

// ---------------------------------------------------------------------------
// Installations
// ---------------------------------------------------------------------------

export function getInstallations(): ReadonlyArray<LoadoutInstallation> {
  try {
    const raw = localStorage.getItem(INSTALLATIONS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function getInstallation(repoPath: string): LoadoutInstallation | null {
  return getInstallations().find(i => i.repoPath === repoPath) ?? null
}

export function saveInstallation(installation: LoadoutInstallation): void {
  try {
    const all = getInstallations().filter(
      i => i.repoPath !== installation.repoPath
    )
    localStorage.setItem(
      INSTALLATIONS_KEY,
      JSON.stringify([...all, installation])
    )
  } catch {
    // localStorage unavailable
  }
}

export function removeInstallation(repoPath: string): void {
  try {
    const all = getInstallations().filter(i => i.repoPath !== repoPath)
    localStorage.setItem(INSTALLATIONS_KEY, JSON.stringify(all))
  } catch {
    // localStorage unavailable
  }
}

/** Record the hashes of scripts just (re)written into an installation. */
export function recordInstalledHashes(
  repoPath: string,
  hashes: Readonly<Record<string, string>>
): void {
  const installation = getInstallation(repoPath)
  if (!installation) {
    return
  }
  saveInstallation({
    ...installation,
    installedHashes: { ...installation.installedHashes, ...hashes },
  })
}

export function toggleScript(
  repoPath: string,
  scriptId: string,
  enabled: boolean
): void {
  const installation = getInstallation(repoPath)
  if (!installation) {
    return
  }

  const disabledScripts = enabled
    ? installation.disabledScripts.filter(id => id !== scriptId)
    : [...installation.disabledScripts, scriptId]

  saveInstallation({ ...installation, disabledScripts })
}

// ---------------------------------------------------------------------------
// Custom loadouts
// ---------------------------------------------------------------------------

export function getCustomLoadouts(): ReadonlyArray<HookLoadout> {
  try {
    const raw = localStorage.getItem(CUSTOM_LOADOUTS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveCustomLoadout(loadout: HookLoadout): void {
  try {
    const all = getCustomLoadouts().filter(l => l.id !== loadout.id)
    localStorage.setItem(
      CUSTOM_LOADOUTS_KEY,
      JSON.stringify([...all, { ...loadout, builtin: false }])
    )
  } catch {
    // localStorage unavailable
  }
}

export function deleteCustomLoadout(id: string): void {
  try {
    const all = getCustomLoadouts().filter(l => l.id !== id)
    localStorage.setItem(CUSTOM_LOADOUTS_KEY, JSON.stringify(all))
  } catch {
    // localStorage unavailable
  }
}
