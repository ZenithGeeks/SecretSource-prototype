import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Same alias as vite.config.ts: latex.js does not export its stylesheet.
    alias: { 'latex.js/dist': fileURLToPath(new URL('./node_modules/latex.js/dist', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.tsx'],
  },
})
