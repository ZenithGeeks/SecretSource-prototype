import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// /api is proxied to the gateway so the app talks to one origin in dev and in the container.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Single .env at the repo root (same file docker compose and the backend read) instead of
  // a second frontend/.env that drifts out of sync with it — Vite otherwise only looks in its
  // own project root, so VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY silently had two homes.
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  server: {
    proxy: {
      '/api': {
        target: process.env.GATEWAY_URL ?? 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
