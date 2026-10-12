import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const b64url = (data: string | Buffer) => Buffer.from(data).toString('base64url')

/** A Google identity token for a private Cloud Run service: the same JWT-bearer exchange
 * frontend/api/[...path].ts does on Vercel, signed with the service-account key the backend
 * reads (GOOGLE_APPLICATION_CREDENTIALS). Cached for the token's hour, minus a minute. */
function cloudRunIdToken(audience: string, keyFile: string): () => Promise<string> {
  let cached: { token: string; exp: number } | null = null
  return async () => {
    const now = Math.floor(Date.now() / 1000)
    if (cached && cached.exp - 60 > now) return cached.token
    const key = JSON.parse(readFileSync(keyFile, 'utf8')) as { client_email: string; private_key: string }
    const claims = {
      iss: key.client_email,
      sub: key.client_email,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
      target_audience: audience,
    }
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`
    const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key)
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${b64url(signature)}`,
      }),
    })
    if (!response.ok) throw new Error(`token exchange failed: ${response.status} ${await response.text()}`)
    const { id_token } = (await response.json()) as { id_token: string }
    cached = { token: id_token, exp: now + 3600 }
    return id_token
  }
}

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

  // The Cloud Run gateway is private (IAM), so a plain proxy gets a 403 there. Sign an identity
  // token for it, and move the user's Supabase token to X-User-Authorization, which
  // backend/app/auth.py reads first.
  const idToken = new URL(target).hostname.endsWith('.run.app')
    ? cloudRunIdToken(
        new URL(target).origin,
        resolve(rootDir, 'backend', env.GOOGLE_APPLICATION_CREDENTIALS || 'secrets/service-auth.json'),
      )
    : null

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
          bypass: idToken
            ? async (req) => {
                if (req.headers.authorization) req.headers['x-user-authorization'] = req.headers.authorization
                req.headers.authorization = `Bearer ${await idToken()}`
              }
            : undefined,
        },
      },
    },
  }
})
