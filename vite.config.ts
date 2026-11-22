import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // OneDrive folders drop file-change events, which leaves the dev server serving stale code
  server: { watch: { usePolling: true, interval: 300 } },
})
