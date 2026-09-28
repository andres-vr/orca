import { keybindingMatchesAction, type KeybindingOverrides } from '../../shared/keybindings'
import type { ResolveRenderer } from './browser-guest-renderer-target'

// Why: Mod+Shift+C can be a page-app chord (e.g. a web editor); ask the guest whether an
// editable target holds focus and only then leave the event alone, mirroring grab's guest check.
export function setupCopyLinkShortcutForwarding(args: {
  browserTabId: string
  guest: Electron.WebContents
  resolveRenderer: ResolveRenderer
  getKeybindings?: () => KeybindingOverrides | undefined
}): () => void {
  const { browserTabId, guest, resolveRenderer, getKeybindings } = args
  const handler = (event: Electron.Event, input: Electron.Input): void => {
    if (input.type !== 'keyDown') {
      return
    }
    if (!keybindingMatchesAction('browser.copyLink', input, process.platform, getKeybindings?.())) {
      return
    }
    void guest
      .executeJavaScript(`(() => {
        const active = document.activeElement
        const tag = active?.tagName
        const isEditable =
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          active?.isContentEditable === true ||
          tag === 'SELECT' ||
          tag === 'IFRAME'
        return !isEditable
      })()`)
      .then((shouldCopy) => {
        if (!shouldCopy) {
          return
        }
        event.preventDefault()
        const renderer = resolveRenderer(browserTabId)
        // Why: splits share one renderer; carry the guest owner so only its pane copies.
        renderer?.send('ui:copyBrowserPageUrl', { browserPageId: browserTabId })
      })
      .catch(() => {
        // Why: shortcut forwarding is best-effort — guest teardown or a transient executeJavaScript failure must not break the page chord.
      })
  }

  guest.on('before-input-event', handler)
  return () => {
    try {
      guest.off('before-input-event', handler)
    } catch {
      // Why: browser tabs can briefly outlive the guest webContents during teardown, so cleanup is best-effort.
    }
  }
}
