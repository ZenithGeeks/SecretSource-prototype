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
    include: ['tests/**/*.test.tsx', 'tests/**/*.spec.tsx'],
    coverage: {
      provider: 'v8',
      // Researcher, Labeler and the shared code they use. Author- and
      // Teacher-only files are not held to the 100% bar yet.
      include: ['src/roles/researcher/**', 'src/roles/labeler/**', 'src/components/**', 'src/lib/**'],
      exclude: [
        '**/*.d.ts',
        'src/components/Toaster.tsx',
        'src/components/VerdictBar.tsx',
        'src/lib/author.ts',
        'src/lib/authorExport.ts',
        'src/lib/bibtex.ts',
        'src/lib/draftSave.ts',
        'src/lib/lastRole.ts',
        'src/lib/latexPreview.ts',
        'src/lib/latexProject.ts',
        'src/lib/newVersion.ts',
        'src/lib/previewSanitize.ts',
        'src/lib/referenceCheck.ts',
        'src/lib/teacher*.ts',
        'src/lib/useAuthor.ts',
        'src/lib/useDebounced.ts',
        'src/lib/useInFlight.ts',
        'src/lib/useTeacher.ts',
        'src/lib/verdict.ts',
      ],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
})
