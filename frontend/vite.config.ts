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

  // GATEWAY_URL_HTTP first: plain http, no self-signed cert to trust. GATEWAY_URL (https) is the
  // fallback. A local gateway (docker compose, http://localhost:8080) is the only one that reads
  // this .env, so it is the one to use for anything configured here, e.g. the teacher's Google
  // Classroom connection.
  const target = env.GATEWAY_URL_HTTP || env.GATEWAY_URL || 'http://localhost:8080'

  return {
    plugins: [react(), tailwindcss()],
    envDir: rootDir,
    resolve: {
      alias: {
        // latex.js lists only its JS in `exports`, so its stylesheet (and the KaTeX fonts it
        // references, which Vite then bundles) is reached through the package directory.
        'latex.js/dist': fileURLToPath(new URL('./node_modules/latex.js/dist', import.meta.url)),
      },
    },
    server: {
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
