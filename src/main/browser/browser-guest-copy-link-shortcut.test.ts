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
  let guestSendInputEventMock: ReturnType<typeof vi.fn>
  const expectedReplayModifiers = [
    'shift',
    ...(primaryModifier.control ? ['control'] : []),
    ...(primaryModifier.meta ? ['meta'] : [])
  ]

  function makeGuest() {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fake provides the WebContents methods the forwarding setup exercises.
    return {
      on: guestOnMock,
      off: guestOffMock,
      executeJavaScript: guestExecuteJavaScriptMock,
      sendInputEvent: guestSendInputEventMock
    } as unknown as Electron.WebContents
  }

  function triggerInput(input: Record<string, unknown>) {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The listener is captured from the mock's own registered before-input-event calls and guarded by the toBeTypeOf assertion below.
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
    guestSendInputEventMock = vi.fn()
    setupCopyLinkShortcutForwarding({
      browserTabId,
      guest: makeGuest(),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The stub provides send, the only WebContents method the forwarding path calls.
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
    // Why: preventDefault only takes effect during before-input-event dispatch, so assert it synchronously — a flush would hide a late call.
    expect(preventDefault).toHaveBeenCalledTimes(1)

    await flushGuestCheck()

    expect(rendererSendMock).toHaveBeenCalledWith('ui:copyBrowserPageUrl', {
      browserPageId: browserTabId
    })
    expect(guestSendInputEventMock).not.toHaveBeenCalled()
  })

  it('hands the chord back to the guest when an edit field holds focus', async () => {
    guestExecuteJavaScriptMock.mockResolvedValueOnce(false)
    const { preventDefault } = triggerInput({
      ...primaryModifier,
      shift: true,
      alt: false,
      key: 'c',
      code: 'KeyC'
    })
    // Why: the chord is always claimed synchronously, then replayed once the guest reports an editable target.
    expect(preventDefault).toHaveBeenCalledTimes(1)

    await flushGuestCheck()

    expect(rendererSendMock).not.toHaveBeenCalled()
    expect(guestSendInputEventMock).toHaveBeenCalledTimes(2)
    expect(guestSendInputEventMock).toHaveBeenNthCalledWith(1, {
      type: 'keyDown',
      keyCode: 'c',
      modifiers: expectedReplayModifiers
    })
    expect(guestSendInputEventMock).toHaveBeenNthCalledWith(2, {
      type: 'keyUp',
      keyCode: 'c',
      modifiers: expectedReplayModifiers
    })
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
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The listener is captured from the mock's own registered before-input-event calls and guarded by the toBeTypeOf assertion below.
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
