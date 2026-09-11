import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { applyTheme, updateSettings } from './lib/settings.ts'
import { Root } from './Root.tsx'
import './index.css'

// ?theme=light|dark|system lets you deep-link (and preview) a theme; it persists like the
// Settings choice. Then apply the saved theme before first paint so there's no flash.
const urlTheme = new URLSearchParams(window.location.search).get('theme')?.toLowerCase()
const themeChoice = { light: 'Light', dark: 'Dark', system: 'Match system' } as const
if (urlTheme && urlTheme in themeChoice) {
  updateSettings({ theme: themeChoice[urlTheme as keyof typeof themeChoice] })
}
applyTheme()

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </StrictMode>,
)
