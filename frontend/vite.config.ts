import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on every interface so a tunnel (ngrok/cloudflared) can reach Vite.
    host: true,
    // Accept any Host header — required when serving through *.ngrok-free.app,
    // *.trycloudflare.com, *.loca.lt, etc.
    allowedHosts: true,
    proxy: {
      // Forward /api/*  ->  the FastAPI backend running on port 8000.
      // This means the frontend can be tunneled on a single port and the
      // browser never has to know the backend's address.
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
