import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// /api is proxied to the gateway so the app talks to one origin in dev and in the container.
export default defineConfig(({ mode }) => {
  // Single .env at the repo root (same file docker compose and the backend read) instead of
  // a second frontend/.env that drifts out of sync with it.
  const rootDir = fileURLToPath(new URL('..', import.meta.url))
  const env = loadEnv(mode, rootDir, '')

  return {
    plugins: [react(), tailwindcss()],
    envDir: rootDir,
    server: {
      proxy: {
        '/api': {
          // GATEWAY_URL_HTTP first: plain http, no self-signed cert to trust. GATEWAY_URL
          // (https, deploy/tls-proxy) is the fallback for setups without the http port open.
          target: env.GATEWAY_URL_HTTP || env.GATEWAY_URL || 'http://localhost:8080',
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
