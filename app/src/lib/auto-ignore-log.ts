import {
  AutoIgnoreLogKey,
  IAutoIgnoreLogEntry,
  MaxAutoIgnoreLogEntries,
} from '../models/auto-ignore'

/** Recent auto-ignore runs, oldest first. */
export function loadAutoIgnoreLog(): ReadonlyArray<IAutoIgnoreLogEntry> {
  try {
    const raw = localStorage.getItem(AutoIgnoreLogKey)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function appendAutoIgnoreLog(entry: IAutoIgnoreLogEntry): void {
  const entries = [...loadAutoIgnoreLog(), entry].slice(
    -MaxAutoIgnoreLogEntries
  )
  localStorage.setItem(AutoIgnoreLogKey, JSON.stringify(entries))
}

export function clearAutoIgnoreLog(): void {
  localStorage.removeItem(AutoIgnoreLogKey)
}
