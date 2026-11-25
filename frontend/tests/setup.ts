import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

import { clearDoItConversation } from '../src/lib/doItConversation'

// Ask remembers the open chat, panel and mode per user (src/lib/askSession.ts). Drop those
// keys before each test so one file's Ask does not reopen inside the next test.
const ASK_STORAGE_PREFIX = 'secretsource.ask.'

// Sonner adds its stylesheet to document.head when any module imports it (the app's Author and
// Researcher screens do). jsdom lays nothing out, so in tests the sheet only makes every
// getComputedStyle, and so every role query, slower. Drop it; no test reads a toast's CSS.
beforeEach(() => {
  for (const style of document.head.querySelectorAll('style')) {
    if (style.textContent?.includes('[data-sonner-toaster]')) style.remove()
  }
})

beforeEach(() => {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(ASK_STORAGE_PREFIX)) keys.push(key)
  }
  for (const key of keys) localStorage.removeItem(key)
})

Object.defineProperty(URL, 'createObjectURL', {
  configurable: true,
  writable: true,
  value: vi.fn(() => 'blob:vitest'),
})
Object.defineProperty(URL, 'revokeObjectURL', {
  configurable: true,
  writable: true,
  value: vi.fn(),
})

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  writable: true,
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
})

beforeEach(() => {
  clearDoItConversation()
  window.sessionStorage.removeItem('agentBridge.connected')
})

afterEach(() => {
  cleanup()
  clearDoItConversation()
})

// jsdom does not implement window scrolling; the Analyses list scrolls to its top on return.
window.scrollTo = vi.fn() as never
