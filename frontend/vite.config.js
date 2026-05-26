import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Brief 55 sidecar (2026-05-26): port + API proxy target are env-var
// overridable so a SECOND vite instance can run against the verification
// backend (:8003) without colliding with the live dev server (:5176).
//
//   Live (default — Chris's working state):
//     npm run dev                                       → :5176 → :8002
//
//   Verification (Claude Code's isolated walkthrough server):
//     PORT=5178 API_TARGET=http://127.0.0.1:8003 \
//     STRICT_PORT=1 npm run dev                          → :5178 → :8003
//
// strictPort fails fast if the port is busy (instead of silently
// falling through to 5177 + creating a stale orphan vite).
const VITE_PORT   = Number(process.env.PORT) || 5176
const VITE_STRICT = process.env.STRICT_PORT === '1'
const API_TARGET  = process.env.API_TARGET || 'http://127.0.0.1:8002'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
  ],
  server: {
    port: VITE_PORT,
    strictPort: VITE_STRICT,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
})
