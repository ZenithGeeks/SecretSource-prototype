import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

import { clearDoItConversation } from '../src/lib/doItConversation'

// Drop persisted Ask session keys before each test.
const ASK_STORAGE_PREFIX = 'secretsource.ask.'

beforeEach(() => {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(ASK_STORAGE_PREFIX)) keys.push(key)
  }
  for (const key of keys) localStorage.removeItem(key)
})

// Mock URL helpers used for file blobs.
Object.defineProperty(URL, 'createObjectURL', {
  writable: true,
  value: vi.fn(() => 'blob:vitest'),
})
Object.defineProperty(URL, 'revokeObjectURL', {
  writable: true,
  value: vi.fn(),
})

// Mock window.location navigation methods to avoid JSDOM navigation errors.
Object.defineProperty(window, 'location', {
  writable: true,
  value: {
    ...window.location,
    assign: vi.fn(),
    replace: vi.fn(),
    // href getter/setter for assignments.
    get href() { return (this as any)._href || '' },
    set href(val) { (this as any)._href = val },
  },
})

// Mock clipboard API.
Object.defineProperty(navigator, 'clipboard', {
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
