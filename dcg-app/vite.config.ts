import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // In dev, the frontend runs on Vite's own port while the Rust server
    // (`npm run server:dev`) runs separately on 4287 — proxy /api across so
    // the frontend code never needs to know the difference from prod, where
    // the built server serves both from the same origin.
    proxy: {
      "/api": "http://127.0.0.1:4287",
    },
  },
})
