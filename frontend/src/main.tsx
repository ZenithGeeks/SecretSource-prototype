import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { Toaster } from './components/Toaster.tsx'
import { applyTheme, resetSettings, updateSettings } from './lib/settings.ts'
import { supabase } from './lib/supabase.ts'
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

// On sign-out, wipe per-user state so the next account on this browser starts clean: the
// React Query cache (e.g. the previous user's ['analyses']) and the settings store (name,
// email, preferences in localStorage). Without this the old data flashes before the refetch.
supabase?.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    queryClient.clear()
    resetSettings()
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
)
