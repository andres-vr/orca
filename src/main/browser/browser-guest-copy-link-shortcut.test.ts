import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupCopyLinkShortcutForwarding } from './browser-guest-copy-link-shortcut'

describe('setupCopyLinkShortcutForwarding', () => {
  const browserTabId = 'tab-1'
  const primaryModifier =
    process.platform === 'darwin' ? { meta: true, control: false } : { meta: false, control: true }
  let rendererSendMock: ReturnType<typeof vi.fn>
  let guestOnMock: ReturnType<typeof vi.fn>
  let guestOffMock: ReturnType<typeof vi.fn>
  let guestExecuteJavaScriptMock: ReturnType<typeof vi.fn>

  function makeGuest() {
    return {
      on: guestOnMock,
      off: guestOffMock,
      executeJavaScript: guestExecuteJavaScriptMock
    } as unknown as Electron.WebContents
  }

  function triggerInput(input: Record<string, unknown>) {
    const handler = guestOnMock.mock.calls.find((call) => call[0] === 'before-input-event')?.[1] as
      | ((event: unknown, input: unknown) => void)
      | undefined
    expect(handler).toBeTypeOf('function')
    const preventDefault = vi.fn()
    handler!({ preventDefault }, { type: 'keyDown', ...input })
    return { preventDefault }
  }

  async function flushGuestCheck() {
    await Promise.resolve()
    await Promise.resolve()
  }

  beforeEach(() => {
    rendererSendMock = vi.fn()
    guestOnMock = vi.fn()
    guestOffMock = vi.fn()
    guestExecuteJavaScriptMock = vi.fn()
    setupCopyLinkShortcutForwarding({
      browserTabId,
      guest: makeGuest(),
      resolveRenderer: () => ({ send: rendererSendMock }) as unknown as Electron.WebContents
    })
  })

  it('forwards the chord with the owning tab id when no edit field holds focus', async () => {
    guestExecuteJavaScriptMock.mockResolvedValueOnce(true)
    const { preventDefault } = triggerInput({
      ...primaryModifier,
      shift: true,
      alt: false,
      key: 'c',
      code: 'KeyC'
    })

    await flushGuestCheck()

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(rendererSendMock).toHaveBeenCalledWith('ui:copyBrowserPageUrl', {
      browserPageId: browserTabId
    })
  })

  it('leaves the chord alone when an edit field holds guest focus', async () => {
    guestExecuteJavaScriptMock.mockResolvedValueOnce(false)
    const { preventDefault } = triggerInput({
      ...primaryModifier,
      shift: true,
      alt: false,
      key: 'c',
      code: 'KeyC'
    })

    await flushGuestCheck()

    expect(preventDefault).not.toHaveBeenCalled()
    expect(rendererSendMock).not.toHaveBeenCalled()
  })

  it('ignores chords that do not match the copy-link binding', () => {
    const { preventDefault } = triggerInput({
      ...primaryModifier,
      shift: false,
      alt: false,
      key: 'c',
      code: 'KeyC'
    })

    expect(guestExecuteJavaScriptMock).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
    expect(rendererSendMock).not.toHaveBeenCalled()
  })

  it('ignores key-up events', () => {
    const handler = guestOnMock.mock.calls.find((call) => call[0] === 'before-input-event')?.[1] as
      | ((event: unknown, input: unknown) => void)
      | undefined
    expect(handler).toBeTypeOf('function')
    handler!(
      { preventDefault: vi.fn() },
      { type: 'keyUp', ...primaryModifier, shift: true, alt: false, key: 'c', code: 'KeyC' }
    )

    expect(guestExecuteJavaScriptMock).not.toHaveBeenCalled()
    expect(rendererSendMock).not.toHaveBeenCalled()
  })
})
