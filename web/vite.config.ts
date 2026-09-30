import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig } from 'vite'

// Resolve from the workspace install (hoisted or nested) so Vite always uses
// one React runtime — hardcoding ./node_modules/react breaks when npm hoists.
const require = createRequire(import.meta.url)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: path.dirname(require.resolve('react/package.json')),
      'react-dom': path.dirname(require.resolve('react-dom/package.json')),
    },
  },
})
