/** lib/desktopNotice.ts: asking for permission, clicking a notice, and the errors a browser can
 * throw. The Settings toggle and the TypeError case are in notifications-setting.test.tsx. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { askNoticePermission, noticesBlocked, showDoneNotice } from '../src/lib/desktopNotice'
import { resetSettings, updateSettings } from '../src/lib/settings'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

class FakeNotification {
  static permission: NotificationPermission = 'default'
  static answer: NotificationPermission = 'granted'
  static requestPermission = vi.fn(async () => FakeNotification.answer)
  static last: FakeNotification | null = null
  onclick: (() => void) | null = null
  close = vi.fn()
  constructor() {
    FakeNotification.last = this
  }
}

function setSecure(value: boolean) {
  Object.defineProperty(window, 'isSecureContext', { value, configurable: true })
}

beforeEach(() => {
  resetSettings()
  FakeNotification.permission = 'default'
  FakeNotification.answer = 'granted'
  FakeNotification.requestPermission.mockClear()
  FakeNotification.last = null
  vi.stubGlobal('Notification', FakeNotification)
  setSecure(true)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('askNoticePermission', () => {
  it('asks the browser and reports its answer', async () => {
    expect(await askNoticePermission()).toBe(true)
    FakeNotification.answer = 'denied'
    expect(await askNoticePermission()).toBe(false)
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(2)
  })

  it('says yes without asking when permission is already granted', async () => {
    FakeNotification.permission = 'granted'
    expect(await askNoticePermission()).toBe(true)
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled()
  })

  it('says no without asking when the browser already blocks it', async () => {
    FakeNotification.permission = 'denied'
    expect(await askNoticePermission()).toBe(false)
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled()
  })

  it('says no where notifications are not offered (plain http)', async () => {
    setSecure(false)
    expect(await askNoticePermission()).toBe(false)
    expect(noticesBlocked()).toBe(false)
  })
})

describe('noticesBlocked', () => {
  it('is true only once the browser has said no', () => {
    expect(noticesBlocked()).toBe(false)
    FakeNotification.permission = 'denied'
    expect(noticesBlocked()).toBe(true)
  })
})

describe('showDoneNotice', () => {
  beforeEach(() => {
    FakeNotification.permission = 'granted'
    updateSettings({ notifyDone: true })
  })

  it('focuses the tab, runs onOpen and closes the notice when it is clicked', () => {
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {})
    const onOpen = vi.fn()
    showDoneNotice('Done', 'Paper', 'a1', onOpen)

    FakeNotification.last?.onclick?.()

    expect(focus).toHaveBeenCalled()
    expect(onOpen).toHaveBeenCalled()
    expect(FakeNotification.last?.close).toHaveBeenCalled()
  })

  it('closes a clicked notice that has no onOpen', () => {
    vi.spyOn(window, 'focus').mockImplementation(() => {})
    showDoneNotice('Done', 'Paper', 'a1')
    FakeNotification.last?.onclick?.()
    expect(FakeNotification.last?.close).toHaveBeenCalled()
  })

  it('lets an error other than TypeError through', () => {
    vi.stubGlobal(
      'Notification',
      Object.assign(
        function Broken() {
          throw new Error('boom')
        },
        { permission: 'granted' },
      ),
    )
    expect(() => showDoneNotice('Done', 'Paper', 'a1')).toThrow('boom')
  })
})
