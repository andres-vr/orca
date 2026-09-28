import { keybindingMatchesAction, type KeybindingOverrides } from '../../shared/keybindings'
import type { ResolveRenderer } from './browser-guest-renderer-target'

/** Forwards the copy-link chord from a focused guest unless an editable target holds focus. */
// Why: Mod+Shift+C can be a page-app chord (e.g. a web editor); the editable check resolves after
// dispatch, so claim the chord synchronously and hand it back when an edit field holds focus.
export function setupCopyLinkShortcutForwarding(args: {
  browserTabId: string
  guest: Electron.WebContents
  resolveRenderer: ResolveRenderer
  getKeybindings?: () => KeybindingOverrides | undefined
}): () => void {
  const { browserTabId, guest, resolveRenderer, getKeybindings } = args
  /** Intercepts before-input-event keyDowns matching browser.copyLink. */
  const handler = (event: Electron.Event, input: Electron.Input): void => {
    if (input.type !== 'keyDown') {
      return
    }
    if (!keybindingMatchesAction('browser.copyLink', input, process.platform, getKeybindings?.())) {
      return
    }
    // Why: preventDefault only takes effect while before-input-event is being dispatched, and the
    // editable-target check resolves after dispatch — so claim the chord now and hand it back below
    // when an edit field holds focus.
    event.preventDefault()
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
          replayKeyInGuest(guest, input)
          return
        }
        const renderer = resolveRenderer(browserTabId)
        // Why: splits share one renderer; carry the guest owner so only its pane copies.
        renderer?.send('ui:copyBrowserPageUrl', { browserPageId: browserTabId })
      })
      .catch(() => {
        // Why: the guest can be torn down while the check is in flight; there is no page left to hand the chord back to.
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

/** Replays an intercepted chord back into the guest after a synchronous preventDefault. */
function replayKeyInGuest(guest: Electron.WebContents, input: Electron.Input): void {
  const keyCode = keyCodeFromInputCode(input)
  const modifiers: ('shift' | 'control' | 'alt' | 'meta')[] = []
  if (input.shift) {
    modifiers.push('shift')
  }
  if (input.control) {
    modifiers.push('control')
  }
  if (input.alt) {
    modifiers.push('alt')
  }
  if (input.meta) {
    modifiers.push('meta')
  }
  try {
    // Why: page-app chords listen on keydown; replaying char too could double-insert in plain inputs.
    guest.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    guest.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  } catch {
    // Why: the guest can be torn down while the editable check is in flight; the chord is already swallowed, so there is nothing left to hand back.
  }
}

/** Derives a sendInputEvent keyCode from the intercepted input's code. */
function keyCodeFromInputCode(input: Electron.Input): string {
  const code = input.code ?? ''
  if (code.startsWith('Key')) {
    return code.slice('Key'.length).toLowerCase()
  }
  if (code.startsWith('Digit')) {
    return code.slice('Digit'.length)
  }
  if (typeof input.key === 'string' && input.key.length === 1) {
    return input.key.toLowerCase()
  }
  return code
}
