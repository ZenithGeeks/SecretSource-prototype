import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// /api is proxied to the gateway so the app talks to one origin in dev and in the container.
export default defineConfig(({ command, mode }) => {
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
      alias: [
        // latex.js lists only its JS in `exports`, so its stylesheet (and the KaTeX fonts it
        // references, which Vite then bundles) is reached through the package directory.
        { find: 'latex.js/dist', replacement: fileURLToPath(new URL('./node_modules/latex.js/dist', import.meta.url)) },
        ...(command === 'build' ? [
          // Use the vendors' smaller ES modules in production. Keep the installed PDF.js
          // version and its worker together; the exact match leaves the worker import alone.
          { find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/build/pdf.min.mjs' },
          { find: /^cytoscape$/, replacement: 'cytoscape/dist/cytoscape.esm.min.mjs' },
          // cytoscape-cola only uses adaptor and EventType; the WebCola entry also loads
          // the D3 integration and routing algorithms the graph never calls.
          { find: /^webcola$/, replacement: fileURLToPath(new URL('./build/webcola-adaptor.cjs', import.meta.url)) },
        ] : []),
      ],
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
