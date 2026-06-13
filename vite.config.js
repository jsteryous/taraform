import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  test: {
    // Node env is enough for the pure data-layer tests (no DOM). The RLS integration
    // test talks to live Supabase and self-skips unless creds are in env.
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
    // Stale Claude worktrees under .claude/ hold duplicate copies of every file —
    // never collect tests from them.
    exclude: ['**/node_modules/**', '.claude/**', '**/.claude/**'],
  },
})
