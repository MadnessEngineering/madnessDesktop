// Upstream patches `electron`'s `ipcRenderer.invoke` here. This fork's renderer
// never touches that object: `lib/ipc-renderer` reads `window.electronBridge`
// on every call (see the note in globals.mts), so patching the electron module
// captures nothing and the assertions just see an empty list.
export function captureClipboardWrites() {
  const writes = new Array<string>()
  const bridge = window.electronBridge
  const previousInvoke = bridge.invoke

  bridge.invoke = async (channel: string, ...args: any[]) => {
    if (channel === 'write-clipboard-text') {
      writes.push(args[0])
      return
    }

    return previousInvoke.call(bridge, channel, ...args)
  }

  return {
    writes,
    restore() {
      bridge.invoke = previousInvoke
    },
  }
}
