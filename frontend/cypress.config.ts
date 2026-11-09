import { defineConfig } from 'cypress'

// The Vite dev server on 5174 (npm run e2e starts it), so a dev server on 5173 can keep running.
export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:5174',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    viewportWidth: 1440,
    viewportHeight: 900,
    video: false,
    // The first visit makes Vite transform each role's modules, which can take several seconds.
    defaultCommandTimeout: 10000,
  },
})
