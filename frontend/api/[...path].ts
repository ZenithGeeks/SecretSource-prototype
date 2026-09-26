// Proxies every /api/* call from the Vercel-hosted frontend to the gateway on Cloud Run,
// attaching the Google identity token the gateway's IAM requires. gcp-edu-471706 has a
// domain-restricted-sharing org policy, so the gateway can never be made allUsers-public the
// way ss-core's nginx proxy was — Vercel isn't a GCP identity and can't mint that token
// itself, so this does it on its behalf.
//
// Edge runtime, not a Node serverless function, for two reasons:
//  - Node functions on Vercel cap request bodies at 4.5MB; paper uploads go up to 100MB
//    (deploy/tls-proxy/nginx.conf's client_max_body_size). Edge streams the body through
//    instead of buffering it.
//  - Node functions on this (Hobby) plan cap wall-clock duration at 10s; the analysis
//    progress stream (/analyses/{id}/events, text/event-stream) is long-lived. Edge bills
//    CPU time, not wall-clock, so an idle proxied stream costs almost nothing.
//
// Signs its own JWT with Web Crypto (Edge has no Node crypto/fs, so no google-auth-library)
// and exchanges it for a Google-issued ID token via the standard OAuth2 JWT-bearer flow
// (https://developers.google.com/identity/protocols/oauth2/service-account#jwt-auth), using
// target_audience so the token endpoint returns an id_token rather than an access token.
//
// The gateway's own Authorization header is spent on this ID token, so the frontend's
// Supabase session token (which the gateway's current_user dependency needs) travels as
// X-User-Authorization instead — see backend/app/auth.py's matching change.
//
// Vercel project env vars required (Settings > Environment Variables, not GitHub secrets):
//   GATEWAY_URL        the gateway's Cloud Run URL, e.g. https://gateway-uotp7r3z6a-as.a.run.app
//   GCP_SA_EMAIL        the service account's client_email (backend/secrets/service-auth.json)
//   GCP_SA_PRIVATE_KEY  its private_key, PEM, newlines as literal \n or real linebreaks (both handled)

export const config = { runtime: 'edge' }

// Edge Runtime provides process.env (not the rest of Node's process), but Vercel's own build
// step type-checks this file without reading tsconfig.api.json's "node" types — this local
// declaration satisfies it without depending on that resolution working.
declare const process: { env: Record<string, string | undefined> }

const GATEWAY_URL = process.env.GATEWAY_URL
const SA_EMAIL = process.env.GCP_SA_EMAIL
const SA_PRIVATE_KEY_RAW = process.env.GCP_SA_PRIVATE_KEY

let cachedToken: { token: string; exp: number } | null = null

function b64url(input: ArrayBuffer | string): string {
  const binary =
    typeof input === 'string' ? input : String.fromCharCode(...new Uint8Array(input))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

/** A fresh Google identity token for GATEWAY_URL, minted by signing our own JWT (never asks
 * Google to sign it for us, so this needs no IAM permission beyond holding the key). Cached
 * for the token's lifetime minus a minute, so most requests skip the sign-and-exchange. */
async function mintIdToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token

  const privateKeyPem = (SA_PRIVATE_KEY_RAW as string).replace(/\\n/g, '\n')
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({
      iss: SA_EMAIL,
      sub: SA_EMAIL,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
      target_audience: GATEWAY_URL,
    }),
  )
  const unsigned = `${header}.${claims}`
  const key = await importPrivateKey(privateKeyPem)
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  )
  const jwt = `${unsigned}.${b64url(signature)}`

  const exchanged = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  })
  if (!exchanged.ok) {
    throw new Error(`token exchange failed: ${exchanged.status} ${await exchanged.text()}`)
  }
  const data = (await exchanged.json()) as { id_token: string }
  cachedToken = { token: data.id_token, exp: now + 3600 }
  return data.id_token
}

export default async function handler(request: Request): Promise<Response> {
  if (!GATEWAY_URL || !SA_EMAIL || !SA_PRIVATE_KEY_RAW) {
    return new Response(JSON.stringify({ error: 'gateway proxy is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const incoming = new URL(request.url)
  const upstreamPath = incoming.pathname.startsWith('/api')
    ? incoming.pathname.slice(4)
    : incoming.pathname
  const target = `${GATEWAY_URL}${upstreamPath}${incoming.search}`

  let idToken: string
  try {
    idToken = await mintIdToken()
  } catch {
    return new Response(JSON.stringify({ error: 'could not authenticate to the gateway' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  const userAuth = headers.get('authorization')
  if (userAuth) headers.set('x-user-authorization', userAuth)
  headers.set('authorization', `Bearer ${idToken}`)

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit)

  const responseHeaders = new Headers(upstream.headers)
  responseHeaders.delete('content-encoding')
  responseHeaders.delete('transfer-encoding')
  responseHeaders.delete('connection')
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
}
